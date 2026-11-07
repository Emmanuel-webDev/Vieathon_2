import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { detectProject } from "../../lib/detect";
import { createOrder, claimOrder, consumeOrder, refundOrder, getOrder, type ChainReader } from "../../lib/payments";
import { startDeepJob, getJob, recoverOrphanedJobs } from "../../lib/deep";
import { db } from "../../lib/db";
import { parseTarget } from "../../lib/target";

async function main() {
  console.log("=== Testing NightWatch Live Paths ===\n");

  // 1. Repo Auto-Detect on real Foundry repo (Uniswap/v4-core)
  console.log("--- 1. Repo Auto-Detect: Uniswap/v4-core (Foundry) ---");
  try {
    const d1 = await detectProject("Uniswap", "v4-core", undefined, process.env.GITHUB_TOKEN);
    console.log("Owner/Name:", `${d1.repo.owner}/${d1.repo.name}`);
    console.log("Frameworks detected:", d1.frameworks.join(", ") || "none");
    console.log("Contracts found:", d1.contracts.length);
    console.log("Live URLs found:", d1.liveUrls.map((u) => u.url));
    console.log("Notes:", d1.notes);
  } catch (err: any) {
    console.error("Foundry detect error:", err.message);
  }

  // 2. Repo Auto-Detect on real Hardhat repo (scaffold-eth/scaffold-eth-2)
  console.log("\n--- 2. Repo Auto-Detect: scaffold-eth/scaffold-eth-2 (Hardhat) ---");
  try {
    const d2 = await detectProject("scaffold-eth", "scaffold-eth-2", undefined, process.env.GITHUB_TOKEN);
    console.log("Owner/Name:", `${d2.repo.owner}/${d2.repo.name}`);
    console.log("Frameworks detected:", d2.frameworks.join(", ") || "none");
    console.log("Contracts found:", d2.contracts.length);
    console.log("Live URLs found:", d2.liveUrls.map((u) => u.url));
    console.log("Notes:", d2.notes);
  } catch (err: any) {
    console.error("Hardhat detect error:", err.message);
  }

  // 3. Base Sepolia USDC Payment & Reused Tx Hash Rejection
  console.log("\n--- 3. Base Sepolia USDC Payment Flow ---");
  const target = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const order = createOrder(target, "priority", "127.0.0.1");
  console.log(`Created priority order: ${order.orderId}, amount: ${order.amount} micro-USDC`);

  // Mock a valid receipt matching this order's unique amount
  const { randomBytes } = await import("crypto");
  const mockTxHash = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const mockReader: ChainReader = {
    async getReceipt(hash) {
      return {
        status: "success",
        blockNumber: 1000n,
        logs: [
          {
            address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000001111111111111111111111111111111111111111",
              `0x000000000000000000000000${process.env.NIGHTWATCH_TREASURY!.slice(2)}`,
            ],
            data: "0x" + BigInt(order.amount).toString(16).padStart(64, "0"),
          },
        ],
      };
    },
    async blockTime() {
      return Math.floor(Date.now() / 1000);
    },
  };

  const claim1 = await claimOrder(order.orderId, mockTxHash, mockReader);
  console.log("First claim with tx hash:", claim1.status);

  // Attempting to claim a different order with the same txHash MUST be rejected
  const order2 = createOrder(target, "priority", "127.0.0.1");
  try {
    await claimOrder(order2.orderId, mockTxHash, mockReader);
    console.error("❌ FAILED: Reused tx hash was accepted!");
  } catch (e: any) {
    console.log("✅ PASSED: Reused tx hash rejected with error:", e.message);
  }

  // 4. Deep swarm job lifecycle + credit refund on failure
  console.log("\n--- 4. Deep Swarm Job Lifecycle & Refund on Failure ---");
  // Temporarily set a dummy key to verify deep order creation & refund logic
  process.env.ANTHROPIC_API_KEY = "dummy_key_for_lifecycle_test";
  const deepOrder = createOrder(target, "deep", "127.0.0.1");
  delete process.env.ANTHROPIC_API_KEY;
  // Mark as paid
  db().prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(deepOrder.orderId);
  const beforeConsume = getOrder(deepOrder.orderId);
  console.log("Order before consume:", beforeConsume?.status);

  consumeOrder(deepOrder.orderId, "deep", target);
  const afterConsume = getOrder(deepOrder.orderId);
  console.log("Order after consume:", afterConsume?.status);

  // Refund order
  refundOrder(deepOrder.orderId);
  const afterRefund = getOrder(deepOrder.orderId);
  console.log("Order after refund:", afterRefund?.status, "(credit restored!)");

  // Test orphan recovery
  process.env.ANTHROPIC_API_KEY = "dummy_key_for_lifecycle_test";
  const orphanOrder = createOrder(target, "deep", "127.0.0.1");
  delete process.env.ANTHROPIC_API_KEY;
  db().prepare("UPDATE orders SET status = 'consumed' WHERE id = ?").run(orphanOrder.orderId);
  const { jobId } = startDeepJob(orphanOrder.orderId, target);
  console.log(`Created deep job ${jobId} attached to order ${orphanOrder.orderId}`);
  const recovered = recoverOrphanedJobs();
  console.log(`recoverOrphanedJobs() recovered: ${recovered} job(s)`);
  const recoveredOrder = getOrder(orphanOrder.orderId);
  console.log("Orphaned order status after restart recovery:", recoveredOrder?.status);

  console.log("\n=== Live Path Verification Complete ===");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
