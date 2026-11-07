import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

/** Run the real pipeline from the terminal: npm run audit:cli -- <address|github url|app url> */
import { runAudit } from "../lib/audit";

const target = process.argv[2];
if (!target) {
  console.error("usage: npm run audit:cli -- <0x address | github.com/owner/repo | https://app>");
  process.exit(1);
}
runAudit(target, (e) => {
  if (e.type === "log") console.log(`[${e.level}] ${e.message}`);
  else if (e.type === "stage") console.log(`-- ${e.stage}: ${e.status}`);
  else if (e.type === "report") {
    console.log(
      "\nSUMMARY",
      e.report.summary,
      `\nPROVIDER/MODEL: ${e.report.ai.provider} / ${e.report.ai.model} (ai.used=${e.report.ai.used})`,
      "\nHASH",
      e.reportHash
    );
    for (const f of e.report.findings) console.log(`- [${f.severity}] ${f.title} ${f.file ? `(${f.file}:${f.line})` : ""} ${f.triage ? `<${f.triage.verdict}>` : ""}`);
  } else if (e.type === "error") console.error("ERROR", e.message);
}).catch((e) => {
  console.error("ERROR", e.message);
  process.exit(1);
});
