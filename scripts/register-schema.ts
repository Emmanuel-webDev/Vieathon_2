/**
 * One-time: register the NightWatch attestation schema on Base's EAS SchemaRegistry.
 * Usage: DEPLOYER_PRIVATE_KEY=0x… npm run register-schema
 * Prints the schema UID → put it in NEXT_PUBLIC_EAS_SCHEMA_UID.
 */
import { createPublicClient, createWalletClient, http, decodeEventLog, keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { NIGHTWATCH_SCHEMA, SCHEMA_REGISTRY_ADDRESS, schemaRegistryAbi, ZERO_ADDRESS } from "../lib/eas";

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("Set DEPLOYER_PRIVATE_KEY (a funded Base Sepolia or Base account)");
  const account = privateKeyToAccount(pk);
  const isMainnet = process.env.EAS_CHAIN === "mainnet";
  const chain = isMainnet ? base : baseSepolia;
  const defaultRpc = isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org";
  const rpc = (isMainnet ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL) || defaultRpc;
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  // UID is deterministic: keccak256(schema, resolver, revocable)
  const uid = keccak256(encodePacked(["string", "address", "bool"], [NIGHTWATCH_SCHEMA, ZERO_ADDRESS, true]));
  console.log(`Target chain: ${chain.name} (${chain.id})`);
  console.log("Schema:", NIGHTWATCH_SCHEMA);
  console.log("Expected UID:", uid);

  try {
    const hash = await wallet.writeContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: schemaRegistryAbi,
      functionName: "register",
      args: [NIGHTWATCH_SCHEMA, ZERO_ADDRESS, true],
    });
    console.log("tx:", hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("Registered. Set NEXT_PUBLIC_EAS_SCHEMA_UID=" + uid);
  } catch (e: any) {
    if (/AlreadyExists/i.test(e.message ?? "")) console.log("Schema already registered. Use NEXT_PUBLIC_EAS_SCHEMA_UID=" + uid);
    else throw e;
  }
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
