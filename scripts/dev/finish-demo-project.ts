import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";
import { inspectAddress } from "../../lib/onchain";
import { fetchContractSource } from "../../lib/sources";
import { detectProject } from "../../lib/detect";

const DEPLOYED_PATH = path.resolve(__dirname, "build/deployed.json");
const SOL_PATH = path.resolve(__dirname, "NightWatchDemoVault.sol");

async function submitSourcifyAndBlockscoutVerification(address: string, sourceCode: string) {
  console.log(`\nSubmitting source verification to Sourcify & Blockscout for ${address}...`);
  // Try Sourcify standard-json verification (solc 0.8.20)
  for (const optEnabled of [false, true]) {
    try {
      const stdJson = JSON.stringify({
        language: "Solidity",
        sources: { "NightWatchDemoVault.sol": { content: sourceCode } },
        settings: {
          optimizer: { enabled: optEnabled, runs: 200 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } },
        },
      });
      const res = await fetch("https://sourcify.dev/server/verify/solc-json", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          address,
          chain: "84532",
          compilerVersion: "0.8.20+commit.a1b79de6",
          contractName: "NightWatchDemoVault",
          files: { "standard-input.json": stdJson },
        }),
      });
      const txt = await res.text();
      console.log(`  Sourcify (opt=${optEnabled}) -> HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } catch (e: any) {
      console.log(`  Sourcify error: ${e.message}`);
    }
  }
  // Try Blockscout v2 flattened-code verification (both optimization=false and optimization=true with v0.8.20+commit.a1b79de6)
  for (const opt of [false, true]) {
    try {
      const res = await fetch(
        `https://base-sepolia.blockscout.com/api/v2/smart-contracts/${address}/verification/via/flattened-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            compiler_version: "v0.8.20+commit.a1b79de6",
            source_code: sourceCode,
            is_optimization_enabled: opt,
            optimization_runs: 200,
            contract_name: "NightWatchDemoVault",
            evm_version: "default",
            autodetect_constructor_args: true,
          }),
        }
      );
      const txt = await res.text();
      console.log(`  Blockscout v2 (optimization=${opt}) -> HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } catch (e: any) {
      console.log(`  Blockscout v2 error (opt=${opt}): ${e.message}`);
    }
  }

  // Also submit via Etherscan-compatible action=verifysourcecode on Blockscout
  for (const opt of ["0", "1"]) {
    try {
      const params = new URLSearchParams({
        module: "contract",
        action: "verifysourcecode",
        contractaddress: address,
        sourceCode: sourceCode,
        codeformat: "solidity-single-file",
        contractname: "NightWatchDemoVault",
        compilerversion: "v0.8.20+commit.a1b79de6",
        optimizationUsed: opt,
        runs: "200",
      });
      const res = await fetch("https://base-sepolia.blockscout.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const txt = await res.text();
      console.log(`  Blockscout legacy API (opt=${opt}) -> HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } catch (e: any) {
      console.log(`  Blockscout legacy error: ${e.message}`);
    }
  }
}

async function main() {
  console.log("=== ITEM B: Demo Project Check (Base Sepolia + Sourcify/Blockscout + GitHub Auto-Detect) ===");
  const deployed = JSON.parse(fs.readFileSync(DEPLOYED_PATH, "utf8"));
  console.log("\n1. deployed.json:", JSON.stringify(deployed, null, 2));

  const addr = deployed.address as `0x${string}`;
  const sourceCode = fs.readFileSync(SOL_PATH, "utf8");

  console.log("\n2. Reading onchain bytecode size from Base Sepolia RPC (chainId 84532)...");
  const onchain = await inspectAddress(addr, (m) => console.log(`  [rpc] ${m}`), 84532);
  console.log(`  Address:       ${onchain.facts.address}`);
  console.log(`  Chain ID:      ${onchain.facts.chainId}`);
  console.log(`  Is Contract:   ${onchain.facts.isContract}`);
  console.log(`  Code Size:     ${onchain.facts.codeSizeBytes} bytes`);
  console.log(`  Onchain Owner: ${onchain.facts.owner}`);

  console.log("\n3. Checking Sourcify / Blockscout / Etherscan V2 verification status...");
  let bsCheck = await fetch(`https://base-sepolia.blockscout.com/api/v2/smart-contracts/${addr}`).then((r) => r.json()).catch(() => null);
  if (!bsCheck?.is_verified) {
    await submitSourcifyAndBlockscoutVerification(addr, sourceCode);
    for (let i = 1; i <= 4; i++) {
      console.log(`  Waiting for Blockscout verification indexing (attempt ${i}/4)...`);
      await new Promise((r) => setTimeout(r, 4000));
      bsCheck = await fetch(`https://base-sepolia.blockscout.com/api/v2/smart-contracts/${addr}`).then((r) => r.json()).catch(() => null);
      if (bsCheck?.is_verified) {
        console.log(`  Blockscout verified: true (name=${bsCheck.name}, compiler=${bsCheck.compiler_version})`);
        break;
      }
    }
  } else {
    console.log(`  Blockscout verified: true (name=${bsCheck.name}, compiler=${bsCheck.compiler_version})`);
  }

  let src = await fetchContractSource(addr, (m) => console.log(`  [source] ${m}`), 84532);
  if (!src) {
    throw new Error(`Contract ${addr} is still not verified on Sourcify/Blockscout/Etherscan!`);
  }
  console.log(`  Verified Status: true (provider=${src.provider}, contractName=${src.contractName}, compiler=${src.compiler}, files=${src.files.length})`);

  console.log("\n4. Checking public GitHub repository & running auto-detect...");
  const { createAndPushDemoRepo } = await import("./create-and-push-demo-repo");
  await createAndPushDemoRepo();
  const repoCheck = await fetch("https://api.github.com/repos/Emmanuel-webDev/nightwatch-demo-vault", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "NightWatch" },
  });
  const repoJson = await repoCheck.json();
  console.log(`  Public GitHub Repo URL: ${repoJson.html_url} (private=${repoJson.private}, default_branch=${repoJson.default_branch})`);

  const detected = await detectProject("Emmanuel-webDev", "nightwatch-demo-vault", undefined);
  console.log("\n5. detectProject('Emmanuel-webDev', 'nightwatch-demo-vault') output:");
  console.log(JSON.stringify(detected, null, 2));

  const match = detected.contracts.find((c) => c.address.toLowerCase() === addr.toLowerCase());
  if (!match) {
    throw new Error(`Auto-detect did not find ${addr} in Emmanuel-webDev/nightwatch-demo-vault!`);
  }
  console.log(`\nPASS: NightWatchDemoVault (${addr}) is deployed (${onchain.facts.codeSizeBytes} bytes), verified via ${src.provider}, and auto-detected from https://github.com/Emmanuel-webDev/nightwatch-demo-vault via ${match.source}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
