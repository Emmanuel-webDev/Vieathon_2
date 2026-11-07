import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";

async function verifySourcify(address: string, source: string) {
  console.log("Submitting verification to Sourcify for", address);
  const body = {
    address,
    chain: "84532",
    files: {
      "NightWatchDemoVault.sol": source,
    },
  };

  try {
    const res = await fetch("https://sourcify.dev/server/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log("Sourcify response:", res.status, text);
  } catch (e: any) {
    console.error("Sourcify verification failed:", e.message);
  }
}

async function verifyBlockscout(address: string, source: string) {
  console.log("Submitting verification to Blockscout for", address);
  const params = new URLSearchParams({
    module: "contract",
    action: "verify",
    addressHash: address,
    contractSourceCode: source,
    name: "NightWatchDemoVault",
    compilerVersion: "v0.8.30+commit.73712a01",
    optimization: "false",
  });

  try {
    const res = await fetch("https://base-sepolia.blockscout.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const text = await res.text();
    console.log("Blockscout response:", res.status, text);
  } catch (e: any) {
    console.error("Blockscout verification failed:", e.message);
  }
}

async function main() {
  const address = "0x5810645562e3569721543e96e9313be51525bcd2";
  const source = fs.readFileSync(path.resolve(__dirname, "NightWatchDemoVault.sol"), "utf-8");
  await verifySourcify(address, source);
  await verifyBlockscout(address, source);
}

main().catch(console.error);
