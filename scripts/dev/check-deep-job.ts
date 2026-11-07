import { getJob } from "../../lib/deep";

const j = getJob("89015834a3f5013d");
console.log("Job Status:", j?.status);
console.log("Events count:", j?.events.length);
if (j?.events.length) {
  for (const e of j.events.slice(-8)) {
    console.log(`  [${e.level}] ${e.message}`);
  }
}
if (j?.report?.deep) {
  console.log("\nDeep Swarm Report Summary:");
  console.log("  Model:", j.report.deep.model);
  console.log("  Provider:", j.report.deep.provider);
  console.log("  Duration:", Math.round(j.report.deep.durationMs / 1000) + "s");
  console.log("  Verified:", j.report.deep.verified);
  console.log("  Exploitable:", j.report.deep.exploitable);
  console.log("  Agents:");
  for (const a of j.report.deep.agents) {
    console.log(`    - ${a.label}: ${a.kept} kept`);
  }
}
