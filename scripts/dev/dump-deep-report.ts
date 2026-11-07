import { db } from "../../lib/db";

const row = db().prepare("SELECT id, order_id, target, status, report_hash, report FROM jobs WHERE report_hash LIKE '0x60db4e60%' OR id = 'e1c2bfae5652d080'").get();
if (!row) {
  console.log("No job found with that hash or id");
  const all = db().prepare("SELECT id, target, status, report_hash FROM jobs").all();
  console.log("All jobs in DB:", all);
} else {
  console.log("Job found:", { id: row.id, target: row.target, status: row.status, report_hash: row.report_hash });
  const rep = JSON.parse(row.report);
  console.log("Parsed report keys:", Object.keys(rep));
  console.log("Deep field in report:", JSON.stringify(rep.deep, null, 2));
  console.log("\n=================== ONE FULL FINDING AS RAW JSON.STRINGIFY ===================");
  console.log(JSON.stringify(rep.findings[0], null, 2));
  console.log("===============================================================================\n");

  console.log("=== PER-FINDING FIELDS ===");
  for (const [i, f] of rep.findings.entries()) {
    console.log(`\nFinding #${i + 1}:`);
    console.log(`  id: ${f.id}`);
    console.log(`  title: ${f.title}`);
    console.log(`  file: ${f.file}:${f.line}`);
    console.log(`  severity: ${f.severity}`);
    console.log(`  quote/evidence: ${JSON.stringify(f.quote || f.evidence || null)}`);
    console.log(`  corroboratedBy: ${JSON.stringify(f.corroboratedBy || null)}`);
    console.log(`  exploit verdict: ${f.exploit?.verdict || null}`);
    console.log(`  exploit steps: ${JSON.stringify(f.exploit?.steps || null)}`);
    console.log(`  triage: ${JSON.stringify(f.triage || null)}`);
  }
}
