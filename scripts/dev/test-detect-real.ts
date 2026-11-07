import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { detectProject } from "../../lib/detect";
import { findChain, inspectAddress } from "../../lib/onchain";

async function main() {
  console.log("=== Testing Real Deployment Detection on Base/Base Sepolia ===");

  const reposToTest = [
    { owner: "base", name: "eip-8130" },
    { owner: "base-org", name: "eip-8130" },
  ];

  let detected = null;
  for (const r of reposToTest) {
    try {
      console.log(`Checking ${r.owner}/${r.name}...`);
      detected = await detectProject(r.owner, r.name, undefined);
      console.log(`✅ Successfully detected ${r.owner}/${r.name}:`);
      break;
    } catch (e: any) {
      console.log(`Could not fetch ${r.owner}/${r.name}:`, e.message);
    }
  }

  if (!detected) {
    console.error("Could not find a working repo from candidate list");
    return;
  }

  console.log("Frameworks:", detected.frameworks);
  console.log("Contracts parsed:", detected.contracts.length);
  for (const c of detected.contracts) {
    console.log(`  - ${c.name ?? "Contract"} @ ${c.address} (chain ${c.chainId}, source: ${c.source})`);
  }

  console.log("\nVerifying onchain filter against Base RPC...");
  for (const c of detected.contracts.slice(0, 3)) {
    const chainId = await findChain(c.address, c.chainId);
    if (chainId) {
      const { facts } = await inspectAddress(c.address, () => {}, chainId);
      console.log(`  ✅ Onchain check for ${c.address} on chain ${chainId}: isContract=${facts.isContract}, codeSize=${facts.codeSizeBytes} bytes`);
    } else {
      console.log(`  ℹ️ Contract ${c.address} is not currently deployed on active Base RPC.`);
    }
  }
}

main().catch(console.error);
