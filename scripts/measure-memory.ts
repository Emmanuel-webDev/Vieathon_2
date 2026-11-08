import { runAudit } from "../lib/audit";
import { createWatch } from "../lib/watch";

async function measure() {
  console.log("=== Measuring Peak Memory: Guard Scan of Emmanuel-webDev/nightwatch-demo-vault ===\n");

  const target = `project:{"repo":{"owner":"Emmanuel-webDev","name":"nightwatch-demo-vault"},"contracts":[{"address":"0x70139e580853f6c54c976F027DA3059f27e554ee","chainId":84532}]}`;

  let peakHeapUsed = 0;
  let peakHeapTotal = 0;
  let peakRss = 0;
  let peakExternal = 0;

  function sample() {
    const mem = process.memoryUsage();
    if (mem.heapUsed > peakHeapUsed) peakHeapUsed = mem.heapUsed;
    if (mem.heapTotal > peakHeapTotal) peakHeapTotal = mem.heapTotal;
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.external > peakExternal) peakExternal = mem.external;
  }

  const initial = process.memoryUsage();
  sample();
  const timer = setInterval(sample, 10);

  console.log("Starting guard scan (audit + watch creation)...");
  const t0 = Date.now();

  try {
    const res = await runAudit(target, (e) => {
      sample();
      if (e.type === "log") console.log(`  [log] ${e.message}`);
    });
    sample();

    console.log(`\nAudit completed in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    console.log(`Files analyzed: ${res.files.length}, Findings: ${res.report.findings.length}`);

    // Create Night Shift guard watch with baseline report
    console.log("Creating Night Shift guard watch...");
    const watch = createWatch(target, 10, 60, { baseline: { report: res.report, hash: res.reportHash } });
    sample();
    console.log(`Watch created: ${watch.id}`);
  } finally {
    clearInterval(timer);
    sample();
  }

  const toMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + " MB";

  console.log("\n=== Memory Usage Report ===");
  console.log(`Initial RSS:        ${toMB(initial.rss)}`);
  console.log(`Initial Heap Used:  ${toMB(initial.heapUsed)}`);
  console.log("-----------------------------------------");
  console.log(`Peak Heap Used:     ${toMB(peakHeapUsed)} (${peakHeapUsed.toLocaleString()} bytes)`);
  console.log(`Peak Heap Total:    ${toMB(peakHeapTotal)} (${peakHeapTotal.toLocaleString()} bytes)`);
  console.log(`Peak RSS:           ${toMB(peakRss)} (${peakRss.toLocaleString()} bytes)`);
  console.log(`Peak External:      ${toMB(peakExternal)} (${peakExternal.toLocaleString()} bytes)`);
  console.log("=========================================\n");
}

measure().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

