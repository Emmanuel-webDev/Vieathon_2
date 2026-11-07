import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { SAMPLES } from "../../lib/samples";
import { runSolidityRules } from "../../lib/rules";
import { aiVerify } from "../../lib/ai";
import { applyVerifyResult } from "../../lib/deep";

async function main() {
  console.log("=== Testing Verifier Accuracy & Attacker Gain Rule on RekktVault ===");
  const vault = SAMPLES.find((s) => s.id === "rekkt-vault")!;
  const files = vault.files;

  const serious = runSolidityRules(files).filter((f) => ["critical", "high", "medium"].includes(f.severity));
  console.log(`Generated ${serious.length} serious static leads:`);
  for (const l of serious) {
    console.log(`- [${l.id}] (${l.severity}) ${l.title}`);
  }

  console.log("\nRunning aiVerify on candidate leads (1 batched call)...");
  const results = await aiVerify(serious, files, "Sample contract audit: RekktVault");

  console.log("\n=== Verifier Results (After applyVerifyResult) ===");
  for (const l of serious) {
    const beforeSev = l.severity;
    const r = results.get(l.id);
    console.log(`\nFinding: ${l.id} — ${l.title}`);
    if (!r) {
      console.log("  No verifier result.");
      continue;
    }
    applyVerifyResult(l, r);
    console.log(`  Verdict:  ${l.exploit?.verdict}`);
    console.log(`  Severity: ${beforeSev} -> ${l.severity}`);
    console.log(`  Attacker: ${l.exploit?.attacker}`);
    console.log(`  Gain:     ${l.exploit?.gain}`);
    console.log(`  Victim:   ${l.exploit?.victim}`);
    console.log(`  Reason:   ${r.reason}`);
    if (l.exploit?.steps?.length) {
      console.log(`  Steps:`);
      for (const s of l.exploit.steps) console.log(`    ${s}`);
    }
  }

  const txOrigin = serious.find((f) => f.id.startsWith("sol-tx-origin-auth@"));
  if (!txOrigin || !txOrigin.exploit) {
    console.error("\nFAIL: sol-tx-origin-auth finding was not verified!");
    process.exit(1);
  }
  console.log(`\n=== Check on ${txOrigin.id} ===`);
  console.log(`Verdict: ${txOrigin.exploit.verdict} | Severity: ${txOrigin.severity} | Gain: ${txOrigin.exploit.gain}`);
  if (txOrigin.exploit.verdict !== "not_exploitable" || txOrigin.severity !== "low") {
    console.error("FAIL: Expected verdict=not_exploitable and severity downgraded to low");
    process.exit(1);
  }
  for (const f of serious) {
    if (!f.exploit?.attacker || !f.exploit?.gain || !f.exploit?.victim) {
      console.error(`FAIL: Finding ${f.id} missing attacker/gain/victim fields!`);
      process.exit(1);
    }
  }
  console.log("PASS: Every verified finding states attacker, gain, and victim; sol-tx-origin-auth@src/RekktVault.sol:42 marked not_exploitable and downgraded to low.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
