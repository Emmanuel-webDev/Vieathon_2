import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";
import { runAudit } from "../../lib/audit";
import { getProviderCallCount } from "../../lib/llm";
import { getAIQuotaStatus } from "../../lib/quota";
import type { AuditReport } from "../../lib/types";

const OUT_DIR = path.resolve(process.cwd(), "docs/sample-reports");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(report: AuditReport, reportHash: string, reportId: string): string {
  const targetLabel =
    report.target.address ??
    (report.target.repo ? `${report.target.repo.owner}/${report.target.repo.name}` : report.target.url ?? `sample:${report.target.sample}`);

  const findingsHtml = report.findings
    .map((f) => {
      const verdictBadge = f.triage
        ? `<span class="badge verdict-${escapeHtml(f.triage.verdict)}">${escapeHtml(f.triage.verdict.toUpperCase())}</span>`
        : "";
      const loc = f.file ? `<code>${escapeHtml(f.file)}${f.line ? `:${f.line}` : ""}</code>` : "";
      const triageReason = f.triage?.reason ? `<p class="triage-note"><strong>AI Triage:</strong> ${escapeHtml(f.triage.reason)}</p>` : "";
      const exploitHtml = f.exploit
        ? `<div class="exploit-box">
            <strong>Exploit Verification (${escapeHtml(f.exploit.verdict)}):</strong>
            <div>Attacker: <code>${escapeHtml(f.exploit.attacker || "unspecified")}</code> | Gain: <code>${escapeHtml(f.exploit.gain || "none")}</code> | Victim: <code>${escapeHtml(f.exploit.victim || "none")}</code></div>
            <p>${escapeHtml(f.exploit.impact || f.triage?.reason || "")}</p>
          </div>`
        : "";
      return `<article class="finding sev-${escapeHtml(f.severity)} ${f.triage?.verdict === "dismissed" ? "dismissed" : ""}">
        <div class="finding-header">
          <span class="sev-pill sev-${escapeHtml(f.severity)}">${escapeHtml(f.severity.toUpperCase())}</span>
          <h3>${escapeHtml(f.title)}</h3>
          ${verdictBadge}
        </div>
        <div class="finding-meta">
          <span>ID: <code>${escapeHtml(f.id)}</code></span>
          <span>Category: ${escapeHtml(f.category)}</span>
          <span>Origin: ${escapeHtml(f.origin)}</span>
          ${loc ? `<span>Location: ${loc}</span>` : ""}
        </div>
        <p>${escapeHtml(f.description)}</p>
        ${f.evidence ? `<pre class="evidence">${escapeHtml(f.evidence)}</pre>` : ""}
        ${triageReason}
        ${exploitHtml}
        <p class="rec"><strong>Recommendation:</strong> ${escapeHtml(f.recommendation)}</p>
      </article>`;
    })
    .join("\n");

  const factsHtml = (report.contractFacts ?? [])
    .map(
      (c) => `<li>
        <strong>${escapeHtml(c.contractName ?? c.address)}</strong> (<code>${escapeHtml(c.address)}</code>, Chain ID ${c.chainId}) —
        ${c.codeSizeBytes} bytes, Verified: <code>${c.verifiedSource}</code> (${escapeHtml(c.sourceProvider ?? "n/a")}),
        Proxy: <code>${c.isProxy}</code>${c.implementation ? ` -> <code>${escapeHtml(c.implementation)}</code>` : ""},
        Owner: <code>${escapeHtml(c.owner ?? "none")}</code>
      </li>`
    )
    .join("\n");

  const limitationsHtml = report.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NightWatch Security Audit Report — ${escapeHtml(targetLabel)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0b0d12; color: #e5e7eb; max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem; line-height: 1.55; }
    h1, h2, h3 { color: #f9fafb; margin-top: 0; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
    .meta-box, .notice-box { background: #131722; border: 1px solid #262c3a; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
    .notice-box { border-left: 4px solid #f59e0b; background: #191611; }
    .summary-grid { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0; }
    .sum-card { background: #131722; border: 1px solid #262c3a; border-radius: 6px; padding: 0.6rem 1rem; min-width: 100px; }
    .finding { background: #131722; border: 1px solid #262c3a; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    .finding.dismissed { opacity: 0.65; }
    .finding-header { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .finding-header h3 { margin: 0; font-size: 1.05rem; }
    .finding-meta { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.82rem; color: #9ca3af; margin-bottom: 0.6rem; }
    .sev-pill, .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .sev-critical { background: #7f1d1d; color: #fecaca; }
    .sev-high { background: #7c2d12; color: #fed7aa; }
    .sev-medium { background: #78350f; color: #fde68a; }
    .sev-low { background: #1e3a8a; color: #bfdbfe; }
    .sev-info { background: #1f2937; color: #d1d5db; }
    .verdict-confirmed, .verdict-likely { background: #064e3b; color: #a7f3d0; }
    .verdict-dismissed { background: #374151; color: #9ca3af; }
    .verdict-unverified { background: #4b5563; color: #e5e7eb; }
    pre.evidence { background: #080a0f; border: 1px solid #1f2430; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
    .triage-note { background: #0f141e; border-left: 3px solid #3b82f6; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
    .exploit-box { background: #14111b; border-left: 3px solid #a855f7; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
    .rec { color: #d1d5db; margin-bottom: 0; }
  </style>
</head>
<body>
  <h1>NightWatch Security Audit Report</h1>
  <div class="notice-box">
    <strong>Methodology Notice:</strong> Exploit scenarios are reasoned from the code, not executed.
  </div>
  <div class="meta-box">
    <div><strong>Target:</strong> <code>${escapeHtml(targetLabel)}</code> (${escapeHtml(report.target.kind)})</div>
    <div><strong>Report Hash (Keccak256):</strong> <code>${escapeHtml(reportHash)}</code></div>
    <div><strong>Report ID:</strong> <code>${escapeHtml(reportId)}</code></div>
    <div><strong>Scanned At:</strong> <code>${escapeHtml(report.scannedAt)}</code></div>
    <div><strong>AI Provider / Model:</strong> <code>${escapeHtml(report.ai.provider ?? "none")}</code> / <code>${escapeHtml(report.ai.model ?? "none")}</code> (used: <code>${report.ai.used}</code>${report.ai.skippedReason ? `, skippedReason: ${escapeHtml(report.ai.skippedReason)}` : ""})</div>
  </div>

  <h2>Severity Summary (Active Findings)</h2>
  <div class="summary-grid">
    <div class="sum-card"><strong>Critical:</strong> ${report.summary.critical}</div>
    <div class="sum-card"><strong>High:</strong> ${report.summary.high}</div>
    <div class="sum-card"><strong>Medium:</strong> ${report.summary.medium}</div>
    <div class="sum-card"><strong>Low:</strong> ${report.summary.low}</div>
    <div class="sum-card"><strong>Info:</strong> ${report.summary.info}</div>
  </div>

  ${
    factsHtml
      ? `<h2>Onchain Contract Facts</h2><div class="meta-box"><ul>${factsHtml}</ul></div>`
      : ""
  }

  <h2>Findings (${report.findings.length} total)</h2>
  ${findingsHtml || "<p>No findings reported.</p>"}

  <h2>Scope &amp; Honest Limitations</h2>
  <div class="meta-box">
    <ul>${limitationsHtml}</ul>
  </div>
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Remove any legacy filenames so docs/sample-reports is clean and unambiguous
  for (const old of fs.readdirSync(OUT_DIR)) {
    fs.unlinkSync(path.join(OUT_DIR, old));
  }

  const targets: { slug: string; input: string; label: string }[] = [
    {
      slug: "sample-rekkt-vault",
      input: "sample:rekkt-vault",
      label: "1. Sample Contract (sample:rekkt-vault)",
    },
    {
      slug: "demo-nightwatch-vault",
      input: "0x70139e580853f6c54c976f027da3059f27e554ee",
      label: "2. Demo Contract on Base Sepolia (NightWatchDemoVault 0x70139e580853f6c54c976f027da3059f27e554ee)",
    },
    {
      slug: "base-weth",
      input: "0x4200000000000000000000000000000000000006",
      label: "3. Real Base Mainnet Contract (Canonical Base WETH9 0x4200000000000000000000000000000000000006)",
    },
  ];

  const totalCallsStart = getProviderCallCount();
  console.log("=== ITEM C: Exporting Static Sample Reports to docs/sample-reports/ ===");
  console.log("Initial AI Quota Status:", JSON.stringify(getAIQuotaStatus()));

  for (const t of targets) {
    console.log(`\n--- Running audit for ${t.label} ---`);
    const cBefore = getProviderCallCount();
    const res = await runAudit(t.input, (e) => {
      if (e.type === "log") console.log(`  [${e.level}] ${e.message}`);
    });
    const liveCalls = getProviderCallCount() - cBefore;

    const jsonPath = path.join(OUT_DIR, `${t.slug}.json`);
    const htmlPath = path.join(OUT_DIR, `${t.slug}.html`);

    const payload = {
      reportId: res.reportId,
      reportHash: res.reportHash,
      exportedAt: new Date().toISOString(),
      report: res.report,
    };

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(htmlPath, renderHtml(res.report, res.reportHash, res.reportId));

    console.log(`  Exported JSON: docs/sample-reports/${t.slug}.json (${fs.statSync(jsonPath).size} bytes)`);
    console.log(`  Exported HTML: docs/sample-reports/${t.slug}.html (${fs.statSync(htmlPath).size} bytes)`);
    console.log(`  Report Hash:   ${res.reportHash}`);
    console.log(`  Summary:       ${JSON.stringify(res.report.summary)}`);
    console.log(`  AI Provider:   ${res.report.ai.provider} / ${res.report.ai.model} (used=${res.report.ai.used}, liveCallsThisRun=${liveCalls})`);
  }

  const totalLiveCalls = getProviderCallCount() - totalCallsStart;
  console.log(`\nTotal live AI calls used during Item C: ${totalLiveCalls}`);
  console.log("Final AI Quota Status:", JSON.stringify(getAIQuotaStatus()));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

