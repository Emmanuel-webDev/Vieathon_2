import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
import fs from "fs";
import path from "path";

import { execSync } from "child_process";

function getGitCredentialToken(): string | undefined {
  try {
    const out = execSync("git credential fill", {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const m = out.match(/^password=(.+)$/m);
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const GITHUB_TOKEN = getGitCredentialToken() || process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) throw new Error("Set GITHUB_TOKEN in .env.local or configure git credential helper");
const REPO_NAME = "nightwatch-demo-vault";
const CONTRACT_ADDRESS = "0x70139e580853f6c54c976f027da3059f27e554ee";
const TX_HASH = "0x7e6a3354690e40033ae07111579f21ad37ca8aeeac4f23b2a53da8b98a20c061";

async function ghRequest(url: string, options: RequestInit = {}) {
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "NightWatch-Deployer",
    ...(options.headers as any),
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function createRepo() {
  console.log(`Checking if repo ${REPO_NAME} exists...`);
  const check = await ghRequest(`https://api.github.com/repos/Emmanuel-webDev/${REPO_NAME}`);
  if (check.ok) {
    console.log(`Repository already exists at ${check.json.html_url}`);
    return check.json;
  }

  console.log(`Creating public repository ${REPO_NAME}...`);
  const res = await ghRequest("https://api.github.com/user/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: REPO_NAME,
      description: "NightWatch Demo Vault on Base Sepolia - Intentionally flawed contract for security auditing demonstration",
      private: false,
      auto_init: true,
    }),
  });

  if (!res.ok) throw new Error(`Failed to create repository: ${res.status} ${res.text}`);
  console.log(`Created repository: ${res.json.html_url}`);
  // Wait a moment for GitHub to initialize default branch
  await new Promise((r) => setTimeout(r, 2000));
  return res.json;
}

async function putFile(filePath: string, content: string, message: string) {
  console.log(`Uploading ${filePath}...`);
  const check = await ghRequest(`https://api.github.com/repos/Emmanuel-webDev/${REPO_NAME}/contents/${filePath}`);
  const sha = check.ok ? check.json.sha : undefined;

  const body: any = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: "main",
  };
  if (sha) body.sha = sha;

  const res = await ghRequest(`https://api.github.com/repos/Emmanuel-webDev/${REPO_NAME}/contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Failed to upload ${filePath}: ${res.status} ${res.text}`);
  console.log(`Uploaded ${filePath} (commit: ${res.json.commit?.sha?.slice(0, 7)})`);
}

export async function createAndPushDemoRepo() {
  const repo = await createRepo();

  const sourceCode = fs.readFileSync(path.resolve(__dirname, "NightWatchDemoVault.sol"), "utf-8");

  const foundryToml = `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
`;

  const broadcastJson = JSON.stringify(
    {
      transactions: [
        {
          transactionType: "CREATE",
          contractAddress: CONTRACT_ADDRESS,
          contractName: "NightWatchDemoVault",
          hash: TX_HASH,
        },
      ],
      chain: 84532,
    },
    null,
    2
  );

  const readme = `# NightWatch Demo Vault

Intentionally vulnerable Solidity smart vault deployed and verified on **Base Sepolia**.

## Deployed Contract
- **Contract Name:** \`NightWatchDemoVault\`
- **Network:** Base Sepolia (Chain ID \`84532\`)
- **Address:** [\`${CONTRACT_ADDRESS}\`](https://sepolia.basescan.org/address/${CONTRACT_ADDRESS}#code)
- **Deployment Transaction:** [\`${TX_HASH}\`](https://sepolia.basescan.org/tx/${TX_HASH})

## Security Vulnerabilities for Auditing Demo
1. **Reentrancy:** \`withdrawAll()\` transfers ETH via low-level call before setting caller's balance to 0.
2. **Missing Access Control:** \`setOwner()\` allows any unprivileged caller to overwrite contract owner.
3. **tx.origin Authorization:** \`emergencySweep()\` authenticates via \`tx.origin == owner\`, exploitable via phishing proxy.

## Auto-Detection
NightWatch auto-detects this deployment via Foundry broadcast file in \`broadcast/Deploy.s.sol/84532/run-latest.json\`.
`;

  await putFile("foundry.toml", foundryToml, "Add foundry.toml configuration");
  await putFile("src/NightWatchDemoVault.sol", sourceCode, "Add NightWatchDemoVault contract");
  await putFile("broadcast/Deploy.s.sol/84532/run-latest.json", broadcastJson, "Add Foundry Base Sepolia broadcast artifact");
  await putFile("README.md", readme, "Update README with deployment info and flaws");

  console.log(`\nDemo repository ready: https://github.com/Emmanuel-webDev/${REPO_NAME}`);
  console.log(`Contract address: ${CONTRACT_ADDRESS}`);
}

if (require.main === module) {
  createAndPushDemoRepo().catch((e) => {
    console.error("Error creating demo repo:", e);
    process.exit(1);
  });
}
