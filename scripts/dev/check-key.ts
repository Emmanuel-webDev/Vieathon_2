import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
  if (!pk) throw new Error("Set DEPLOYER_PRIVATE_KEY in .env.local");
  const acc = privateKeyToAccount(pk);
  console.log("Account address:", acc.address);

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  const balance = await client.getBalance({ address: acc.address });
  console.log("Base Sepolia ETH Balance:", formatEther(balance));
}

main().catch(console.error);
