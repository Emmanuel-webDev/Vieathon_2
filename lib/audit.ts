import { isAddress } from "viem";
import { hashReport } from "./hash";
import { randomUUID } from "crypto";
import { parseTarget } from "./target";
import { fetchContractSource, fetchGithubRepo } from "./sources";
import { findChain, inspectAddress } from "./onchain";
import { runSolidityRules } from "./rules";
import { scanLiveApp, scanSecrets } from "./web";
import { aiAvailable, aiTriage, applyLeadTriage, getAIConfig } from "./ai";
import { mergeCandidates } from "./merge";
import { AIQuotaExceededError, QUOTA_SKIPPED_MESSAGE, getAIQuotaStatus } from "./quota";
import { saveReport } from "./store";
import { sampleById } from "./samples";
import { CHAINS } from "./chains";
import type { AuditEvent, AuditReport, AuditTarget, ChainId, ContractFacts, Finding, ReportSummary, ReportTier, SourceFile } from "./types";

type Emit = (e: AuditEvent) => void;
export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

export function summarize(findings: Finding[]): ReportSummary {
  const s: ReportSummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) if (f.triage?.verdict !== "dismissed") s[f.severity]++;
  return s;
}

export function sortFindings(findings: Finding[]) {
  return findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || Number(a.triage?.verdict === "dismissed") - Number(b.triage?.verdict === "dismissed"));
}

export interface AuditOptions {
  tier?: ReportTier;
  /** The signed-in user's GitHub token: lets NightWatch read private repos they can access. Never stored. */
  githubToken?: string;
  /** Bypass SQLite AI result cache (used for cold-cache benchmarking or forced refresh). */
  skipCache?: boolean;
}

export interface AuditResult {
  report: AuditReport;
  reportHash: `0x${string}`;
  reportId: string;
  files: SourceFile[];
  isPrivate: boolean;
}

interface Parts {
  repo?: { owner: string; name: string; ref?: string; subpath?: string };
  url?: string;
  contracts: { address: `0x${string}`; chainId?: ChainId }[];
}

function partsOf(t: AuditTarget): Parts {
  if (t.kind === "github") return { repo: t.repo, contracts: [] };
  if (t.kind === "url") return { url: t.url, contracts: [] };
  if (t.kind === "contract") return { contracts: [{ address: t.address!, chainId: t.chainId }] };
  if (t.kind === "project") return { repo: t.project?.repo, url: t.project?.url, contracts: t.project?.contracts ?? [] };
  return { contracts: [] };
}

export async function runAudit(input: string, emit: Emit, opts: AuditOptions = {}): Promise<AuditResult> {
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const log = (message: string, level: "info" | "warn" | "error" | "ok" = "info") => emit({ type: "log", level, message, t: now() });
  const stage = (s: string, status: "start" | "done" | "skipped") => emit({ type: "stage", stage: s, status, t: now() });

  const target = parseTarget(input);
  const parts = partsOf(target);
  log(
    `Target: ${target.kind} → ${
      target.kind === "project"
        ? [parts.repo && `${parts.repo.owner}/${parts.repo.name}`, parts.url, parts.contracts.length && `${parts.contracts.length} contract(s)`].filter(Boolean).join(" + ")
        : target.address ?? (target.repo ? `${target.repo.owner}/${target.repo.name}` : target.url ?? target.sample)
    }`
  );

  const findings: Finding[] = [];
  const pushFinding = (f: Finding) => {
    findings.push(f);
    emit({ type: "finding", finding: f, t: now() });
  };
  const limitations: string[] = [];
  const facts: ContractFacts[] = [];
  const analyzed: SourceFile[] = [];
  const ctx: string[] = [];
  const solidityFiles: SourceFile[] = [];
  const toInspect: { address: `0x${string}`; chainId?: ChainId }[] = [];
  let isPrivate = false;

  /* ───────── Stage 1: collect real material ───────── */
  stage("collect", "start");
  if (target.kind === "sample") {
    const sample = sampleById(target.sample!)!;
    analyzed.push(...sample.files);
    solidityFiles.push(...sample.files.filter((f) => /\.sol$/i.test(f.path)));
    limitations.push("Judge Sandbox: this is an intentionally vulnerable sample bundled with NightWatch, analyzed by the same pipeline as any real submission.");
    ctx.push(`Intentionally vulnerable sample "${sample.title}" bundled with NightWatch for demonstration. Treat it like any submitted project.`);
    log(`Sandbox sample: ${sample.title} (${sample.files.length} file${sample.files.length > 1 ? "s" : ""})`);
    for (const f of sample.files.filter((x) => !/\.sol$/i.test(x.path))) for (const finding of scanSecrets([f])) pushFinding(finding);
  } else {
    if (parts.repo) {
      const r = parts.repo;
      const repo = await fetchGithubRepo(r.owner, r.name, r.ref, r.subpath, log, opts.githubToken);
      if (!repo.files.length) throw new Error("No analyzable files found in that repository (looked for Solidity and app source).");
      isPrivate = repo.isPrivate;
      if (isPrivate) {
        const allowPrivate = process.env.NIGHTWATCH_ALLOW_PRIVATE === "true" || process.env.NIGHTWATCH_ALLOW_PRIVATE === "1";
        if (!allowPrivate) {
          throw new Error(
            "Private repository scans are blocked: server AI provider is running with a default or free-tier key. " +
            "To send private repository source code to the configured AI provider, set NIGHTWATCH_ALLOW_PRIVATE=true in .env.local."
          );
        }
      }
      analyzed.push(...repo.files);
      solidityFiles.push(...repo.solidity);
      if (repo.truncatedNote) limitations.push(repo.truncatedNote);
      ctx.push(`GitHub repository ${r.owner}/${r.name}@${repo.ref}: ${repo.solidity.length} Solidity files and ${repo.web.length} app files.`);
      const found = new Map<string, number>();
      for (const f of repo.files) for (const a of f.content.match(/0x[a-fA-F0-9]{40}\b/g) ?? []) found.set(a, (found.get(a) ?? 0) + 1);
      let n = 0;
      for (const [a] of [...found.entries()].sort((x, y) => y[1] - x[1])) {
        if (n >= 6) break;
        if (!/^0x0{30,}/.test(a.toLowerCase()) && isAddress(a)) {
          toInspect.push({ address: a as `0x${string}` });
          n++;
        }
      }
      if (n) log(`Addresses referenced in the repo: ${n} (checking which are deployed on Base / Base Sepolia)`);
      if (isPrivate) limitations.push(`Private repository: its source was sent to the configured AI provider (${getAIConfig().label}) for security review, and this report is not permanently stored on the server.`);
    }
    if (parts.url) {
      const web = await scanLiveApp(parts.url, log);
      for (const f of web.findings) pushFinding(f);
      analyzed.push(...web.files);
      limitations.push(...web.notes);
      toInspect.push(...web.addresses.slice(0, 8).map((address) => ({ address })));
      ctx.push(`Live web app at ${parts.url}${web.title ? ` (title: "${web.title}")` : ""}. Those files are the HTML and same-origin JS bundles as served to browsers.`);
      limitations.push("Live-URL mode inspects what the server sends to browsers (headers, HTML, JS bundles). It does not log in, submit forms, fuzz inputs, or send attack traffic.");
    }
    for (const c of parts.contracts) toInspect.push(c);
    if (parts.contracts.length) ctx.push(`${parts.contracts.length} contract(s) deployed on Base / Base Sepolia, provided by the project owner.`);
  }
  stage("collect", "done");

  /* ───────── Stage 2: onchain inspection (Base / Base Sepolia RPC) + verified source ───────── */
  const explicit = new Set(parts.contracts.map((c) => c.address.toLowerCase()));
  stage("onchain", toInspect.length ? "start" : "skipped");
  const inspected = new Set<string>();
  for (const probe of toInspect) {
    const addr = probe.address;
    try {
      const chainId = probe.chainId ? (await findChain(addr, probe.chainId)) : await findChain(addr);
      if (!chainId) {
        if (target.kind === "contract") throw new Error(`${addr} has no contract code on Base or Base Sepolia. Check the address.`);
        if (explicit.has(addr.toLowerCase())) log(`${addr}: no contract code on Base or Base Sepolia, skipped`, "warn");
        continue; // wallet / other-chain address referenced by the code: ignore silently
      }
      const key = `${chainId}:${addr.toLowerCase()}`;
      if (inspected.has(key)) continue;
      inspected.add(key);
      const chainName = CHAINS[chainId].name;
      const { facts: fct, findings: onf, implementation } = await inspectAddress(addr, (m, l) => log(m, l ?? "info"), chainId);
      const src = await fetchContractSource(addr, (m, l) => log(m, l ?? "info"), chainId);
      fct.verifiedSource = !!src;
      fct.sourceProvider = src?.provider;
      fct.contractName = src?.contractName;
      fct.compiler = src?.compiler;
      for (const f of onf) pushFinding({ ...f, id: `${f.id}@${chainId}:${addr}`, evidence: `${f.evidence ?? ""} [${chainName} ${addr}]`.trim() });
      if (!src) {
        pushFinding({
          id: `onchain-unverified@${chainId}:${addr}`,
          title: `Contract source is not verified on ${chainName}`,
          severity: "medium",
          category: "Transparency",
          origin: "onchain",
          evidence: `${addr} has ${fct.codeSizeBytes} bytes of code on ${chainName} but no verified source on Sourcify/Blockscout${process.env.ETHERSCAN_API_KEY ? "/Etherscan" : ""}`,
          description: "Users and auditors cannot read what this contract does. Unverified code can hide privileged functions or malicious logic, and NightWatch can only check bytecode-level facts for it.",
          recommendation: "Verify the source (forge verify-contract / Sourcify) so behavior can be reviewed.",
        });
        limitations.push(`${addr} (${chainName}): not verified — only bytecode and storage-level checks were possible.`);
      } else {
        for (const sf of src.files) {
          const p = `${src.contractName ?? "contract"}[${addr.slice(0, 8)}]/${sf.path}`;
          solidityFiles.push({ path: p, content: sf.content });
          analyzed.push({ path: p, content: sf.content });
        }
        const implAddr = (implementation ?? src.implementation) as `0x${string}` | undefined;
        const implKey = implAddr ? `${chainId}:${implAddr.toLowerCase()}` : "";
        if (implAddr && implAddr.toLowerCase() !== addr.toLowerCase() && !inspected.has(implKey)) {
          inspected.add(implKey);
          log(`Following proxy to implementation ${implAddr}`);
          const isrc = await fetchContractSource(implAddr, (m, l) => log(m, l ?? "info"), chainId);
          if (isrc) {
            for (const sf of isrc.files) {
              const p = `${isrc.contractName ?? "implementation"}[${implAddr.slice(0, 8)}]/${sf.path}`;
              solidityFiles.push({ path: p, content: sf.content });
              analyzed.push({ path: p, content: sf.content });
            }
            fct.notes.push(`Implementation source analyzed: ${isrc.contractName ?? implAddr} (${isrc.provider}).`);
          } else {
            limitations.push(`${implAddr} (${chainName}): proxy implementation is not verified.`);
          }
        }
      }
      facts.push(fct);
      for (const n of fct.notes) log(`  · ${n}`);
    } catch (e: any) {
      if (target.kind === "contract") throw e;
      log(`Skipped ${addr}: ${e.message}`, "warn");
    }
  }
  if (toInspect.length) stage("onchain", "done");

  /* ───────── Stage 3: deterministic static analysis ───────── */
  stage("static", solidityFiles.length ? "start" : "skipped");
  const leads = runSolidityRules(solidityFiles);
  if (solidityFiles.length) {
    log(`Static rules scanned ${solidityFiles.length} Solidity file(s) → ${leads.length} lead(s)`, leads.length ? "info" : "ok");
    stage("static", "done");
  } else if (!parts.url && target.kind !== "sample") {
    log("No Solidity source available to analyze.", "warn");
  }

  /* ───────── Stage 4: AI triage + grounded review ───────── */
  let aiUsed = false;
  let aiSkipped: string | undefined;
  const reviewFiles = analyzed.filter((f) => /\.(sol|ts|tsx|js|jsx|mjs|html)$/i.test(f.path));
  const aiContext = ctx.join(" ");
  const aiConfig = getAIConfig();
  if (!reviewFiles.length) {
    aiSkipped = "No source files were available to review.";
    stage("ai", "skipped");
  } else if (!aiAvailable()) {
    aiSkipped = `${aiConfig.label} API key is not configured on this server. Results below are deterministic checks only: no AI triage was performed, so static leads are unconfirmed.`;
    log(aiSkipped, "warn");
    stage("ai", "skipped");
  } else if (getAIQuotaStatus().exhausted) {
    aiSkipped = QUOTA_SKIPPED_MESSAGE;
    limitations.push(QUOTA_SKIPPED_MESSAGE);
    log(aiSkipped, "warn");
    stage("ai", "skipped");
  } else {
    stage("ai", "start");
    log(`${aiConfig.label} (${aiConfig.model}) reviewing ${reviewFiles.length} file(s) against ${leads.length} lead(s)…`);
    try {
      const out = await aiTriage({ files: reviewFiles, leads, facts, contextNote: aiContext, skipCache: isPrivate || opts.skipCache }, (m, l) => log(m, l ?? "info"));
      aiUsed = true;
      for (const lead of leads) {
        applyLeadTriage(lead, out.triage.get(lead.id));
      }
      const dismissed = leads.filter((l) => l.triage?.verdict === "dismissed").length;
      log(`Triage: ${leads.length - dismissed} kept, ${dismissed} dismissed as false positives`, "ok");
      const { merged: dedupedLeads, added: trulyNew } = mergeCandidates(leads, out.newFindings);
      for (const f of trulyNew) log(`AI finding: [${f.severity}] ${f.title} (${f.file}:${f.line})`);
      leads.splice(0, leads.length, ...dedupedLeads);
      stage("ai", "done");
    } catch (e: any) {
      if (e instanceof AIQuotaExceededError || e?.name === "AIQuotaExceededError") {
        aiSkipped = QUOTA_SKIPPED_MESSAGE;
        limitations.push(QUOTA_SKIPPED_MESSAGE);
        log(aiSkipped, "warn");
      } else {
        aiSkipped = `AI review failed: ${e.message}. Static leads below are unconfirmed.`;
        log(aiSkipped, "error");
      }
      stage("ai", "skipped");
    }
  }
  for (const f of leads) pushFinding(f);

  /* ───────── Report ───────── */
  sortFindings(findings);
  limitations.push(
    aiUsed
      ? `Report AI stage produced by ${aiConfig.label} (provider: ${aiConfig.provider}, model: ${aiConfig.model}).`
      : `Report AI stage skipped (configured provider: ${aiConfig.provider}, model: ${aiConfig.model}) — deterministic checks only.`
  );
  limitations.push("Exploit scenarios are reasoned from the code, not executed.");
  limitations.push("NightWatch is automated analysis, not a formal audit. Absence of findings is not a guarantee of safety.");

  const report: AuditReport = {
    version: 1,
    target,
    scannedAt: new Date().toISOString(),
    filesAnalyzed: analyzed.map((f) => ({ path: f.path, bytes: f.content.length })),
    contractFacts: facts.length ? facts : undefined,
    findings,
    summary: summarize(findings),
    ai: aiUsed
      ? { used: true, model: aiConfig.model, provider: aiConfig.provider }
      : { used: false, model: aiConfig.model, provider: aiConfig.provider, skippedReason: aiSkipped },
    ...(opts.tier ? { tier: opts.tier } : {}),
    limitations,
  };
  const reportHash = hashReport(report);
  const reportId = randomUUID();
  if (!isPrivate) await saveReport(reportId, report, reportHash).catch(() => undefined);
  emit({ type: "report", report, reportHash, reportId, t: now() });
  return { report, reportHash, reportId, files: analyzed, isPrivate };
}
