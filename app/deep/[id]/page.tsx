"use client";

import { use, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditReport } from "@/lib/types";
import { ReportPanel } from "@/components/scanner";

type Job = {
  id: string;
  target: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  report?: AuditReport;
  hash?: `0x${string}`;
  events: { id: number; ts: number; level: string; message: string }[];
};

export default function DeepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const k = useSearchParams().get("k") ?? "";
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const r = await fetch(`/api/deep/${id}?k=${encodeURIComponent(k)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "Job not found, or the key in the link is wrong." : `Error ${r.status}`);
        const j: Job = await r.json();
        if (!alive) return;
        setJob(j);
        setErr(null);
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, 4000);
      } catch (e: any) {
        if (alive) {
          setErr(e.message);
          timer = setTimeout(load, 10_000);
        }
      }
    }
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, k]);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [job?.events.length]);

  if (err && !job) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-[#ef4444] font-mono">{err}</p>
        <a href="/" className="mt-4 inline-block text-xs uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3]">← Return to NightWatch</a>
      </main>
    );
  }
  if (!job) return <main className="mx-auto max-w-3xl px-4 py-16 text-center text-xs uppercase tracking-widest text-[#8d8b86]">Loading deep swarm job…</main>;
  const live = job.status === "queued" || job.status === "running";

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
      <a href="/" className="text-xs uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3] transition">
        ← Return to NightWatch
      </a>
      <header className="mb-8 mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display uppercase text-4xl sm:text-5xl tracking-tight text-[#efebe3]">
            DEEP SWARM <span className="text-[#e8741f]">AUDIT</span>
          </h1>
          <span className={`border px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-mono ${
            live
              ? "border-[#e8741f]/50 bg-[#e8741f]/10 text-[#e8741f]"
              : job.status === "done"
              ? "border-emerald-500/40 text-emerald-300 bg-emerald-950/20"
              : job.status === "partial"
              ? "border-amber-500/40 text-amber-300 bg-amber-950/20"
              : "border-red-500/40 text-[#ef4444] bg-red-950/20"
          }`}>
            {live ? "SPECIALISTS EXECUTING…" : job.status === "partial" ? "PARTIAL (SOME LENSES DEGRADED)" : job.status.toUpperCase()}
          </span>
        </div>
        <p className="break-all font-mono text-xs text-[#8d8b86]">{job.target.startsWith("project:") ? "project" : job.target}</p>
        <p className="mt-1 font-mono text-[11px] text-[#8d8b86]">Exploit scenarios are reasoned from the code, not executed.</p>
        {live && <p className="mt-2 text-xs text-[#8d8b86]">Runs in the background. You may safely bookmark this page or close the tab.</p>}
      </header>

      {/* Terminal progress log */}
      <section className="mb-8 border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f]">
        <div className="border-b border-[rgba(239,235,227,0.18)] bg-[#232426] px-4 py-2 text-[11px] uppercase tracking-widest text-[#8d8b86] font-mono">
          EXECUTION TIMELINE
        </div>
        <div ref={termRef} className={`term max-h-80 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed text-[#efebe3] ${live ? "scan-line" : ""}`} role="log" aria-live="polite">
          {job.events.map((e) => (
            <div key={e.id} className={e.level === "error" ? "text-[#ef4444]" : e.level === "warn" ? "text-[#f59e0b]" : e.level === "ok" ? "text-emerald-400" : "text-[#8d8b86]"}>
              <span className="mr-3 select-none text-[#5c5b57]">{new Date(e.ts).toLocaleTimeString()}</span>
              {e.message}
            </div>
          ))}
          {live && <div className="caret text-[#8d8b86]" />}
        </div>
      </section>

      {job.error && (
        <div className="mb-8 border border-red-500/40 bg-red-950/20 p-4 text-xs font-mono text-[#ef4444]">
          {job.error}
        </div>
      )}

      {job.report && job.hash && (
        <ReportPanel data={{ report: job.report, hash: job.hash, id: job.id }} hideSleep={true} />
      )}
    </main>
  );
}
