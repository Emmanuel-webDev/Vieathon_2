import { db } from "../../lib/db";

const row = db().prepare("SELECT report FROM jobs WHERE report_hash LIKE '0x60db4e60%'").get();
if (!row) {
  console.log("Not found!");
} else {
  const rep = JSON.parse(row.report);
  console.log("=== RAW REPORT 0x60db4e60...faf8 ===");
  console.log("ID:", rep.id);
  console.log("Target:", rep.target);
  console.log("Tier:", rep.tier);
  console.log("Timestamp:", rep.timestamp);
  console.log("Specialists Ran:", rep.specialistsRan);
  console.log("Raw Findings Total:", rep.findings?.length);
  for (const [idx, f] of rep.findings.entries()) {
    console.log(`\n--- Finding #${idx + 1} ---`);
    console.log("id:", f.id);
    console.log("file:", f.file);
    console.log("line:", f.line);
    console.log("severity:", f.severity);
    console.log("title:", f.title);
    console.log("quote:", JSON.stringify(f.quote));
    console.log("exploitability:", f.exploitability);
    console.log("exploitScenario:", f.exploitScenario);
    console.log("source:", f.source);
    console.log("lens:", f.lens);
  }
}
