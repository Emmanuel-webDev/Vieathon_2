import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { db } from "./db";
import { runAudit, sortFindings, summarize } from "./audit";
import { auditQueue } from "./queue";
import { LENSES, aiAvailable, aiSpecialist, aiVerify, type Lens, type VerifyResult, getAIConfig } from "./ai";
import { AIQuotaExceededError, checkDeepBudget, getAIQuotaStatus } from "./quota";
import { mergeCandidates } from "./merge";
import { hashReport } from "./hash";
import { saveReport } from "./store";
import { attachJob, refundOrder } from "./payments";
import type { AuditReport, DeepInfo, Finding } from "./types";

/**
 * Deep swarm (paid tier). Runs in the background and survives the browser tab closing:
 *   1. the normal pipeline as a baseline (onchain facts, static rules, AI triage),
 *   2. specialist AI reviewers, each with a different attacker lens, over the same real source,
 *   3. an adversarial verifier that tries to build a concrete exploit for every serious finding.
 * Exploit scenarios are reasoned from the code; they are NOT executed. The report says so.
 * If the job fails before producing a report, the payment credit is returned.
 */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function jobLog(id: string, level: "info" | "warn" | "error" | "ok", message: string) {
  db().prepare("INSERT INTO job_events (job_id, ts, level, message) VALUES (?,?,?,?)").run(id, Date.now(), level, message.slice(0, 600));
  db().prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

function setStatus(id: string, status: string, extra: { error?: string; report?: AuditReport; hash?: string } = {}) {
  db()
    .prepare("UPDATE jobs SET status = ?, updated_at = ?, error = COALESCE(?, error), report = COALESCE(?, report), report_hash = COALESCE(?, report_hash) WHERE id = ?")
    .run(status, Date.now(), extra.error ?? null, extra.report ? JSON.stringify(extra.report) : null, extra.hash ?? null, id);
}

export function applyVerifyResult(f: Finding, r: VerifyResult) {
  f.exploit = {
    verdict: r.verdict,
    steps: r.steps,
    attacker: r.attacker,
    gain: r.gain,
    victim: r.victim,
    preconditions: r.preconditions,
    impact: r.impact,
  };
  if (r.verdict === "not_exploitable") {
    if (f.severity === "critical" || f.severity === "high" || f.severity === "medium") {
      f.severity = "low";
    }
    f.triage = { verdict: "likely", reason: `Downgraded by verifier (no attacker gain): ${r.reason}` };
  } else {
    f.triage = { verdict: r.verdict === "exploitable" ? "confirmed" : "likely", reason: r.reason };
  }
  if (r.patch && !f.patch) f.patch = r.patch;
}

export function startDeepJob(orderId: string, target: string, githubToken?: string) {
  if (!aiAvailable()) {
    refundOrder(orderId);
    throw new Error("No AI API key configured on server (ANTHROPIC_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY).");
  }
  const budget = checkDeepBudget(target);
  if (!budget.ok) {
    refundOrder(orderId);
    throw new AIQuotaExceededError(
      `Insufficient daily AI budget for Deep Swarm: requires ${budget.needed} requests for the full lens set, only ${budget.quota.remaining}/${budget.quota.budget} remaining today. Payment credit refunded.`
    );
  }
  const id = randomBytes(8).toString("hex");
  const key = randomBytes(24).toString("base64url");
  const now = Date.now();
  db().prepare("INSERT INTO jobs (id, secret_hash, order_id, target, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(id, sha(key), orderId, target, "queued", now, now);
  attachJob(orderId, id);
  jobLog(id, "info", "Deep swarm accepted. Payment verified onchain.");
  void run(id, orderId, target, githubToken);
  return { jobId: id, key };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, q.length) }, async () => {
      while (q.length) await fn(q.shift()!);
    })
  );
}

async function run(jobId: string, orderId: string, target: string, githubToken?: string) {
  const t0 = Date.now();
  const log = (level: "info" | "warn" | "error" | "ok", m: string) => jobLog(jobId, level, m);
  try {
    if (!aiAvailable()) throw new Error("No AI API key configured on server (ANTHROPIC_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY).");
    setStatus(jobId, "running");

    // 1. baseline, through the same queue, at paid priority
    let last = 0;
    const ticket = auditQueue().enqueue(true, (pos) => {
      if (pos !== last) {
        last = pos;
        log("info", `Waiting for a scan slot: position ${pos}`);
      }
    });
    const release = await ticket.ready;
    let base;
    try {
      log("info", "Phase 1/3: baseline scan");
      base = await runAudit(
        target,
        (e) => {
          if (e.type === "log") log(e.level, e.message);
        },
        { tier: "deep", githubToken }
      );
    } finally {
      release();
    }

    const files = base.files.filter((f) => /\.(sol|ts|tsx|js|jsx|mjs|html)$/i.test(f.path));
    if (!files.length) throw new Error("No source files were available for the swarm to review.");
    const hasSol = files.some((f) => /\.sol$/i.test(f.path));
    const hasApp = files.some((f) => !/\.sol$/i.test(f.path));
    const lenses: Lens[] = LENSES.filter((l) => (l.applies === "sol" ? hasSol : hasApp));
    const remainingBeforeSwarm = getAIQuotaStatus().remaining;
    const neededAfterBase = lenses.length + 1;
    if (remainingBeforeSwarm < neededAfterBase) {
      throw new AIQuotaExceededError(
        `Insufficient daily AI budget to run full ${lenses.length}-lens swarm + verifier (${remainingBeforeSwarm} remaining, ${neededAfterBase} needed).`
      );
    }
    const ctxNote = `${base.report.limitations.find((l) => /repository|Live|contract/i.test(l)) ?? ""} Target: ${base.report.target.raw.slice(0, 300)}`;

    // 2. specialist agents
    const aiCfg = getAIConfig();
    const isGemini = aiCfg.provider === "gemini";
    const specialistConcurrency = isGemini ? 1 : 2;
    log("info", `Phase 2/3: ${lenses.length} specialist agents hunting ${isGemini ? "sequentially (concurrency 1)" : "in parallel"} (${aiCfg.deepModel})`);
    const candidates: Finding[] = [];
    const agents: DeepInfo["agents"] = [];
    const stages: DeepInfo["stages"] = {
      specialistsTotal: lenses.length,
      specialistsSucceeded: 0,
      specialistsFailed: 0,
      verifierRan: false,
    };

    let agentIndex = 0;
    await pool(lenses, specialistConcurrency, async (lens) => {
      if (isGemini && agentIndex > 0) {
        // Pacing delay between specialist requests to respect Gemini free tier RPM limits
        await new Promise((r) => setTimeout(r, 12000));
      }
      agentIndex++;
      log("info", `Agent "${lens.label}" is reviewing ${files.length} file(s)…`);
      try {
        const out = await aiSpecialist(lens, files, ctxNote, (m, l) => log(l ?? "info", m), base.isPrivate);
        candidates.push(...out.findings);
        agents.push({ id: lens.id, label: lens.label, candidates: out.raw, kept: out.findings.length, status: "succeeded" });
        stages.specialistsSucceeded++;
        log("ok", `Agent "${lens.label}": ${out.findings.length} grounded candidate(s) (${out.raw - out.findings.length} discarded)`);
      } catch (e: any) {
        agents.push({ id: lens.id, label: lens.label, candidates: 0, kept: 0, error: e.message.slice(0, 200), status: "failed" });
        stages.specialistsFailed++;
        log("warn", `Agent "${lens.label}" failed: ${e.message}`);
      }
    });

    if (agents.every((a) => a.error || a.status === "failed")) {
      throw new Error(`Every specialist agent failed (${agents[0]?.error || "all lenses errored"}).`);
    }

    const { merged, added, corroborated } = mergeCandidates(base.report.findings, candidates);
    log("info", `Merged: ${added.length} new finding(s) from the swarm, ${corroborated} existing finding(s) independently corroborated`);

    // 3. adversarial verification of every serious static/AI finding
    const serious = sortFindings(
      merged.filter((f) => f.triage?.verdict !== "dismissed" && (f.origin === "static" || f.origin === "ai") && ["critical", "high", "medium"].includes(f.severity))
    ).slice(0, 30);
    log("info", `Phase 3/3: adversarial verifier trying to exploit ${serious.length} finding(s)`);
    let exploitable = 0, conditional = 0, notExploitable = 0, verified = 0;
    if (serious.length) {
      if (isGemini) {
        await new Promise((r) => setTimeout(r, 15000));
      }
      try {
        const results = await aiVerify(serious, files, ctxNote, base.isPrivate);
        stages.verifierRan = true;
        for (const f of serious) {
          const r = results.get(f.id);
          if (!r) continue;
          verified++;
          applyVerifyResult(f, r);
          if (r.verdict === "exploitable") exploitable++;
          else if (r.verdict === "conditional") conditional++;
          else notExploitable++;
        }
        log("ok", `Verifier: ${exploitable} exploitable, ${conditional} conditional, ${notExploitable} not exploitable`);
      } catch (e: any) {
        log("warn", `Verifier failed: ${e.message}. Findings are reported without exploit analysis.`);
      }
    }

    const isPartial = stages.specialistsFailed > 0;
    const durationMs = Date.now() - t0;
    const deep: DeepInfo = {
      model: aiCfg.deepModel,
      provider: aiCfg.provider,
      status: isPartial ? "partial" : "done",
      stages,
      agents,
      verified,
      exploitable,
      conditional,
      notExploitable,
      durationMs,
    };
    sortFindings(merged);
    const report: AuditReport = {
      ...base.report,
      findings: merged,
      summary: summarize(merged),
      tier: isPartial ? "partial-deep" : "deep",
      deep,
      limitations: [
        ...base.report.limitations.filter((l) => l !== "Exploit scenarios are reasoned from the code, not executed."),
        `Deep swarm specialist & verifier stages produced by ${aiCfg.label} (provider: ${aiCfg.provider}, model: ${aiCfg.deepModel}).`,
        "Exploit scenarios are reasoned from the code, not executed.",
        isPartial
          ? `Partial deep swarm: only ${stages.specialistsSucceeded}/${stages.specialistsTotal} specialist lenses succeeded. Failed lenses: ${agents.filter((a) => a.error).map((a) => a.label).join(", ")}.`
          : "Deep swarm: attack scenarios are reasoned by an AI from the source code and have NOT been executed. Treat them as hypotheses to reproduce (for example in a Foundry fork test) before acting on them.",
      ],
    };
    const hash = hashReport(report);
    if (!base.isPrivate) await saveReport(randomUUID(), report, hash).catch(() => undefined);
    const finalStatus = isPartial ? "partial" : "done";
    setStatus(jobId, finalStatus, { report, hash });
    log("ok", `${isPartial ? "Partial deep swarm finished" : "Done"} in ${Math.round(durationMs / 1000)}s (${stages.specialistsSucceeded}/${stages.specialistsTotal} lenses ran): ${report.summary.critical} critical, ${report.summary.high} high, ${report.summary.medium} medium`);
  } catch (e: any) {
    log("error", `Swarm failed: ${e.message}`);
    setStatus(jobId, "failed", { error: e.message.slice(0, 400) });
    refundOrder(orderId);
    log("info", "Your payment credit was returned. You can retry without paying again.");
  }
}

export function authorizeJob(id: string, key: string | null): boolean {
  if (!key || !/^[0-9a-f]{16}$/.test(id)) return false;
  const row = db().prepare("SELECT secret_hash FROM jobs WHERE id = ?").get(id);
  if (!row) return false;
  const a = Buffer.from(row.secret_hash, "hex");
  const b = Buffer.from(sha(key), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getJob(id: string) {
  const j = db().prepare("SELECT id, order_id, target, status, created_at, updated_at, report, report_hash, error FROM jobs WHERE id = ?").get(id);
  if (!j) return null;
  const events = db().prepare("SELECT id, ts, level, message FROM job_events WHERE job_id = ? ORDER BY id ASC").all(id);
  return {
    id: j.id,
    orderId: j.order_id as string,
    target: j.target as string,
    status: j.status as string,
    createdAt: j.created_at as number,
    updatedAt: j.updated_at as number,
    error: (j.error as string | null) ?? undefined,
    report: j.report ? (JSON.parse(j.report) as AuditReport) : undefined,
    hash: (j.report_hash as string | null) ?? undefined,
    events,
  };
}

/** A restart kills in-flight jobs (they run in-process). Fail them and give the credit back. */
export function recoverOrphanedJobs() {
  const rows = db().prepare("SELECT id, order_id FROM jobs WHERE status IN ('queued','running')").all() as { id: string; order_id: string }[];
  for (const r of rows) {
    jobLog(r.id, "error", "Server restarted while this job was running.");
    setStatus(r.id, "failed", { error: "Server restarted" });
    refundOrder(r.order_id);
    jobLog(r.id, "info", "Your payment credit was returned. You can retry without paying again.");
  }
  return rows.length;
}
