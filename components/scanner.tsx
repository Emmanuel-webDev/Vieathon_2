"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditEvent, AuditReport, Finding, ProjectSpec, Severity } from "@/lib/types";
import { projectRaw } from "@/lib/target";
import { CHAINS } from "@/lib/chains";
import { AttestPanel } from "./attest";
import { PrButton } from "./pr-button";
import { SleepPanel } from "./sleep-panel";
import { ProjectPicker } from "./project-picker";
import { TierPicker, usePayConfig, usePayment } from "./pay";
import { WalletButton } from "./wallet-button";
import { SAMPLES } from "@/lib/samples";

const STAGES: { key: string; label: string }[] = [
  { key: "collect", label: "Collect source" },
  { key: "onchain", label: "Base onchain checks" },
  { key: "static", label: "Static analysis" },
  { key: "ai", label: "AI triage" },
];

export const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-red-950/30 text-red-400 border-red-500/40",
  high: "bg-amber-950/30 text-amber-400 border-amber-500/40",
  medium: "bg-yellow-950/30 text-yellow-400 border-yellow-500/40",
  low: "bg-zinc-900/60 text-zinc-400 border-zinc-600/40",
  info: "bg-cyan-950/30 text-cyan-400 border-cyan-500/40",
};

const INTEGRATIONS = [
  "BASE",
  "SOURCIFY",
  "BLOCKSCOUT",
  "ETHERSCAN",
  "EAS",
  "USDC",
  "GITHUB",
];

const EXAMPLES = [
  { label: "Base USDC", value: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { label: "Base WETH", value: "0x4200000000000000000000000000000000000006" },
];

type Tier = "standard" | "priority" | "deep";
type LogLine = { level: string; message: string; t: number };
type ReportData = { report: AuditReport; hash: `0x${string}`; id: string };

interface RealStats {
  auditsRun: number | null;
  findingsGrounded: number | null;
  watchesActive: number | null;
  attestationsMade: number | null;
}

export function Scanner() {
  const [mode, setMode] = useState<"guard" | "quick">("guard");
  const [tier, setTier] = useState<Tier>("standard");
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stages, setStages] = useState<Record<string, "start" | "done" | "skipped">>({});
  const [report, setReport] = useState<ReportData | null>(null);
  const [guardInfo, setGuardInfo] = useState<{ watchId: string; key: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<RealStats>({
    auditsRun: null,
    findingsGrounded: null,
    watchesActive: null,
    attestationsMade: null,
  });

  const termRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { cfg, refresh: refreshPayCfg } = usePayConfig();
  const pay = usePayment();

  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [logs]);

  function reset() {
    setLogs([]);
    setStages({});
    setReport(null);
    setGuardInfo(null);
    setError(null);
  }

  async function run(targetInput: string, opt?: { orderId?: string; guard?: { hours: number } }) {
    reset();
    setRunning(true);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: targetInput,
          tier,
          orderId: opt?.orderId,
          guard: opt?.guard,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          const jsonStr = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
          try {
            const ev = JSON.parse(jsonStr) as AuditEvent;
            handle(ev);
          } catch {}
        }
      }
      if (buf.trim()) {
        const trimmed = buf.trim();
        const jsonStr = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
        try {
          const ev = JSON.parse(jsonStr) as AuditEvent;
          handle(ev);
        } catch {}
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setRunning(false);
      refreshPayCfg();
    }
  }

  function handle(e: AuditEvent) {
    if (e.type === "log") setLogs((l) => [...l, { level: e.level, message: e.message, t: e.t }]);
    else if (e.type === "stage") setStages((s) => ({ ...s, [e.stage]: e.status }));
    else if (e.type === "finding") setLogs((l) => [...l, { level: "find", message: `[${e.finding.severity.toUpperCase()}] ${e.finding.title}`, t: e.t }]);
    else if (e.type === "report") {
      const hash = ((e as any).reportHash ?? (e as any).hash) as `0x${string}`;
      const id = ((e as any).reportId ?? (e as any).id) as string;
      setReport({ report: e.report, hash, id });
    }
    else if (e.type === "guard") {
      setGuardInfo({ watchId: e.watchId, key: e.key, expiresAt: e.expiresAt });
      try {
        const list = JSON.parse(localStorage.getItem("nw_watches") || "[]");
        list.unshift({ id: e.watchId, secret: e.key, created: Date.now() });
        localStorage.setItem("nw_watches", JSON.stringify(list.slice(0, 20)));
      } catch {}
    } else if (e.type === "error") setError(e.message);
  }

  async function launch(raw: string, guard?: { hours: number }) {
    if (running || paying) return;
    reset();
    if (tier === "standard") return run(raw, { guard });
    setPaying(true);
    try {
      if (!cfg?.enabled) throw new Error("Paid tiers are not available on this deployment.");
      const orderId = await pay.ensureCredit(raw, tier, cfg);
      pay.clearStatus();
      if (tier === "priority") {
        setPaying(false);
        return run(raw, { orderId, guard });
      }
      const r = await fetch("/api/deep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Could not start deep swarm (${r.status})`);
      window.location.href = `/deep/${j.jobId}?k=${j.key}`;
    } catch (e: any) {
      setError((e?.shortMessage || e?.message || "Payment failed").slice(0, 400));
      pay.clearStatus();
    } finally {
      setPaying(false);
    }
  }

  const price = cfg?.tiers.find((t) => t.id === tier)?.price;
  const startLabel = tier === "standard" ? "Start Night Shift Guard" : tier === "priority" ? `Pay ${price ?? ""} USDC & start (priority)` : `Pay ${price ?? ""} USDC & run deep swarm`;
  const busy = running || paying;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      {/* Top Header Bar */}
      <nav className="mb-12 flex items-center justify-between border-b border-[rgba(239,235,227,0.18)] pb-4">
        <div className="flex items-center gap-3">
          <span className="font-display tracking-tight text-xl font-bold uppercase text-[#efebe3]">
            NIGHT<span className="text-[#e8741f]">WATCH</span>
          </span>
          <span className="hidden sm:inline-block border-l border-[rgba(239,235,227,0.18)] pl-3 text-[11px] uppercase tracking-widest text-[#8d8b86]">
            Built on Base · Security Guard
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/verify" className="text-[11px] uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3] transition">
            Verify Report
          </a>
          <WalletButton />
        </div>
      </nav>

      {/* Hero Section */}
      <section className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <div className="mb-3 text-[11px] uppercase tracking-[0.25em] text-[#e8741f] font-mono font-medium">
            01 / GROUNDED AUDIT ENGINE
          </div>
          <h1 className="font-display uppercase text-6xl sm:text-7xl lg:text-8xl tracking-tight leading-none text-[#efebe3]">
            NIGHT<span className="text-[#e8741f] inline-block translate-y-3 sm:translate-y-4">WATCH</span>
          </h1>
        </div>
        <div className="lg:col-span-5 flex flex-col justify-end space-y-4">
          <p className="text-sm sm:text-base leading-relaxed text-[#8d8b86]">
            The security guard for Base builders. Real static analysis, multi-specialist AI triage, and adversarial verification — kept on watch while you sleep.
          </p>
          <div>
            <button
              onClick={() => {
                setMode("guard");
                window.scrollTo({ top: 600, behavior: "smooth" });
              }}
              className="btn-sharp btn-outline-sharp px-5 py-2.5 text-xs font-semibold inline-flex items-center gap-2"
            >
              START NIGHT SHIFT GUARD →
            </button>
          </div>
        </div>
      </section>

      {/* Highlight Pattern */}
      <section className="border-y border-[rgba(239,235,227,0.18)] py-8 my-8 text-xl sm:text-2xl font-light text-[#efebe3] leading-relaxed">
        Every finding is grounded in your <span className="text-[#e8741f] font-normal">code</span>, verified with onchain <span className="text-[#e8741f] font-normal">state</span>, and watched while you <span className="text-[#e8741f] font-normal">sleep</span>.
      </section>

      {/* Real Data Bento Stats Strip */}
      <section className="mb-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)]">
          {/* Cell 01 */}
          <div className="bg-[#232426] p-6 relative flex flex-col justify-between min-h-[140px]">
            <span className="absolute top-4 right-4 text-[11px] font-mono text-[#8d8b86]">01</span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#8d8b86]">Audits Run</div>
              <div className="font-display text-4xl sm:text-5xl text-[#efebe3] leading-none mt-2">
                {stats.auditsRun !== null ? stats.auditsRun : "—"}
              </div>
            </div>
          </div>

          {/* Cell 02 */}
          <div className="bg-[#232426] p-6 relative flex flex-col justify-between min-h-[140px]">
            <span className="absolute top-4 right-4 text-[11px] font-mono text-[#8d8b86]">02</span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#8d8b86]">Findings Grounded</div>
              <div className="font-display text-4xl sm:text-5xl text-[#efebe3] leading-none mt-2">
                {stats.findingsGrounded !== null ? stats.findingsGrounded : "—"}
              </div>
            </div>
          </div>

          {/* Cell 03 */}
          <div className="bg-[#232426] p-6 relative flex flex-col justify-between min-h-[140px]">
            <span className="absolute top-4 right-4 text-[11px] font-mono text-[#8d8b86]">03</span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#8d8b86]">Active Watches</div>
              <div className="font-display text-4xl sm:text-5xl text-[#efebe3] leading-none mt-2">
                {stats.watchesActive !== null ? stats.watchesActive : "—"}
              </div>
            </div>
          </div>

          {/* Cell 04 (Solid Off-White Contrast Cell) */}
          <div className="bg-[#efebe3] p-6 relative flex flex-col justify-between min-h-[140px] text-[#1c1d1f]">
            <span className="absolute top-4 right-4 text-[11px] font-mono text-[#5c5b57]">04</span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#5c5b57] font-semibold">Attestations</div>
              <div className="font-display text-4xl sm:text-5xl text-[#1c1d1f] leading-none mt-2">
                {stats.attestationsMade !== null ? stats.attestationsMade : "—"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Built On Text Grid */}
      <section className="mb-12">
        <div className="text-[11px] uppercase tracking-widest text-[#8d8b86] mb-2 font-mono">
          BUILT ON
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)]">
          {INTEGRATIONS.map((name) => (
            <div key={name} className="bg-[#232426] py-3 px-2 text-center text-xs tracking-widest font-mono text-[#efebe3] font-medium">
              {name}
            </div>
          ))}
        </div>
      </section>

      {/* Tier Selection */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-[11px] uppercase tracking-widest text-[#8d8b86] font-mono">
            SELECT AUDIT TIER
          </div>
          <div className="text-[11px] font-mono text-[#8d8b86]">
            Exploit scenarios are reasoned from the code, not executed.
          </div>
        </div>
        <TierPicker cfg={cfg} tier={tier} onChange={setTier} />
      </section>

      {/* Mode Switcher Tabs */}
      <section className="mb-8">
        <div className="grid grid-cols-2 gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)]" role="tablist">
          {(["guard", "quick"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                className={`py-3 px-4 text-xs uppercase tracking-wider font-semibold transition ${
                  active
                    ? "bg-[#efebe3] text-[#1c1d1f]"
                    : "bg-[#232426] text-[#8d8b86] hover:text-[#efebe3]"
                }`}
              >
                {m === "guard" ? "Guard My Project" : "Quick Scan"}
              </button>
            );
          })}
        </div>
      </section>

      {/* Mode View: Guard vs Quick */}
      {mode === "guard" ? (
        <section className="mb-10">
          <ProjectPicker
            busy={busy}
            startLabel={startLabel}
            onStart={(spec: ProjectSpec, g) => {
              try {
                void launch(projectRaw(spec), g.enabled ? { hours: g.hours } : undefined);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          />
        </section>
      ) : (
        <section className="mb-10">
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void launch(target.trim());
            }}
            className="mb-4 flex flex-col gap-2 sm:flex-row"
          >
            <label htmlFor="target" className="sr-only">Contract address, GitHub repo, or app URL</label>
            <input
              id="target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0x… Base contract  ·  github.com/owner/repo  ·  https://your-dapp.xyz"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-4 py-3 font-mono text-sm text-[#efebe3] placeholder:text-[#5c5b57] focus:border-[#e8741f] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !target.trim()}
              className="btn-sharp btn-primary-sharp px-6 py-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "WORKING…" : tier === "standard" ? "SCAN NOW" : tier === "priority" ? `PAY ${price ?? ""} USDC & SCAN` : `PAY ${price ?? ""} USDC & DEEP SCAN`}
            </button>
          </form>

          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[#8d8b86]">
            <span className="text-[11px] uppercase tracking-wider font-mono">Verified Base Contracts:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.value}
                onClick={() => { setTarget(ex.value); void launch(ex.value); }}
                disabled={busy}
                className="border border-[rgba(239,235,227,0.18)] px-2 py-0.5 text-xs text-[#efebe3] hover:border-[#e8741f] disabled:opacity-40"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-4">
            <div className="mb-2 text-xs text-[#8d8b86]">
              <span className="font-semibold uppercase tracking-wider text-[11px] text-[#efebe3] mr-2">Judge Sandbox:</span>
              Intentionally vulnerable testbeds (always free). Evaluated through the exact same grounded pipeline.
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => run(`sample:${s.id}`)}
                  disabled={busy}
                  title={s.blurb}
                  className="btn-sharp btn-outline-sharp px-3 py-1.5 text-[11px] disabled:opacity-40"
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Status & Error Alerts */}
      {pay.status && (
        <div className="mb-6 border border-[#e8741f]/40 bg-[#2a2b2e] p-4 text-xs font-mono text-[#efebe3]" role="status">
          {pay.status}
        </div>
      )}
      {error && !running && logs.length === 0 && (
        <div className="mb-6 border border-red-500/40 bg-red-950/20 p-4 text-xs font-mono text-[#ef4444]" role="alert">
          {error}
        </div>
      )}

      {/* Terminal Progress Log */}
      {(running || logs.length > 0) && (
        <section aria-label="Scan progress" className="mb-10 border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[rgba(239,235,227,0.18)] bg-[#232426] px-4 py-2.5 text-xs uppercase tracking-wider font-mono">
            {STAGES.map((s) => {
              const st = stages[s.key];
              return (
                <span
                  key={s.key}
                  className={
                    st === "done"
                      ? "text-emerald-400"
                      : st === "start"
                      ? "text-[#e8741f]"
                      : st === "skipped"
                      ? "text-[#5c5b57] line-through"
                      : "text-[#5c5b57]"
                  }
                >
                  {st === "done" ? "✓" : st === "start" ? "◐" : st === "skipped" ? "–" : "○"} {s.label}
                </span>
              );
            })}
          </div>
          <div
            ref={termRef}
            className={`term max-h-72 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed text-[#efebe3] ${running ? "scan-line" : ""}`}
            role="log"
            aria-live="polite"
          >
            {logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "error"
                    ? "text-[#ef4444]"
                    : l.level === "warn"
                    ? "text-[#f59e0b]"
                    : l.level === "ok"
                    ? "text-emerald-400"
                    : l.level === "find"
                    ? "text-[#e8741f]"
                    : "text-[#8d8b86]"
                }
              >
                <span className="mr-3 select-none text-[#5c5b57]">{(l.t / 1000).toFixed(1).padStart(5, " ")}s</span>
                {l.message}
              </div>
            ))}
            {running && <div className="caret text-[#8d8b86]" />}
            {error && <div className="mt-2 text-[#ef4444]">✗ {error}</div>}
          </div>
        </section>
      )}

      {/* Night Shift Guard Confirmation Banner */}
      {guardInfo && (
        <div className="mb-10 border border-emerald-500/40 bg-emerald-950/20 p-5 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-wider text-emerald-300">
            🌙 Night Shift is on until {new Date(guardInfo.expiresAt).toLocaleString()}
          </div>
          <p className="mb-3 text-[#8d8b86] leading-relaxed">
            This scan establishes the security baseline. NightWatch continuously monitors commits, deployments, and onchain state, re-scanning when drift occurs.
          </p>
          <a
            href={`/watch/${guardInfo.watchId}?k=${guardInfo.key}`}
            className="btn-sharp btn-primary-sharp px-4 py-2 text-xs inline-block"
          >
            OPEN MY MORNING BRIEFING →
          </a>
        </div>
      )}

      {/* Completed Audit Report */}
      {report && <ReportPanel data={report} hideSleep={!!guardInfo} />}
    </div>
  );
}

export function ReportPanel({ data, hideSleep }: { data: ReportData; hideSleep?: boolean }) {
  const [showDismissed, setShowDismissed] = useState(false);
  return <ReportView data={data} showDismissed={showDismissed} setShowDismissed={setShowDismissed} hideSleep={hideSleep} />;
}

function ReportView({
  data,
  showDismissed,
  setShowDismissed,
  hideSleep,
}: {
  data: ReportData;
  showDismissed: boolean;
  setShowDismissed: (v: boolean) => void;
  hideSleep?: boolean;
}) {
  const { report, hash } = data;
  const visible = useMemo(() => report.findings.filter((f) => showDismissed || f.triage?.verdict !== "dismissed"), [report, showDismissed]);
  const dismissedCount = report.findings.filter((f) => f.triage?.verdict === "dismissed").length;
  const s = report.summary;
  const fixRepo = report.target.kind === "github" ? report.target.repo : report.target.kind === "project" ? report.target.project?.repo : undefined;

  function download() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nightwatch-report-${hash.slice(2, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section aria-label="Audit report" className="space-y-6 pt-4 border-t border-[rgba(239,235,227,0.18)]">
      {/* Tier Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-[#8d8b86] font-mono">REPORT TIER:</span>
          <span className="border border-[rgba(239,235,227,0.18)] bg-[#232426] px-3 py-1 text-xs uppercase tracking-wider font-semibold text-[#efebe3]">
            {report.tier === "partial-deep" || report.deep?.status === "partial"
              ? "PARTIAL DEEP SWARM"
              : report.tier === "deep"
              ? "DEEP SWARM REPORT"
              : report.tier === "priority"
              ? "PRIORITY AUDIT"
              : "STANDARD AUDIT"}
          </span>
          <span className="border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-2.5 py-1 text-[11px] font-mono text-[#8d8b86]">
            {report.ai.used
              ? `AI: ${(report.ai.provider ?? "unknown").toUpperCase()} / ${report.ai.model ?? "unknown"}`
              : `AI: STATIC ONLY (${report.ai.provider ? `${report.ai.provider.toUpperCase()} / ${report.ai.model ?? ""}` : "unconfirmed"})`}
          </span>
        </div>
        <div className="text-[11px] font-mono text-[#8d8b86]">
          HASH: {hash.slice(0, 10)}…{hash.slice(-8)}
        </div>
      </div>

      {report.ai.skippedReason && (
        <div className="border border-amber-500/40 bg-amber-950/20 p-3 text-xs font-mono text-amber-300">
          {report.ai.skippedReason}
        </div>
      )}

      <div className="border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-4 py-2.5 text-xs font-mono text-[#8d8b86]">
        Note: Exploit scenarios are reasoned from the code, not executed.
      </div>

      {/* Severity Counters Hairline Grid */}
      <div className="grid grid-cols-2 gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)] sm:grid-cols-5">
        {(["critical", "high", "medium", "low", "info"] as Severity[]).map((k) => (
          <div key={k} className="bg-[#232426] p-4 text-left">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-widest mb-1">
              <span className={`font-semibold ${SEV_STYLE[k].split(" ")[1]}`}>{k}</span>
            </div>
            <div className="font-display text-4xl text-[#efebe3] leading-none">{s[k]}</div>
          </div>
        ))}
      </div>

      {/* Deep Swarm Status Box */}
      {report.deep && (
        <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-5 text-xs text-[#8d8b86]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-semibold text-[#efebe3]">
            <span>
              {report.deep.status === "partial" ? "PARTIAL SWARM SUMMARY (DEGRADED)" : "DEEP SWARM REVIEW"} · {Math.round(report.deep.durationMs / 1000)}s · {report.deep.provider ? `${report.deep.provider.toUpperCase()} / ` : ""}{report.deep.model}
            </span>
            {report.deep.status === "partial" ? (
              <span className="border border-amber-500/40 bg-amber-950/20 px-2.5 py-0.5 text-[11px] font-mono text-amber-300">
                PARTIAL ({report.deep.stages?.specialistsSucceeded ?? 0}/{report.deep.stages?.specialistsTotal ?? 0} lenses)
              </span>
            ) : (
              <span className="border border-emerald-500/40 bg-emerald-950/20 px-2.5 py-0.5 text-[11px] font-mono text-emerald-300">
                ALL {report.deep.stages?.specialistsTotal ?? report.deep.agents.length} LENSES COMPLETED
              </span>
            )}
          </div>
          <ul className="mb-3 space-y-1.5 font-mono">
            {report.deep.agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                {a.error || a.status === "failed" ? (
                  <span className="text-[#f59e0b]">❌ {a.label}: failed ({a.error || "failed"})</span>
                ) : (
                  <span className="text-[#efebe3]">✓ {a.label}: {a.kept} grounded candidate(s) ({a.candidates} raw)</span>
                )}
              </li>
            ))}
          </ul>
          <div className="pt-2 border-t border-[rgba(239,235,227,0.1)] text-[#efebe3]">
            {report.deep.stages?.verifierRan ? (
              <>Adversarial verifier evaluated {report.deep.verified} finding(s): <span className="text-[#ef4444] font-semibold">{report.deep.exploitable} exploitable</span>, <span className="text-[#f59e0b] font-semibold">{report.deep.conditional} conditional</span>, {report.deep.notExploitable} not exploitable.</>
            ) : (
              <span className="text-[#8d8b86]">Adversarial verifier was not executed.</span>
            )}
          </div>
        </div>
      )}

      {/* Onchain Facts */}
      {report.contractFacts?.length ? (
        <details className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-4 text-xs" open>
          <summary className="cursor-pointer font-semibold uppercase tracking-wider text-[11px] text-[#efebe3]">
            Onchain State Facts (Direct Base RPC Read)
          </summary>
          <div className="mt-3 space-y-2">
            {report.contractFacts.map((c) => (
              <div key={`${c.chainId}:${c.address}`} className="border border-[rgba(239,235,227,0.1)] bg-[#1c1d1f] p-3 font-mono text-xs leading-6 text-[#8d8b86]">
                <div className="text-[#efebe3]">
                  {c.contractName ?? "Contract"} <span className="text-[#5c5b57]">{c.address}</span>{" "}
                  <a href={`${CHAINS[c.chainId].explorer}/address/${c.address}`} target="_blank" rel="noreferrer" className="text-[#e8741f] underline hover:text-[#ff8630]">
                    {CHAINS[c.chainId].name} Explorer →
                  </a>
                </div>
                <div>Bytecode size: {c.codeSizeBytes.toLocaleString()} bytes · Verified: {c.verifiedSource ? `yes (${c.sourceProvider})` : "no"}{c.compiler ? ` · ${c.compiler}` : ""}</div>
                {c.isProxy && <div>Proxy implementation: {c.implementation ?? "beacon"}{c.admin ? ` · Admin: ${c.admin}` : ""}</div>}
                {c.owner && <div>Owner: {c.owner} ({c.ownerIsContract ? "contract" : /^0x0{40}$/.test(c.owner) ? "renounced" : "EOA"})</div>}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* Findings Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 className="font-display uppercase text-2xl tracking-wide text-[#efebe3]">
          Audit Findings <span className="text-[#8d8b86] text-lg">({visible.length})</span>
        </h2>
        {dismissedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#8d8b86]">
            <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-[#e8741f]" />
            Show {dismissedCount} dismissed false positive{dismissedCount > 1 ? "s" : ""}
          </label>
        )}
      </div>

      {/* Finding Cards */}
      {visible.length === 0 ? (
        <div className="border border-emerald-500/40 bg-emerald-950/20 p-5 text-xs text-emerald-300">
          No vulnerabilities found from active checks. Note limitations below.
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((f) => (
            <FindingCard key={f.id} f={f} repo={fixRepo} />
          ))}
        </div>
      )}

      {/* Limitations Card */}
      <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-5 text-xs leading-relaxed text-[#8d8b86]">
        <div className="mb-2 font-semibold uppercase tracking-wider text-[11px] text-[#efebe3]">Limitations & Integrity</div>
        <ul className="list-inside list-disc space-y-1">
          {report.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <div className="mt-3 break-all font-mono text-[11px] text-[#5c5b57] pt-2 border-t border-[rgba(239,235,227,0.1)]">
          {report.filesAnalyzed.length} files analyzed · Scanned {new Date(report.scannedAt).toUTCString()} · Provider/Model: {report.ai.provider}/{report.ai.model} ({report.ai.used ? "active" : "skipped"})
          {report.deep ? ` · Deep Model: ${report.deep.provider ?? report.ai.provider}/${report.deep.model}` : ""}<br />
          Keccak256 Report Hash: {hash}
        </div>
      </div>

      {/* Attestation & Sleep Panels */}
      {report.target.kind !== "sample" && <AttestPanel report={report} reportHash={hash} />}
      {report.target.kind !== "sample" && !hideSleep && <SleepPanel report={report} />}

      {/* Action Footer */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button onClick={download} className="btn-sharp btn-outline-sharp px-4 py-2 text-xs">
          DOWNLOAD REPORT JSON
        </button>
        <a href="/verify" className="btn-sharp btn-outline-sharp px-4 py-2 text-xs">
          VERIFY ONCHAIN HASH →
        </a>
      </div>
    </section>
  );
}

function FindingCard({ f, repo }: { f: Finding; repo?: { owner: string; name: string; ref?: string } }) {
  const [open, setOpen] = useState(f.severity === "critical" || f.severity === "high");
  const dismissed = f.triage?.verdict === "dismissed";

  return (
    <article className={`border border-[rgba(239,235,227,0.18)] bg-[#232426] ${dismissed ? "opacity-60" : ""}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-4 p-4 text-left transition hover:bg-[#28292c]">
        <span className={`mt-0.5 shrink-0 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEV_STYLE[f.severity]}`}>
          {f.severity}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[#efebe3] text-sm">{f.title}</span>
          <span className="mt-1 block truncate font-mono text-xs text-[#8d8b86]">
            {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.category} · {f.origin}
            {f.triage && ` · ${f.triage.verdict}`}
            {f.exploit && ` · ${f.exploit.verdict.replace("_", " ")}`}
            {f.corroboratedBy && f.corroboratedBy.length > 1 && ` · ${f.corroboratedBy.length} agents agree`}
          </span>
        </span>
        <span className="font-mono text-sm text-[#8d8b86]">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[rgba(239,235,227,0.18)] p-4 text-xs leading-relaxed">
          {f.evidence && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-[#8d8b86] font-mono">Quoted Evidence:</span>
              <pre className="scroll overflow-x-auto border border-[rgba(239,235,227,0.12)] bg-[#1c1d1f] p-3 font-mono text-xs text-[#efebe3]">
                {f.evidence}
              </pre>
            </div>
          )}

          <p className="text-[#efebe3] text-xs leading-relaxed">{f.description}</p>

          {f.triage && (
            <div className="text-[#8d8b86] border-l-2 border-[rgba(239,235,227,0.18)] pl-3">
              <span className="font-semibold text-[#efebe3] uppercase tracking-wider text-[11px]">AI Triage ({f.triage.verdict}):</span> {f.triage.reason}
            </div>
          )}

          {f.exploit && (
            <div className={`border p-3 text-xs ${
              f.exploit.verdict === "not_exploitable"
                ? "border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] text-[#8d8b86]"
                : "border-red-500/30 bg-red-950/20 text-[#efebe3]"
            }`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1 border-b border-[rgba(239,235,227,0.1)] pb-1.5">
                <span className={`font-semibold uppercase tracking-wider text-[11px] ${
                  f.exploit.verdict === "not_exploitable" ? "text-[#8d8b86]" : "text-[#ef4444]"
                }`}>
                  Adversarial Verifier ({f.exploit.verdict.replace("_", " ")})
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#8d8b86]">
                  Exploit scenarios are reasoned from the code, not executed.
                </span>
              </div>
              <div className="mb-2 space-y-0.5 rounded bg-[rgba(0,0,0,0.2)] p-2 font-mono text-[11px]">
                <div><span className="text-[#8d8b86]">Attacker:</span> <span className="text-[#efebe3]">{f.exploit.attacker ?? "—"}</span></div>
                <div><span className="text-[#8d8b86]">Gain:</span> <span className="text-[#e8741f]">{f.exploit.gain ?? "none"}</span></div>
                <div><span className="text-[#8d8b86]">Victim:</span> <span className="text-[#efebe3]">{f.exploit.victim ?? "none"}</span></div>
              </div>
              {f.exploit.preconditions && <div className="mb-1 text-[#8d8b86]">Preconditions: {f.exploit.preconditions}</div>}
              {f.exploit.steps && f.exploit.steps.length > 0 && (
                <ol className="list-inside list-decimal space-y-1 text-[#efebe3]">
                  {f.exploit.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
              {f.exploit.impact && <div className="mt-1 text-[#8d8b86]">Impact: {f.exploit.impact}</div>}
            </div>
          )}

          <p className="text-[#8d8b86]">
            <span className="font-semibold text-emerald-400 uppercase tracking-wider text-[11px]">Remediation:</span> {f.recommendation}
          </p>

          {f.patch && (
            <details className="pt-1">
              <summary className="cursor-pointer font-mono text-[11px] text-[#e8741f] hover:underline">Suggested patch diff</summary>
              <pre className="scroll mt-2 overflow-x-auto border border-[rgba(239,235,227,0.12)] bg-[#1c1d1f] p-3 font-mono text-xs">
                {f.patch.split("\n").map((l, i) => (
                  <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-emerald-400" : l.startsWith("-") && !l.startsWith("---") ? "text-[#ef4444]" : "text-[#8d8b86]"}>{l || " "}</div>
                ))}
              </pre>
            </details>
          )}

          {repo && f.patch && f.file && !dismissed && <PrButton repo={repo} finding={f} />}
        </div>
      )}
    </article>
  );
}
