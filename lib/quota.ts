import { db } from "./db";
import { parseTarget } from "./target";
import { sampleById } from "./samples";

export const DEFAULT_AI_DAILY_BUDGET = 15;
export const QUOTA_SKIPPED_MESSAGE = "Daily AI quota reached: static checks only, findings unconfirmed";

export class AIQuotaExceededError extends Error {
  constructor(message = QUOTA_SKIPPED_MESSAGE) {
    super(message);
    this.name = "AIQuotaExceededError";
  }
}

export interface AIQuotaStatus {
  day: string;
  budget: number;
  used: number;
  remaining: number;
  exhausted: boolean;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getDailyBudget(): number {
  const raw = process.env.NIGHTWATCH_AI_DAILY_BUDGET;
  if (raw === undefined || raw.trim() === "") return DEFAULT_AI_DAILY_BUDGET;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_DAILY_BUDGET;
}

export function getAIQuotaStatus(now = new Date()): AIQuotaStatus {
  const day = utcDay(now);
  const budget = getDailyBudget();
  const row = db().prepare("SELECT used FROM ai_daily_usage WHERE day = ?").get(day) as { used: number } | undefined;
  const used = row?.used ?? 0;
  const remaining = Math.max(0, budget - used);
  return {
    day,
    budget,
    used,
    remaining,
    exhausted: remaining <= 0,
  };
}

/**
 * Atomically reserve 1 provider request against today's global SQLite budget.
 * Returns true if allowed and recorded; false if today's budget is exhausted.
 */
export function tryConsumeAIRequest(now = new Date()): boolean {
  const budget = getDailyBudget();
  if (budget <= 0) return false;
  const day = utcDay(now);
  const ts = now.getTime();
  const d = db();
  d.prepare("INSERT INTO ai_daily_usage (day, used, updated_at) VALUES (?, 0, ?) ON CONFLICT(day) DO NOTHING").run(day, ts);
  const res = d.prepare("UPDATE ai_daily_usage SET used = used + 1, updated_at = ? WHERE day = ? AND used < ?").run(ts, day, budget);
  return res.changes === 1;
}

/**
 * Compute the full AI call budget needed for a Deep Swarm run:
 * 1 baseline triage + full applicable specialist lens set + 1 verifier batch.
 * (4 Solidity lenses + 1 app lens = 5 lenses max -> 7 total calls for repo/project, 6 for Solidity-only contract).
 */
export function requiredDeepCalls(targetRaw?: string): number {
  const FULL_ALL_LENSES = 1 + 5 + 1; // 7: baseline + 5 lenses + verifier
  if (!targetRaw) return FULL_ALL_LENSES;
  try {
    const t = parseTarget(targetRaw);
    if (t.kind === "contract") return 1 + 4 + 1; // 6: baseline + 4 Solidity lenses + verifier
    if (t.kind === "url") return 1 + 1 + 1; // 3: baseline + 1 app lens + verifier
    if (t.kind === "sample" && t.sample) {
      const s = sampleById(t.sample);
      if (s) {
        const hasSol = s.files.some((f) => /\.sol$/i.test(f.path));
        const hasApp = s.files.some((f) => !/\.sol$/i.test(f.path));
        const lensCount = (hasSol ? 4 : 0) + (hasApp ? 1 : 0);
        return 1 + Math.max(1, lensCount) + 1;
      }
    }
    return FULL_ALL_LENSES;
  } catch {
    return FULL_ALL_LENSES;
  }
}

export function checkDeepBudget(targetRaw?: string, now = new Date()): { ok: boolean; needed: number; quota: AIQuotaStatus } {
  const quota = getAIQuotaStatus(now);
  const needed = requiredDeepCalls(targetRaw);
  return {
    ok: quota.remaining >= needed,
    needed,
    quota,
  };
}

