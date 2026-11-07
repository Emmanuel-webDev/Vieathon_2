import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";

async function main() {
  const { db } = await import("../../lib/db");
  const { runAudit } = await import("../../lib/audit");
  const { aiTriage, computeFilesContentHash } = await import("../../lib/ai");
  const { runSolidityRules } = await import("../../lib/rules");
  const { getProviderCallCount } = await import("../../lib/llm");

  // Clear ai_cache so Run 1 is a genuine cold scan and Run 2 is a genuine SQLite cache hit
  db().prepare("DELETE FROM ai_cache").run();

  console.log("=== NightWatch AI Call Count Benchmark (Batch Triage + File-Content Hash Cache) ===\n");

  // 1. Sample: sample:rekkt-vault
  console.log("--- Target 1: Sample (sample:rekkt-vault) ---");
  const s0 = getProviderCallCount();
  const sRun1 = await runAudit("sample:rekkt-vault", () => {});
  const sCalls1 = getProviderCallCount() - s0;

  const s1 = getProviderCallCount();
  const sRun2 = await runAudit("sample:rekkt-vault", () => {});
  const sCalls2 = getProviderCallCount() - s1;

  const sStaticLeads = sRun1.report.findings.filter((f) => f.origin === "static").length;
  const sHash = computeFilesContentHash(sRun1.files);
  console.log(`  Files analyzed:              ${sRun1.files.length} (SHA-256 content hash: ${sHash.slice(0, 16)}...)`);
  console.log(`  Static leads batched:        ${sStaticLeads} leads in 1 request (unbatched per-lead + review = ${sStaticLeads + 1} calls)`);
  console.log(`  Before cache (Run 1, cold):  ${sCalls1} provider call(s)`);
  console.log(`  After cache  (Run 2, warm):  ${sCalls2} provider call(s)`);
  console.log(`  2-scan total (uncached vs cached): ${sCalls1 * 2} calls -> ${sCalls1 + sCalls2} call(s)\n`);
  if (sCalls1 !== 1 || sCalls2 !== 0) {
    throw new Error(`Expected cold=1, warm=0 on sample:rekkt-vault; got cold=${sCalls1}, warm=${sCalls2}`);
  }
  void sRun2;

  // 2. Demo Contract: NightWatchDemoVault
  console.log("--- Target 2: Demo Contract (NightWatchDemoVault) ---");
  const demoFiles = [
    {
      path: "src/NightWatchDemoVault.sol",
      content: fs.readFileSync(path.resolve(__dirname, "NightWatchDemoVault.sol"), "utf8"),
    },
  ];
  const demoLeads = runSolidityRules(demoFiles);
  const dHash = computeFilesContentHash(demoFiles);

  const d0 = getProviderCallCount();
  const dOut1 = await aiTriage({ files: demoFiles, leads: demoLeads, contextNote: "NightWatchDemoVault benchmark" }, () => {});
  const dCalls1 = getProviderCallCount() - d0;

  const d1 = getProviderCallCount();
  const dOut2 = await aiTriage({ files: demoFiles, leads: demoLeads, contextNote: "NightWatchDemoVault benchmark" }, () => {});
  const dCalls2 = getProviderCallCount() - d1;

  console.log(`  Files analyzed:              ${demoFiles.length} (SHA-256 content hash: ${dHash.slice(0, 16)}...)`);
  console.log(`  Static leads batched:        ${demoLeads.length} leads in 1 request (unbatched per-lead + review = ${demoLeads.length + 1} calls)`);
  console.log(`  Before cache (Run 1, cold):  ${dCalls1} provider call(s) (cached=${!!dOut1.cached})`);
  console.log(`  After cache  (Run 2, warm):  ${dCalls2} provider call(s) (cached=${!!dOut2.cached})`);
  console.log(`  2-scan total (uncached vs cached): ${dCalls1 * 2} calls -> ${dCalls1 + dCalls2} call(s)\n`);
  if (dCalls1 !== 1 || dCalls2 !== 0 || !dOut2.cached) {
    throw new Error(`Expected cold=1, warm=0 on NightWatchDemoVault; got cold=${dCalls1}, warm=${dCalls2}`);
  }

  console.log("PASS: Both sample:rekkt-vault and NightWatchDemoVault executed in 1 batched call (cold) and 0 calls (cached).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
