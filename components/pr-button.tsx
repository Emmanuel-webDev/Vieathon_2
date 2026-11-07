"use client";

import { useEffect, useState } from "react";
import type { Finding } from "@/lib/types";

type Repo = { owner: string; name: string; ref?: string };

export function PrButton({ repo, finding }: { repo: Repo; finding: Finding }) {
  const [session, setSession] = useState<{ configured: boolean; login: string | null } | null>(null);
  const [state, setState] = useState<{ phase: "idle" | "working" | "done" | "error"; url?: string; error?: string }>({ phase: "idle" });

  useEffect(() => {
    fetch("/api/github/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ configured: false, login: null }));
  }, []);

  async function open() {
    console.log(`[NightWatch:PR] Requesting automated fix PR for '${finding.title}' in ${repo.owner}/${repo.name}...`);
    setState({ phase: "working" });
    try {
      const res = await fetch("/api/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo,
          finding: {
            title: finding.title,
            severity: finding.severity,
            file: finding.file,
            line: finding.line,
            description: finding.description,
            recommendation: finding.recommendation,
            patch: finding.patch,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        console.error("[NightWatch:PR Error]", j);
        throw new Error(j.error || `Failed (${res.status})`);
      }
      console.log(`[NightWatch:PR] Fix PR successfully opened at: ${j.url}`);
      setState({ phase: "done", url: j.url });
    } catch (e: any) {
      console.error("[NightWatch:PR Error]", e);
      setState({ phase: "error", error: e.message });
    }
  }

  if (!session) return null;
  if (!session.configured) {
    return <p className="text-xs text-[#8d8b86]">One-click PRs are disabled on this deployment (GitHub OAuth not configured).</p>;
  }
  if (!session.login) {
    return (
      <a href="/api/github/login" className="btn-sharp btn-outline-sharp px-3 py-1.5 inline-block text-[11px]">
        Sign in with GitHub to open a fix PR
      </a>
    );
  }
  return (
    <div className="space-y-1.5 pt-1">
      <button
        onClick={open}
        disabled={state.phase === "working" || state.phase === "done"}
        className="btn-sharp btn-primary-sharp px-3.5 py-1.5 text-[11px] disabled:opacity-50"
      >
        {state.phase === "working" ? "APPLYING PATCH…" : state.phase === "done" ? "PR OPENED ✓" : `OPEN FIX PR AS ${session.login.toUpperCase()}`}
      </button>
      {state.phase === "done" && (
        <div>
          <a href={state.url} target="_blank" rel="noreferrer" className="text-xs text-[#e8741f] underline hover:text-[#ff8630] font-mono">
            View pull request on GitHub →
          </a>
        </div>
      )}
      {state.phase === "error" && <div className="text-xs text-[#ef4444] font-mono">{state.error}</div>}
      <p className="text-[11px] text-[#8d8b86]">Commits to a new isolated branch. Review before merging.</p>
    </div>
  );
}
