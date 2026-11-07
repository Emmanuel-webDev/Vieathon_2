"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChainId, ProjectSpec } from "@/lib/types";

interface Repo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  pushedAt: string | null;
  homepage: string | null;
}
interface DetContract {
  address: `0x${string}`;
  chainId?: ChainId;
  name?: string;
  source: string;
  verified: boolean;
  selected: boolean;
}
interface Detected {
  repo: { owner: string; name: string; defaultBranch: string; private: boolean; description?: string };
  frameworks: string[];
  liveUrls: { url: string; source: string }[];
  contracts: Omit<DetContract, "selected">[];
  notes: string[];
  ignoredAddresses: number;
}

const CHAIN_NAME: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia" };

function parseRepoInput(v: string): { owner: string; name: string } | null {
  const m = v.trim().match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

export function ProjectPicker({
  busy,
  startLabel,
  onStart,
}: {
  busy: boolean;
  startLabel: string;
  onStart: (spec: ProjectSpec, guard: { enabled: boolean; hours: number }) => void;
}) {
  const [session, setSession] = useState<{ configured: boolean; login: string | null } | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [contracts, setContracts] = useState<DetContract[]>([]);
  const [manualContract, setManualContract] = useState("");
  const [guard, setGuard] = useState(true);
  const [hours, setHours] = useState(10);

  useEffect(() => {
    fetch("/api/github/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (s) => {
        setSession(s);
        if (s.login) {
          const r = await fetch("/api/github/repos", { cache: "no-store" });
          const j = await r.json();
          if (r.ok) setRepos(j.repos);
          else setReposError(j.error);
        }
      })
      .catch(() => setSession({ configured: false, login: null }));
  }, []);

  const shown = useMemo(() => repos.filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 200), [repos, filter]);

  async function detect(owner: string, name: string) {
    setDetecting(true);
    setDetected(null);
    setDetectError(null);
    setContracts([]);
    setUrl("");
    try {
      const r = await fetch("/api/github/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Detection failed (${r.status})`);
      const d = j as Detected;
      setDetected(d);
      setUrl(d.liveUrls[0]?.url ?? "");
      setContracts(d.contracts.map((c) => ({ ...c, selected: c.verified || c.source !== "README mention" })));
    } catch (e: any) {
      setDetectError(e.message);
    } finally {
      setDetecting(false);
    }
  }

  function pickRepo(fullName: string) {
    setRepoInput(fullName);
    const p = parseRepoInput(fullName);
    if (p) void detect(p.owner, p.name);
  }

  const manual = /^0x[a-fA-F0-9]{40}$/.test(manualContract.trim()) ? (manualContract.trim() as `0x${string}`) : null;
  const repoParsed = parseRepoInput(repoInput);
  const spec: ProjectSpec = {
    ...(repoParsed ? { repo: { owner: repoParsed.owner, name: repoParsed.name } } : {}),
    ...(url.trim() ? { url: url.trim() } : {}),
    contracts: [
      ...contracts.filter((c) => c.selected).map((c) => ({ address: c.address, ...(c.chainId ? { chainId: c.chainId } : {}) })),
      ...(manual && !contracts.some((c) => c.address.toLowerCase() === manual.toLowerCase()) ? [{ address: manual }] : []),
    ],
  };
  const ready = !!spec.repo || !!spec.url || !!spec.contracts?.length;
  const isPrivate = detected?.repo.private;

  return (
    <div className="space-y-4">
      {/* GitHub connection */}
      <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-4">
        {session === null ? (
          <p className="text-xs text-[#8d8b86]">Checking GitHub connection…</p>
        ) : session.login ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#efebe3]">Connected to GitHub as <span className="font-mono text-[#e8741f]">{session.login}</span></span>
              <button onClick={() => fetch("/api/github/session", { method: "DELETE" }).then(() => location.reload())} className="text-[#8d8b86] underline hover:text-[#efebe3] text-xs">disconnect</button>
            </div>
            {reposError ? (
              <p className="text-xs text-[#ef4444]">{reposError}</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your repos…" aria-label="Filter repositories" className="rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-3 py-2 text-sm text-[#efebe3] placeholder:text-[#5c5b57] sm:w-48 focus:border-[#e8741f] focus:outline-none" />
                <select value="" onChange={(e) => e.target.value && pickRepo(e.target.value)} aria-label="Pick a repository" className="min-w-0 flex-1 rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-3 py-2 text-sm text-[#efebe3] focus:border-[#e8741f] focus:outline-none">
                  <option value="">{repos.length ? `Select repository (${repos.length} available)…` : "Loading repos…"}</option>
                  {shown.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.fullName}{r.private ? " 🔒" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : session.configured ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-[#8d8b86]">Connect GitHub to pick from your repositories:</span>
            <a href="/api/github/login" className="btn-sharp btn-outline-sharp px-3 py-1.5 inline-block text-[11px]">Public repos</a>
            <a href="/api/github/login?private=1" className="btn-sharp btn-outline-sharp px-3 py-1.5 inline-block text-[11px]">Include private repos</a>
          </div>
        ) : (
          <p className="text-xs text-[#8d8b86]">GitHub OAuth not configured on this host. You can paste any public repo directly below.</p>
        )}
      </div>

      {/* Repo (works without signing in, for public repos) */}
      <div>
        <label htmlFor="repo" className="mb-1 block text-[11px] uppercase tracking-widest text-[#8d8b86]">GitHub repository (owner/name or URL)</label>
        <div className="flex gap-2">
          <input id="repo" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && repoParsed) void detect(repoParsed.owner, repoParsed.name); }} placeholder="username/my-vibeathon-app" spellCheck={false} className="min-w-0 flex-1 rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-4 py-2.5 font-mono text-sm text-[#efebe3] placeholder:text-[#5c5b57] focus:border-[#e8741f] focus:outline-none" />
          <button onClick={() => repoParsed && detect(repoParsed.owner, repoParsed.name)} disabled={!repoParsed || detecting} className="btn-sharp btn-outline-sharp px-4 text-xs font-semibold disabled:opacity-40">
            {detecting ? "DETECTING…" : "AUTO-DETECT"}
          </button>
        </div>
      </div>

      {detectError && <p className="text-xs text-[#ef4444] font-mono">{detectError}</p>}
      {detected && (
        <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-3 text-xs text-[#8d8b86]">
          <div className="mb-1 text-[#efebe3]">
            Detected in <span className="font-mono text-[#e8741f]">{detected.repo.owner}/{detected.repo.name}</span>
            {detected.frameworks.length ? ` · ${detected.frameworks.join(" + ")}` : ""}
            {detected.repo.private ? " · private" : ""}
          </div>
          <div>
            {detected.liveUrls.length ? `${detected.liveUrls.length} live URL candidate(s)` : "No live URL found"} · {detected.contracts.length ? `${detected.contracts.length} deployed contract(s)` : "no deployed contracts found"}
            {detected.ignoredAddresses ? ` · ${detected.ignoredAddresses} address(es) ignored (not deployed on Base / Base Sepolia)` : ""}
          </div>
          {detected.notes.map((n, i) => <div key={i} className="text-[#5c5b57]">{n}</div>)}
        </div>
      )}

      {/* Live app URL */}
      <div>
        <label htmlFor="liveurl" className="mb-1 block text-[11px] uppercase tracking-widest text-[#8d8b86]">Live app URL (optional)</label>
        <input id="liveurl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-app.vercel.app" spellCheck={false} className="w-full rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-4 py-2.5 font-mono text-sm text-[#efebe3] placeholder:text-[#5c5b57] focus:border-[#e8741f] focus:outline-none" />
        {detected && detected.liveUrls.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            <span className="text-[#8d8b86] text-[11px] uppercase tracking-wider mr-1">Suggestions:</span>
            {detected.liveUrls.map((u) => (
              <button key={u.url} onClick={() => setUrl(u.url)} className="border border-[rgba(239,235,227,0.18)] px-2 py-0.5 font-mono text-[11px] text-[#efebe3] hover:border-[#e8741f]" title={u.source}>{u.url.replace(/^https?:\/\//, "")}</button>
            ))}
          </div>
        )}
      </div>

      {/* Contracts */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-widest text-[#8d8b86]">Base contracts</div>
        {contracts.length > 0 && (
          <ul className="mb-2 space-y-1">
            {contracts.map((c, i) => (
              <li key={c.address} className="flex items-center gap-2 border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-3 py-2 text-xs">
                <input type="checkbox" checked={c.selected} onChange={(e) => setContracts((cs) => cs.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} className="accent-[#e8741f]" aria-label={`Include ${c.address}`} />
                <span className="font-mono text-[#efebe3]">{c.address.slice(0, 10)}…{c.address.slice(-6)}</span>
                {c.name && <span className="text-[#8d8b86]">{c.name}</span>}
                <span className="ml-auto text-[#8d8b86]">{c.chainId ? CHAIN_NAME[c.chainId] : "Base"} · {c.source}{c.verified ? "" : " · unverified onchain"}</span>
              </li>
            ))}
          </ul>
        )}
        <input value={manualContract} onChange={(e) => setManualContract(e.target.value)} placeholder="Paste a Base contract address (optional). Mainnet or Sepolia is detected automatically" spellCheck={false} aria-label="Contract address" className="w-full rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-4 py-2.5 font-mono text-sm text-[#efebe3] placeholder:text-[#5c5b57] focus:border-[#e8741f] focus:outline-none" />
      </div>

      {/* Guard */}
      <div className="flex flex-wrap items-center gap-4 border border-[rgba(239,235,227,0.18)] bg-[#232426] p-3 text-xs text-[#efebe3]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={guard && !isPrivate} disabled={!!isPrivate} onChange={(e) => setGuard(e.target.checked)} className="accent-[#e8741f]" />
          <span className="font-medium">Keep guarding while I sleep (Night Shift)</span>
        </label>
        <label className="flex items-center gap-2 text-[#8d8b86]">
          for
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!guard || !!isPrivate} className="rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] px-2 py-1 text-[#efebe3] focus:border-[#e8741f] focus:outline-none">
            {[8, 10, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </select>
        </label>
        {isPrivate && <span className="text-[#8d8b86]">Private repos get a one-time scan: continuous watch would require storing your OAuth token.</span>}
      </div>

      {isPrivate && (
        <div className="border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <div className="font-semibold text-amber-100 uppercase tracking-wider text-[11px]">🔒 Private Repository Privacy Notice</div>
          <p className="mt-1 leading-relaxed">
            Source code is sent to your configured AI provider ({process.env.NEXT_PUBLIC_AI_LABEL || "Google Gemini"}) for vulnerability analysis. Private repository scans require <code className="bg-[#1c1d1f] px-1 py-0.5 text-amber-300 font-mono">NIGHTWATCH_ALLOW_PRIVATE=1</code> on the host to ensure compliance.
          </p>
        </div>
      )}

      <button
        onClick={() => onStart(spec, { enabled: guard && !isPrivate, hours })}
        disabled={busy || !ready}
        className="w-full btn-sharp btn-primary-sharp py-3.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "WORKING…" : startLabel.toUpperCase()}
      </button>
    </div>
  );
}
