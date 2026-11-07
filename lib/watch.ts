import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";
import { parseTarget } from "./target";
import { runAudit } from "./audit";
import { snapshotAddress, type AddressSnapshot } from "./onchain";
import { safeFetchText } from "./safe-fetch";
import type { AuditReport, ChainId, Finding, ReportSummary, Severity } from "./types";

/**
 * Night Shift: a baseline scan, then periodic *real* checks. Cheap checks run every interval
 * (commit SHA, deployed bundle fingerprint, URL up/down, onchain code/proxy/admin/owner state).
 * Only when something actually changed do we pay for a full re-scan, and we diff its findings
 * against the previous scan. Nothing in the briefing is invented: every event is a measured change.
 */

export interface WatchState {
  checks: number;
  changes: number;
  lastCheckAt?: number;
  commitSha?: string;
  urlUp?: boolean;
  bundleSig?: string;
  addrs: Record<string, AddressSnapshot>;
  findingFps: string[];
  summary?: ReportSummary;
  lastReportHash?: string;
  lastError?: string;
}

export interface WatchEventRow {
  id: number;
  ts: number;
  type: string;
  severity: Severity | "ok";
  title: string;
  detail: any;
}

const MIN_INTERVAL = 30; // minutes
const MAX_HOURS = 48;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function fingerprint(f: Finding) {
  return `${f.category}|${f.title}|${f.file ?? ""}`;
}

function addEvent(watchId: string, type: string, severity: Severity | "ok", title: string, detail: unknown = {}) {
  db()
    .prepare("INSERT INTO events (watch_id, ts, type, severity, title, detail) VALUES (?,?,?,?,?,?)")
    .run(watchId, Date.now(), type, severity, title, JSON.stringify(detail));
}

function loadState(id: string): WatchState {
  const row = db().prepare("SELECT state FROM watches WHERE id = ?").get(id);
  return { checks: 0, changes: 0, addrs: {}, findingFps: [], ...(row ? JSON.parse(row.state) : {}) };
}
function saveState(id: string, s: WatchState) {
  db().prepare("UPDATE watches SET state = ? WHERE id = ?").run(JSON.stringify(s), id);
}

export function createWatch(targetRaw: string, hours: number, intervalMin: number, opts?: { baseline?: { report: AuditReport; hash: string } }) {
  const target = parseTarget(targetRaw);
  const iv = Math.max(MIN_INTERVAL, Math.min(720, Math.floor(intervalMin) || 60));
  const hrs = Math.max(1, Math.min(MAX_HOURS, Math.floor(hours) || 10));
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const now = Date.now();
  db()
    .prepare("INSERT INTO watches (id, secret_hash, target, kind, interval_min, created_at, expires_at, next_run, status) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, sha(secret), targetRaw.trim(), target.kind, iv, now, now + hrs * 3600_000, now + iv * 60_000, "baselining");
  addEvent(id, "started", "ok", `Night Shift started: watching for ${hrs}h, checking every ${iv} min`, { target: targetRaw.trim() });
  void baseline(id, opts?.baseline).catch((e) => {
    addEvent(id, "error", "medium", `Baseline scan failed: ${e.message}`);
    db().prepare("UPDATE watches SET status = 'error' WHERE id = ?").run(id);
  });
  return { id, secret, expiresAt: now + hrs * 3600_000, intervalMin: iv };
}

export function authorize(id: string, secret: string | null): boolean {
  if (!secret) return false;
  const row = db().prepare("SELECT secret_hash FROM watches WHERE id = ?").get(id);
  if (!row) return false;
  const a = Buffer.from(row.secret_hash, "hex");
  const b = Buffer.from(sha(secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getWatch(id: string) {
  const w = db().prepare("SELECT id, target, kind, interval_min, created_at, expires_at, next_run, active, status FROM watches WHERE id = ?").get(id);
  if (!w) return null;
  const events = db().prepare("SELECT id, ts, type, severity, title, detail FROM events WHERE watch_id = ? ORDER BY ts ASC, id ASC").all(id) as any[];
  return { ...w, state: loadState(id), events: events.map((e) => ({ ...e, detail: JSON.parse(e.detail) })) as WatchEventRow[] };
}

export function stopWatch(id: string) {
  db().prepare("UPDATE watches SET active = 0, status = 'stopped' WHERE id = ?").run(id);
  addEvent(id, "stopped", "ok", "Night Shift stopped by owner");
}

async function fullScan(target: string): Promise<{ report: AuditReport; hash: string }> {
  let out: { report: AuditReport; hash: string } | null = null;
  await runAudit(target, (e) => {
    if (e.type === "report") out = { report: e.report, hash: e.reportHash };
  });
  if (!out) throw new Error("Scan produced no report");
  return out;
}

async function baseline(id: string, pre?: { report: AuditReport; hash: string }) {
  const w = db().prepare("SELECT target FROM watches WHERE id = ?").get(id);
  const { report, hash } = pre ?? (await fullScan(w.target));
  const state = loadState(id);
  state.findingFps = report.findings.filter((f) => f.triage?.verdict !== "dismissed").map(fingerprint);
  state.summary = report.summary;
  state.lastReportHash = hash;
  for (const c of report.contractFacts ?? []) {
    if (c.isContract) state.addrs[`${c.chainId}:${c.address}`] = await snapshotAddress(c.address as `0x${string}`, c.chainId).catch(() => ({ address: c.address, isContract: true }));
  }
  Object.assign(state, await lightSnapshot(w.target, state, true));
  saveState(id, state);
  const s = report.summary;
  addEvent(id, "baseline", s.critical ? "critical" : s.high ? "high" : "ok", `Baseline scan: ${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low`, {
    summary: s,
    reportHash: hash,
    aiUsed: report.ai.used,
  });
  db().prepare("UPDATE watches SET status = 'watching' WHERE id = ?").run(id);
}

/** Cheap change-detection snapshot of whatever this target exposes. */
async function lightSnapshot(targetRaw: string, prev: WatchState, init = false): Promise<Partial<WatchState>> {
  const t = parseTarget(targetRaw);
  const out: Partial<WatchState> = {};
  const repo = t.kind === "github" ? t.repo : t.kind === "project" ? t.project?.repo : undefined;
  const url = t.kind === "url" ? t.url : t.kind === "project" ? t.project?.url : undefined;
  if (repo) {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const ref = repo.ref ?? "HEAD";
    const r = await safeFetchText(`https://api.github.com/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(ref)}`, { headers });
    if (r.status === 200) out.commitSha = JSON.parse(r.text).sha;
  }
  if (url) {
    try {
      const r = await safeFetchText(url, { maxBytes: 1_000_000 });
      out.urlUp = r.status < 500;
      const origin = new URL(r.finalUrl).origin;
      const srcs = [...r.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], r.finalUrl).toString()).filter((u) => new URL(u).origin === origin);
      out.bundleSig = sha([...new Set(srcs)].sort().join("\n"));
    } catch {
      out.urlUp = false;
      out.bundleSig = prev.bundleSig;
    }
  }
  void init;
  return out;
}

const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "none");

async function tick(id: string) {
  const w = db().prepare("SELECT target, interval_min, expires_at FROM watches WHERE id = ?").get(id);
  const now = Date.now();
  if (now >= w.expires_at) {
    db().prepare("UPDATE watches SET active = 0, status = 'ended' WHERE id = ?").run(id);
    addEvent(id, "ended", "ok", "Night Shift ended (watch window elapsed)");
    return;
  }
  const state = loadState(id);
  let needRescan = false;
  const reasons: string[] = [];

  try {
    const next = await lightSnapshot(w.target, state);

    if (next.commitSha && state.commitSha && next.commitSha !== state.commitSha) {
      needRescan = true;
      reasons.push(`new commit ${next.commitSha.slice(0, 7)}`);
      addEvent(id, "commit", "info", `New commit on watched repo: ${next.commitSha.slice(0, 7)}`, { from: state.commitSha, to: next.commitSha });
    }
    if (next.urlUp !== undefined && state.urlUp !== undefined && next.urlUp !== state.urlUp) {
      addEvent(id, next.urlUp ? "url_up" : "url_down", next.urlUp ? "ok" : "high", next.urlUp ? "Live URL is back up" : "Live URL is DOWN (5xx or unreachable)");
      state.changes++;
    }
    if (next.bundleSig && state.bundleSig && next.bundleSig !== state.bundleSig) {
      needRescan = true;
      reasons.push("deployed scripts changed");
      addEvent(id, "deploy", "info", "New frontend deployment detected (script bundle set changed)");
    }
    Object.assign(state, next);

    for (const [key, prev] of Object.entries(state.addrs)) {
      const [cid, addr] = key.split(":") as [string, string];
      const cur = await snapshotAddress(addr as `0x${string}`, Number(cid) as ChainId).catch(() => null);
      if (!cur) continue;
      const diffs: string[] = [];
      let sev: Severity = "medium";
      if (prev.codeHash !== cur.codeHash) diffs.push("runtime code changed");
      if (prev.implementation !== cur.implementation) {
        diffs.push(`proxy implementation ${short(prev.implementation)} → ${short(cur.implementation)}`);
        sev = "critical";
      }
      if (prev.admin !== cur.admin) {
        diffs.push(`proxy admin ${short(prev.admin)} → ${short(cur.admin)}`);
        sev = "critical";
      }
      if (prev.owner !== cur.owner) {
        diffs.push(`owner ${short(prev.owner)} → ${short(cur.owner)}`);
        sev = sev === "critical" ? sev : "high";
      }
      if (diffs.length) {
        addEvent(id, "contract_changed", sev, `Onchain change at ${short(addr)}: ${diffs.join("; ")}`, { address: addr, before: prev, after: cur });
        state.addrs[key] = cur;
        state.changes++;
        needRescan = true;
        reasons.push(`onchain change at ${short(addr)}`);
      }
    }

    if (needRescan) {
      const { report, hash } = await fullScan(w.target);
      const curFps = new Set(report.findings.filter((f) => f.triage?.verdict !== "dismissed").map(fingerprint));
      const prevFps = new Set(state.findingFps);
      const added = report.findings.filter((f) => f.triage?.verdict !== "dismissed" && !prevFps.has(fingerprint(f)));
      const resolved = state.findingFps.filter((fp) => !curFps.has(fp));
      for (const f of added) {
        addEvent(id, "new_finding", f.severity, `New finding after change: ${f.title}`, { file: f.file, line: f.line, evidence: f.evidence, description: f.description, recommendation: f.recommendation, reportHash: hash });
        state.changes++;
      }
      if (resolved.length) addEvent(id, "resolved", "ok", `${resolved.length} earlier finding(s) no longer present`, { fingerprints: resolved });
      if (!added.length && !resolved.length) addEvent(id, "rescan_clean", "ok", `Re-scanned after ${reasons.join(", ")}: no new findings`, { reportHash: hash });
      state.findingFps = [...curFps];
      state.summary = report.summary;
      state.lastReportHash = hash;
      for (const c of report.contractFacts ?? []) {
        if (c.isContract && !state.addrs[`${c.chainId}:${c.address}`]) state.addrs[`${c.chainId}:${c.address}`] = await snapshotAddress(c.address as `0x${string}`, c.chainId).catch(() => ({ address: c.address, isContract: true }));
      }
    }
    state.lastError = undefined;
  } catch (e: any) {
    state.lastError = e.message;
    addEvent(id, "check_failed", "low", `Check failed: ${e.message}`);
  }

  state.checks++;
  state.lastCheckAt = Date.now();
  saveState(id, state);
  db().prepare("UPDATE watches SET next_run = ? WHERE id = ?").run(Date.now() + w.interval_min * 60_000, id);
}

const running = new Set<string>();

/** Run every watch whose time has come. Safe to call from cron or an in-process timer. */
export async function runDueWatches(): Promise<{ ran: number }> {
  const due = db().prepare("SELECT id FROM watches WHERE active = 1 AND status = 'watching' AND next_run <= ?").all(Date.now()) as { id: string }[];
  const todo = due.filter((d) => !running.has(d.id));
  let ran = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const { id } = queue.shift()!;
        running.add(id);
        try {
          await tick(id);
          ran++;
        } finally {
          running.delete(id);
        }
      }
    })
  );
  return { ran };
}
