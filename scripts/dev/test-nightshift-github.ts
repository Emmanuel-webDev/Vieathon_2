import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { db } from "../../lib/db";
import { createWatch, getWatch, runDueWatches } from "../../lib/watch";

async function main() {
  console.log("=== Testing Real Night Shift GitHub Repo Watch & Live Commit Detection ===");

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No GITHUB_TOKEN configured in environment.");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "NightWatch-Live-Test",
  };

  // 1. Get authenticated user
  const userRes = await fetch("https://api.github.com/user", { headers });
  const userData = await userRes.json();
  const owner = userData.login;
  console.log(`[1] Authenticated as GitHub user: ${owner}`);

  // 2. Create throwaway repository
  const repoName = `nw-test-${Date.now().toString(36)}`;
  console.log(`[2] Creating real throwaway repository: ${owner}/${repoName}...`);
  const createRes = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: repoName,
      description: "Temporary repo for NightWatch change-detection verification",
      private: false,
      auto_init: true,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create repository: ${createRes.status} ${err}`);
  }

  const repoUrl = `https://github.com/${owner}/${repoName}`;
  console.log(`[2] Repository created: ${repoUrl}`);

  try {
    // 3. Create a Night Shift watch on the real repo
    console.log(`[3] Creating Night Shift watch on target '${owner}/${repoName}'...`);
    const watch = createWatch(`${owner}/${repoName}`, 1, 60);
    console.log(`[3] Watch ID: ${watch.id}`);

    // Wait for baseline to complete
    let w = getWatch(watch.id);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      w = getWatch(watch.id);
      if (w?.status === "watching" || w?.status === "error") break;
    }

    console.log(`[3] Baseline complete. Initial commit SHA: ${w?.state?.commitSha}`);
    console.log(`[3] Baseline status: ${w?.status}`);

    // 4. Push a real commit to the repository via GitHub API
    console.log("[4] Pushing a real commit to the repository...");
    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/contracts/Vault.sol`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "feat: add vault security contract",
        content: Buffer.from("// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract TestVault { address public owner; }\n").toString("base64"),
      }),
    });

    if (!commitRes.ok) {
      const err = await commitRes.text();
      throw new Error(`Failed to push commit: ${commitRes.status} ${err}`);
    }

    const commitData = await commitRes.json();
    const newSha = commitData.commit.sha;
    console.log(`[4] New commit created successfully: ${newSha}`);

    // 5. Trigger tick with CRON_SECRET logic
    console.log("[5] Setting watch due and triggering runDueWatches() (CRON_SECRET path)...");
    db().prepare("UPDATE watches SET next_run = ? WHERE id = ?").run(Date.now() - 1000, watch.id);

    const tickResult = await runDueWatches();
    console.log(`[5] Tick completed. Watches processed: ${tickResult.ran}`);

    // 6. Verify the change event in the SQLite database
    w = getWatch(watch.id);
    console.log("\n=== Watch Events in SQLite Database ===");
    for (const e of w?.events ?? []) {
      console.log(`- [${e.severity.toUpperCase()}] [${e.type}] ${e.title}`);
      if (e.detail) console.log(`  Detail:`, JSON.stringify(e.detail));
    }

    const commitEvent = w?.events.find((e: any) => e.type === "commit");
    if (!commitEvent) {
      throw new Error("Assertion failed: No 'commit' event was recorded!");
    }

    console.log(`\n✅ [VERIFIED] Real commit change event detected without simulation!`);
    console.log(`   Title: "${commitEvent.title}"`);
    console.log(`   From: ${commitEvent.detail.from} -> To: ${commitEvent.detail.to}`);

  } finally {
    // 7. Delete throwaway repository
    console.log(`\n[7] Cleaning up throwaway repository ${owner}/${repoName}...`);
    const delRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      method: "DELETE",
      headers,
    });
    console.log(`[7] Repository deleted: ${delRes.status === 204 ? "Success (204 No Content)" : delRes.status}`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
