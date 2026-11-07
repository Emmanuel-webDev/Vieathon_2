/**
 * On startup: fail any deep-swarm job orphaned by a restart (and return its payment credit).
 * Self-hosted worker: when NIGHTWATCH_WORKER=1, also check for due Night Shift watches every minute.
 * On serverless hosts leave the worker off and call POST /api/watch/tick from a cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const dns = await import("dns");
    dns.setDefaultResultOrder?.("ipv4first");
  } catch {}
  try {
    const { recoverOrphanedJobs } = await import("./lib/deep");
    const n = recoverOrphanedJobs();
    if (n) console.log(`[nightwatch] returned credits for ${n} orphaned deep job(s)`);
  } catch (e: any) {
    console.warn("[nightwatch] job recovery skipped:", e.message);
  }
  if (process.env.NIGHTWATCH_WORKER !== "1") return;
  const { runDueWatches } = await import("./lib/watch");
  setInterval(() => {
    runDueWatches().catch((e: any) => console.error("[nightwatch worker]", e.message));
  }, 60_000).unref?.();
  console.log("[nightwatch] watch worker started");
}
