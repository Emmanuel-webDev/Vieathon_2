import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`;
  if (!pk) throw new Error("Set DEPLOYER_PRIVATE_KEY in .env.local");
  const account = privateKeyToAccount(pk);
  const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  console.log("Deployer:", account.address);
  const bal = await pub.getBalance({ address: account.address });
  console.log("Balance:", bal.toString());

  const abiPath = path.resolve(__dirname, "build/scripts_dev_NightWatchDemoVault_sol_NightWatchDemoVault.abi");
  const binPath = path.resolve(__dirname, "build/scripts_dev_NightWatchDemoVault_sol_NightWatchDemoVault.bin");

  const abi = JSON.parse(fs.readFileSync(abiPath, "utf-8"));
  const bytecode = ("0x" + fs.readFileSync(binPath, "utf-8").trim()) as `0x${string}`;

  console.log("Deploying NightWatchDemoVault to Base Sepolia...");
  const hash = await wallet.deployContract({
    abi,
    bytecode,
  });
  console.log("Transaction hash:", hash);

  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("Contract deployed successfully at:", receipt.contractAddress);
  console.log("Block number:", receipt.blockNumber.toString());

  // Save deployment info
  const deployInfo = {
    contractName: "NightWatchDemoVault",
    address: receipt.contractAddress,
    transactionHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    chainId: 84532,
    deployer: account.address,
  };
  fs.writeFileSync(path.resolve(__dirname, "build/deployed.json"), JSON.stringify(deployInfo, null, 2));
}

main().catch((e) => {
  console.error("Deploy failed:", e);
  process.exit(1);
});
