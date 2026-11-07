import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";
const SCHEMA_UID = process.env.NEXT_PUBLIC_EAS_SCHEMA_UID || "0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3";

const schemaRegistryAbi = [
  {
    inputs: [{ name: "uid", type: "bytes32" }],
    name: "getSchema",
    outputs: [
      {
        components: [
          { name: "uid", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "schema", type: "string" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function checkEAS() {
  console.log("Checking EAS Schema on Base Sepolia...");
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  const record = await client.readContract({
    address: SCHEMA_REGISTRY,
    abi: schemaRegistryAbi,
    functionName: "getSchema",
    args: [SCHEMA_UID as `0x${string}`],
  });

  console.log("EAS Schema Record found on Base Sepolia:");
  console.log("  UID:", record.uid);
  console.log("  Schema string:", record.schema);
  console.log("  Revocable:", record.revocable);
  console.log("  Resolver:", record.resolver);
}

checkEAS().catch((e) => {
  console.error("EAS check failed:", e.message);
  process.exit(1);
});
