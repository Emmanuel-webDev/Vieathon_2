import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { db } from "../../lib/db";
import { startDeepJob, getJob } from "../../lib/deep";
import { randomBytes } from "crypto";

async function main() {
  console.log("=== Testing Real End-to-End Failure & Auto-Refund ===");

  // Target: sample:rekkt-vault
  const target = "sample:rekkt-vault";

  // 1. Create a mock paid order in the SQLite db
  const orderId = "order_test_" + randomBytes(4).toString("hex");
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
    "0x1111111111111111111111111111111111111111",
    now
  );

  console.log(`[1] Created order ${orderId} with status 'paid'`);

  // Sabotage API key right before or during to guarantee a real API authorization failure
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "INVALID_KEY_SABOTAGE_FOR_TESTING";

  console.log("[2] Starting deep job with sabotaged API key...");
  const { jobId, key } = startDeepJob(orderId, target);
  console.log(`[2] Deep job launched: ${jobId}`);

  // Wait for the background runner to complete
  console.log("[3] Waiting for job runner to catch failure and process auto-refund...");
  let finalJob: any = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    finalJob = getJob(jobId);
    if (finalJob?.status === "failed" || finalJob?.status === "done" || finalJob?.status === "partial") {
      break;
    }
  }

  // Restore API key
  process.env.GEMINI_API_KEY = originalKey;

  console.log(`[4] Job final status: ${finalJob?.status}`);
  console.log(`[4] Job error: ${finalJob?.error}`);

  // Check order status in DB
  const orderRow = db().prepare("SELECT status, job_id FROM orders WHERE id = ?").get(orderId);
  console.log(`[5] Order final status in DB: ${orderRow?.status}`);

  // Verify assertions
  if (finalJob?.status !== "failed") {
    throw new Error(`Assertion failed: Expected job status 'failed', got '${finalJob?.status}'`);
  }
  if (orderRow?.status !== "paid") {
    throw new Error(`Assertion failed: Expected order status refunded to 'paid', got '${orderRow?.status}'`);
  }

  console.log("\n[SUCCESS] Verified End-to-End:");
  console.log("- Job failed honestly due to API failure");
  console.log("- Order credit was automatically restored to 'paid'");
  console.log("- Job events logged:");
  for (const e of finalJob.events) {
    console.log(`  [${e.level}] ${e.message}`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
