"use client";

import { useState } from "react";
import type { AuditReport } from "@/lib/types";

export function SleepPanel({ report }: { report: AuditReport }) {
  const [hours, setHours] = useState(10);
  const [intervalMin, setIntervalMin] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: report.target.raw, hours, intervalMin }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      try {
        const list = JSON.parse(localStorage.getItem("nw_watches") || "[]");
        list.unshift({ id: j.id, secret: j.secret, target: report.target.raw, created: Date.now() });
        localStorage.setItem("nw_watches", JSON.stringify(list.slice(0, 20)));
      } catch {
        /* storage unavailable: the URL itself carries the key */
      }
      window.location.href = `/watch/${j.id}?k=${j.secret}`;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-5">
      <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#efebe3]">
        🌙 Going to sleep? Start Night Shift
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[#8d8b86]">
        NightWatch takes this scan as the baseline, then keeps checking while you&apos;re away: new commits, redeploys, downtime, and Base contract changes (code, proxy implementation, admin, owner). When something changes it re-scans and notifies you with exact diffs.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] uppercase tracking-wider text-[#8d8b86]">
          Watch for
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-1 block rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-3 py-1.5 text-xs text-[#efebe3] focus:border-[#e8741f] focus:outline-none">
            {[8, 10, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
        <label className="text-[11px] uppercase tracking-wider text-[#8d8b86]">
          Check every
          <select value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} className="mt-1 block rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-3 py-1.5 text-xs text-[#efebe3] focus:border-[#e8741f] focus:outline-none">
            {[30, 60, 180].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <button
          onClick={start}
          disabled={busy}
          className="btn-sharp btn-primary-sharp px-4 py-2 text-xs font-bold disabled:opacity-50"
        >
          {busy ? "STARTING…" : "START NIGHT SHIFT"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-[#ef4444] font-mono">{error}</div>}
    </div>
  );
}
