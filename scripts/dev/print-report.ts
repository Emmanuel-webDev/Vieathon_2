import { db } from "../../lib/db";

const jobs = db().prepare("SELECT id, target, status, report_hash, created_at, report FROM jobs").all();
console.log(`Total jobs in SQLite: ${jobs.length}`);

for (const j of jobs) {
  console.log(`\nJob ID: ${j.id}`);
  console.log(`Target: ${j.target}`);
  console.log(`Status: ${j.status}`);
  console.log(`Report Hash: ${j.report_hash}`);
  console.log(`Created At: ${j.created_at} (${new Date(j.created_at).toISOString()})`);
  if (j.report) {
    try {
      const rep = JSON.parse(j.report);
      console.log(`Tier: ${rep.tier}`);
      console.log(`Stages:`, JSON.stringify(rep.stages));
      console.log(`Findings count: ${rep.findings?.length ?? 0}`);
      console.log(`--- RAW FINDINGS ---`);
      for (const f of rep.findings ?? []) {
        console.log(JSON.stringify({
          id: f.id,
          file: f.file,
          line: f.line,
          quote: f.quote,
          severity: f.severity,
          title: f.title,
          verdict: f.verdict ?? f.exploitability,
          source: f.source
        }, null, 2));
      }
    } catch (e: any) {
      console.log("Error parsing report JSON:", e.message);
    }
  } else {
    console.log("No report text stored.");
  }
}
