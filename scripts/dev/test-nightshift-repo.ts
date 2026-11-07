import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { db } from "../../lib/db";
import { createWatch, getWatch, runDueWatches } from "../../lib/watch";

async function main() {
  console.log("=== Testing Real Night Shift Live GitHub Repo Watch & Commit Detection ===");

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No GITHUB_TOKEN configured.");

  const owner = "Emmanuel-webDev";
  const repo = "practice";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "NightWatch-Live-Test",
  };

  // 1. Get repo default branch and latest commit
  console.log(`[1] Fetching repo info for ${owner}/${repo}...`);
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  const repoData = await repoRes.json();
  const branch = repoData.default_branch || "main";
  console.log(`[1] Default branch is: ${branch}`);

  const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, { headers });
  const branchData = await branchRes.json();
  const initialSha = branchData.sha;
  console.log(`[1] Current HEAD commit SHA: ${initialSha}`);

  // 2. Create Night Shift watch on the real repository
  console.log(`[2] Creating Night Shift watch on '${owner}/${repo}'...`);
  const watch = createWatch(`${owner}/${repo}`, 1, 60);
  console.log(`[2] Watch ID: ${watch.id}`);

  // Wait for baseline to complete
  let w = getWatch(watch.id);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    w = getWatch(watch.id);
    if (w?.status === "watching" || w?.status === "error") break;
  }
  console.log(`[3] Baseline complete. Initial state commitSha: ${w?.state?.commitSha}`);
  console.log(`[3] Events after baseline:`, w?.events.map((e: any) => `[${e.type}] ${e.title}`));

  // 3. Get existing file sha if it exists so we can update it
  let fileSha: string | undefined;
  const getFileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/test-nightwatch.txt`, { headers });
  if (getFileRes.ok) {
    const fileData = await getFileRes.json();
    fileSha = fileData.sha;
  }

  // 4. Push a real commit to the repository
  const commitMsg = `chore: nightwatch automated live tick test ${Date.now()}`;
  console.log(`[4] Pushing real commit to ${owner}/${repo} ("${commitMsg}")...`);
  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/test-nightwatch.txt`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMsg,
      content: Buffer.from(`NightWatch live commit verification at ${new Date().toISOString()}\n`).toString("base64"),
      sha: fileSha,
      branch,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`Failed to push real commit: ${putRes.status} ${err}`);
  }
  const putData = await putRes.json();
  const newCommitSha = putData.commit.sha;
  console.log(`[4] Real commit pushed to GitHub! New SHA: ${newCommitSha}`);

  // 5. Force watch to be due and run tick route logic
  console.log("[5] Setting watch due and running runDueWatches() (CRON_SECRET authorization path)...");
  db().prepare("UPDATE watches SET next_run = ? WHERE id = ?").run(Date.now() - 1000, watch.id);

  const res = await runDueWatches();
  console.log(`[5] runDueWatches completed. Watches processed: ${res.ran}`);

  // 6. Inspect events in SQLite DB
  w = getWatch(watch.id);
  console.log("\n=== Watch Events in SQLite Database ===");
  for (const e of w?.events ?? []) {
    console.log(`- [${e.severity.toUpperCase()}] [${e.type}] ${e.title}`);
    if (e.detail && Object.keys(e.detail).length > 0) {
      console.log(`  Detail:`, JSON.stringify(e.detail));
    }
  }

  const commitEvent = w?.events.find((e: any) => e.type === "commit");
  if (!commitEvent) {
    throw new Error("Assertion failed: No 'commit' event was recorded!");
  }

  console.log(`\n✅ [VERIFIED] Real live GitHub change event detected!`);
  console.log(`   Event: "${commitEvent.title}"`);
  console.log(`   From: ${commitEvent.detail?.from} -> To: ${commitEvent.detail?.to}`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
