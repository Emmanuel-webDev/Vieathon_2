import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");
process.env.NIGHTWATCH_ALLOW_LOCAL_TEST = "1";

import http from "http";
import { db } from "../../lib/db";
import { createWatch, getWatch, runDueWatches } from "../../lib/watch";

async function main() {
  console.log("=== Testing Real Night Shift URL Down Detection (No Simulation) ===");

  // 1. Start a real local HTTP server
  let serverUp = true;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Test Dapp Running</h1><script src='/bundle.js'></script></body></html>");
  });

  await new Promise<void>((resolve) => server.listen(4088, "127.0.0.1", () => resolve()));
  const testUrl = "http://127.0.0.1:4088";
  console.log(`[1] Local test server started at ${testUrl}`);

  // 2. Create a real watch on the URL
  console.log("[2] Creating Night Shift watch on URL...");
  const watch = createWatch(testUrl, 1, 60);
  console.log(`[2] Watch created: ${watch.id}`);

  // Wait for baseline to complete (status changes to 'watching')
  let w = getWatch(watch.id);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    w = getWatch(watch.id);
    if (w?.status === "watching" || w?.status === "error") break;
  }
  console.log(`[3] Baseline state urlUp: ${w?.state?.urlUp}`);
  console.log(`[3] Events after baseline:`, w?.events.map((e: any) => `[${e.type}] ${e.title}`));

  // 4. Stop the local server (simulating outage)
  console.log("[4] Stopping local server to simulate real downtime...");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  serverUp = false;
  console.log("[4] Server stopped.");

  // 5. Force watch to be due and trigger real tick with CRON_SECRET authorization
  console.log("[5] Setting watch due and running due watches via runDueWatches()...");
  db().prepare("UPDATE watches SET next_run = ? WHERE id = ?").run(Date.now() - 1000, watch.id);

  const res = await runDueWatches();
  console.log(`[5] runDueWatches completed. Watches processed: ${res.ran}`);

  // 6. Inspect events
  w = getWatch(watch.id);
  console.log("\n=== Watch Events in SQLite Database ===");
  for (const e of w?.events ?? []) {
    console.log(`- [${e.severity.toUpperCase()}] [${e.type}] ${e.title}`);
  }

  const downEvent = w?.events.find((e: any) => e.type === "url_down");
  if (!downEvent) {
    throw new Error("Assertion failed: No 'url_down' event was detected when server was stopped!");
  }

  console.log(`\n✅ [VERIFIED] Real url_down event captured: "${downEvent.title}" (Severity: ${downEvent.severity})`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
