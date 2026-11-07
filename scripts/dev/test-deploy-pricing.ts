import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { GET } from "../../app/api/health/route";
import { payConfig } from "../../lib/payments";

process.env.NIGHTWATCH_PRICE_PRIORITY_USDC = "0.1";
process.env.NIGHTWATCH_PRICE_DEEP_USDC = "0.5";

async function main() {
  const healthRes = await GET();
  const healthData = await healthRes.json();
  console.log("=== RAW /api/health OUTPUT ===");
  console.log(JSON.stringify(healthData, null, 2));

  console.log("\n=== RAW payConfig() WITH DEMO PRICING ===");
  const cfg = payConfig();
  console.log("Tiers:");
  for (const t of cfg.tiers) {
    console.log(`- Tier [${t.id}] (${t.label}): ${t.price} USDC (Available: ${t.available})`);
  }
}
main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
