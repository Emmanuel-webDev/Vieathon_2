"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Ev = { id: number; ts: number; type: string; severity: string; title: string; detail: any };
type Watch = {
  id: string;
  target: string;
  kind: string;
  interval_min: number;
  created_at: number;
  expires_at: number;
  next_run: number;
  active: number;
  status: string;
  state: { checks: number; changes: number; lastCheckAt?: number; summary?: Record<string, number>; lastError?: string };
  events: Ev[];
};

const SEV: Record<string, string> = {
  critical: "text-[#ef4444] border-red-500/40 bg-red-950/20",
  high: "text-[#f59e0b] border-amber-500/40 bg-amber-950/20",
  medium: "text-[#eab308] border-yellow-500/40 bg-yellow-950/20",
  low: "text-[#9ca3af] border-zinc-600/40 bg-zinc-900/30",
  info: "text-[#efebe3] border-[rgba(239,235,227,0.18)] bg-[#232426]",
  ok: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
};
const INCIDENT = new Set(["critical", "high", "medium", "low"]);

function fmt(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function remaining(ms: number) {
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `${h}h ${m}m left`;
}

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const k = useSearchParams().get("k") ?? "";
  const [w, setW] = useState<Watch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [replay, setReplay] = useState<Ev[] | null>(null);
  const [replayIdx, setReplayIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/watch/${id}?k=${encodeURIComponent(k)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "Watch not found, or the key in the link is wrong." : `Error ${r.status}`);
        if (alive) {
          setW(await r.json());
          setErr(null);
        }
      } catch (e: any) {
        if (alive) setErr(e.message);
      }
    }
    load();
    const poll = setInterval(load, 15_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [id, k]);

  const incidents = useMemo(() => (w?.events ?? []).filter((e) => INCIDENT.has(e.severity)), [w]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const e of incidents) c[e.severity]++;
    return c;
  }, [incidents]);

  function startReplay() {
    if (!w) return;
    const evs = w.events.filter((e) => e.type !== "started");
    setReplay(evs);
    setReplayIdx(0);
    const step = (i: number) => {
      setReplayIdx(i);
      if (i < evs.length) timer.current = setTimeout(() => step(i + 1), 900);
    };
    step(1);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function stop() {
    if (!confirm("Stop this Night Shift?")) return;
    await fetch(`/api/watch/${id}?k=${encodeURIComponent(k)}`, { method: "DELETE" });
    location.reload();
  }

  if (err) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-[#ef4444] font-mono">{err}</p>
        <a href="/" className="mt-4 inline-block text-xs uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3]">← Return to NightWatch</a>
      </main>
    );
  }
  if (!w) return <main className="mx-auto max-w-3xl px-4 py-16 text-center text-xs uppercase tracking-widest text-[#8d8b86]">Loading briefing…</main>;

  const live = w.active === 1 && (w.status === "watching" || w.status === "baselining");
  const total = counts.critical + counts.high + counts.medium + counts.low;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-8 sm:px-6">
      <a href="/" className="text-xs uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3] transition">
        ← Return to NightWatch
      </a>
      <header className="mb-8 mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display uppercase text-4xl sm:text-5xl tracking-tight text-[#efebe3]">
            {live ? "NIGHT SHIFT GUARD" : "MORNING BRIEFING"}
          </h1>
          <span className={`border px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-mono ${
            live ? "border-[#e8741f]/50 bg-[#e8741f]/10 text-[#e8741f]" : "border-[rgba(239,235,227,0.18)] text-[#8d8b86]"
          }`}>
            {w.status === "baselining" ? "RUNNING BASELINE…" : live ? `ACTIVE · ${remaining(w.expires_at - now).toUpperCase()}` : w.status.toUpperCase()}
          </span>
        </div>
        <p className="break-all font-mono text-xs text-[#8d8b86]">{w.target}</p>
      </header>

      {/* Bento Status Grid */}
      <section className="mb-8 grid grid-cols-2 gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)] sm:grid-cols-4">
        {[
          ["01", "Checks Run", w.state.checks],
          ["02", "Changes Detected", w.state.changes],
          ["03", "Incidents", total],
          ["04", "Interval", `${w.interval_min} min`],
        ].map(([num, label, v]) => (
          <div key={String(label)} className="bg-[#232426] p-4 relative">
            <span className="absolute top-3 right-3 text-[11px] font-mono text-[#8d8b86]">{num}</span>
            <div className="text-[11px] uppercase tracking-widest text-[#8d8b86]">{label}</div>
            <div className="font-display text-3xl sm:text-4xl text-[#efebe3] leading-none mt-2">{v}</div>
          </div>
        ))}
      </section>

      {!live && (
        <section className={`mb-8 border p-5 ${total ? "border-[#f59e0b]/40 bg-amber-950/20" : "border-emerald-500/40 bg-emerald-950/20"}`}>
          <div className="mb-1 text-base font-semibold uppercase tracking-wide text-[#efebe3]">
            {total ? `${total} incident${total > 1 ? "s" : ""} recorded while you were away` : "Quiet night — no unauthorized changes or downtime detected"}
          </div>
          <div className="text-xs text-[#8d8b86] leading-relaxed">
            {w.state.checks} check{w.state.checks === 1 ? "" : "s"} ran. {total ? `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.` : "No new vulnerabilities or risky onchain drifts were detected."}
          </div>
        </section>
      )}

      {/* Incident log header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display uppercase text-2xl tracking-wide text-[#efebe3]">
          Timeline Log
        </h2>
        <div className="flex gap-2">
          <button onClick={startReplay} disabled={w.events.length < 2} className="btn-sharp btn-outline-sharp px-3 py-1.5 text-[11px] disabled:opacity-40">
            ▶ REPLAY THE NIGHT
          </button>
          {live && (
            <button onClick={stop} className="btn-sharp px-3 py-1.5 text-[11px] border border-red-500/40 text-[#ef4444] hover:bg-red-950/30">
              STOP
            </button>
          )}
        </div>
      </div>

      {replay && (
        <div className="mb-4 border border-[#e8741f]/40 bg-[#1c1d1f] p-4 font-mono text-xs">
          <div className="mb-2 text-[#8d8b86] text-[11px] uppercase tracking-wider">
            Replay of recorded timeline — {replay.length} step{replay.length === 1 ? "" : "s"}
          </div>
          {replay.slice(0, replayIdx).map((e) => (
            <div key={e.id} className={`py-1 ${INCIDENT.has(e.severity) ? SEV[e.severity].split(" ")[0] : "text-[#8d8b86]"}`}>
              <span className="mr-3 text-[#5c5b57]">{new Date(e.ts).toLocaleTimeString()}</span>
              {INCIDENT.has(e.severity) ? `[${e.severity.toUpperCase()}] ` : ""}{e.title}
            </div>
          ))}
          {replayIdx >= replay.length && <div className="mt-2 text-emerald-400 font-mono">— end of recorded timeline —</div>}
        </div>
      )}

      {/* Vertical Hairline Event List */}
      <ol className="space-y-2">
        {[...w.events].reverse().map((e) => (
          <li key={e.id} className={`border p-4 ${SEV[e.severity] ?? SEV.info}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm font-medium">{e.title}</div>
              <div className="shrink-0 font-mono text-[11px] opacity-70">{fmt(e.ts)}</div>
            </div>
            {e.type === "new_finding" && (
              <div className="mt-2 space-y-1 text-xs text-[#8d8b86]">
                {e.detail.file && <div className="font-mono text-[#efebe3]">{e.detail.file}{e.detail.line ? `:${e.detail.line}` : ""}</div>}
                {e.detail.evidence && <pre className="scroll overflow-x-auto border border-[rgba(239,235,227,0.12)] bg-[#1c1d1f] p-2.5 font-mono text-xs text-[#efebe3]">{e.detail.evidence}</pre>}
                <div>{e.detail.description}</div>
                <div className="text-emerald-400 font-medium">Remediation: {e.detail.recommendation}</div>
              </div>
            )}
            {e.type === "contract_changed" && (
              <pre className="scroll mt-2 overflow-x-auto border border-[rgba(239,235,227,0.12)] bg-[#1c1d1f] p-2.5 font-mono text-[11px] text-[#efebe3]">
{JSON.stringify({ before: e.detail.before, after: e.detail.after }, null, 1)}
              </pre>
            )}
          </li>
        ))}
      </ol>
      {w.state.lastError && <p className="mt-4 text-xs font-mono text-[#f59e0b]">Last check error: {w.state.lastError}</p>}
    </main>
  );
}
