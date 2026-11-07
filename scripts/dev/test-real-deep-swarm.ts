import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { db } from "../../lib/db";
import { startDeepJob, getJob } from "../../lib/deep";
import { randomBytes } from "crypto";

async function main() {
  console.log("=== Running Real Deep Swarm to Completion ===");

  const target = "sample:rekkt-vault";
  const orderId = "order_deep_" + randomBytes(4).toString("hex");
  const now = Date.now();

  db().prepare(`
    INSERT INTO orders (id, tier, target, amount, status, created_at, expires_at, tx_hash, payer, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    "deep",
    target,
    "25",
    "paid",
    now,
    now + 3600_000,
    "0x" + randomBytes(32).toString("hex"),
    "0x2222222222222222222222222222222222222222",
    now
  );

  console.log(`[1] Created paid order ${orderId} for target '${target}'`);
  console.log(`[2] Starting deep job with Gemini 3.5 Flash...`);

  const { jobId, key } = startDeepJob(orderId, target);
  console.log(`[2] Deep job ID: ${jobId}`);

  let lastEventCount = 0;
  let finalJob: any = null;

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    finalJob = getJob(jobId);

    if (finalJob?.events && finalJob.events.length > lastEventCount) {
      for (let j = lastEventCount; j < finalJob.events.length; j++) {
        const e = finalJob.events[j];
        console.log(`  [${e.level.toUpperCase()}] ${e.message}`);
      }
      lastEventCount = finalJob.events.length;
    }

    if (finalJob?.status === "done" || finalJob?.status === "partial" || finalJob?.status === "failed") {
      break;
    }
  }

  console.log("\n=== Job Final Summary ===");
  console.log(`Status: ${finalJob?.status}`);
  console.log(`Report Hash: ${finalJob?.hash}`);

  if (finalJob?.report?.deep) {
    const deep = finalJob.report.deep;
    console.log(`Model: ${deep.model} (${deep.provider})`);
    console.log(`Swarm Status: ${deep.status}`);
    console.log(`Stages: Succeeded: ${deep.stages?.specialistsSucceeded}/${deep.stages?.specialistsTotal}, Failed: ${deep.stages?.specialistsFailed}, Verifier Ran: ${deep.stages?.verifierRan}`);
    console.log("\n--- Lens by Lens Results ---");
    for (const a of deep.agents) {
      console.log(`  Lens: "${a.label}" (id: ${a.id})`);
      console.log(`    Status: ${a.status ?? (a.error ? "failed" : "succeeded")}`);
      console.log(`    Raw Candidates: ${a.candidates}`);
      console.log(`    Grounded Kept: ${a.kept}`);
      if (a.error) console.log(`    Error: ${a.error}`);
    }

    console.log(`\nVerifier stats: ${deep.verified} verified (${deep.exploitable} exploitable, ${deep.conditional} conditional, ${deep.notExploitable} not exploitable)`);
  }

  console.log("\n--- Findings in Final Report ---");
  for (const f of finalJob?.report?.findings ?? []) {
    console.log(`- [${f.severity.toUpperCase()}] ${f.title} (${f.file}:${f.line})`);
    console.log(`  Origin: ${f.origin}`);
    if (f.corroboratedBy?.length) {
      console.log(`  Corroborated by: ${f.corroboratedBy.join(", ")}`);
    }
    if (f.exploit) {
      console.log(`  Exploit Verdict: ${f.exploit.verdict}`);
      console.log(`  Exploit Steps: ${f.exploit.steps.slice(0, 2).join("; ")}`);
    }
    if (f.evidence) {
      console.log(`  Evidence: ${f.evidence.slice(0, 100)}`);
    }
  }

  if (finalJob?.status !== "done") {
    throw new Error(`Expected job to finish with status 'done', got '${finalJob?.status}'`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
