import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

async function main() {
  const baseUrl = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
  console.log(`=== NightWatch Production Smoke Test against ${baseUrl} ===\n`);

  let failed = 0;

  // 1. Health check
  console.log("[1/4] Checking /api/health...");
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const health = await res.json();
    console.log("  Response:", JSON.stringify(health));
    if (!health.ok || health.db !== "ok") {
      throw new Error(`Unhealthy status: ok=${health.ok}, db=${health.db}`);
    }
    console.log("  ✓ /api/health PASS");
  } catch (err: any) {
    console.error("  ✗ /api/health FAIL:", err.message);
    failed++;
  }

  // 2. Pay config
  console.log("\n[2/4] Checking /api/pay/config...");
  try {
    const res = await fetch(`${baseUrl}/api/pay/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const cfg = await res.json();
    console.log("  Response:", JSON.stringify(cfg));
    if (!cfg.chainId || !cfg.usdc) {
      throw new Error("Invalid pay config schema");
    }
    const pTier = cfg.tiers?.find((t: any) => t.id === "priority");
    const dTier = cfg.tiers?.find((t: any) => t.id === "deep");
    console.log(`  ✓ /api/pay/config PASS (${cfg.chainName}, USDC: ${cfg.usdc}, Priority: ${pTier?.price} USDC, Deep: ${dTier?.price} USDC)`);
  } catch (err: any) {
    console.error("  ✗ /api/pay/config FAIL:", err.message);
    failed++;
  }

  // Helper to run SSE/NDJSON audit
  async function runAuditSSE(target: string): Promise<any> {
    const res = await fetch(`${baseUrl}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.split("\n");
    let finalReport: any = null;
    let finalHash: string | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line;
      try {
        const ev = JSON.parse(jsonStr);
        if (ev.type === "report") {
          finalReport = ev.report;
          finalHash = ev.reportHash ?? ev.hash;
        }
      } catch {}
    }
    if (!finalReport) throw new Error("No 'report' event with final report received from stream");
    return { report: finalReport, hash: finalHash };
  }

  // 3. Sandbox audit
  console.log("\n[3/4] Running sandbox audit: sample:rekkt-vault...");
  try {
    const { report, hash } = await runAuditSSE("sample:rekkt-vault");
    console.log(`  Report Hash: ${hash}`);
    console.log(`  Findings Count: ${report.findings?.length}`);
    console.log(`  Summary: ${report.summary?.critical || 0} critical, ${report.summary?.high || 0} high, ${report.summary?.medium || 0} medium`);
    if (!report.findings || report.findings.length === 0) {
      throw new Error("Expected findings in sample:rekkt-vault but got 0");
    }
    console.log("  ✓ Sandbox audit PASS");
  } catch (err: any) {
    console.error("  ✗ Sandbox audit FAIL:", err.message);
    failed++;
  }

  // 4. Demo contract audit on Base Sepolia (NightWatchDemoVault)
  const contractTarget = process.argv[3] || "0x70139e580853f6c54c976f027da3059f27e554ee";
  console.log(`\n[4/4] Running demo contract audit: ${contractTarget}...`);
  try {
    const { report, hash } = await runAuditSSE(contractTarget);
    console.log(`  Report Hash: ${hash}`);
    console.log(`  Files Analyzed: ${report.filesAnalyzed?.length}`);
    console.log(`  Findings Count: ${report.findings?.length}`);
    console.log(`  Summary: ${report.summary?.critical || 0} critical, ${report.summary?.high || 0} high, ${report.summary?.medium || 0} medium`);
    console.log("  ✓ Demo contract audit PASS");
  } catch (err: any) {
    console.error("  ✗ Demo contract audit FAIL:", err.message);
    failed++;
  }

  console.log("\n=================================");
  if (failed > 0) {
    console.error(`SMOKE TEST FAILED: ${failed} check(s) failed`);
    process.exit(1);
  } else {
    console.log("ALL SMOKE CHECKS PASSED (4/4)");
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
