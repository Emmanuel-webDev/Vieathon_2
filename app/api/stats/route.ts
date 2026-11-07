import { db } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = db();
    
    // 1. Audits run (done or partial)
    const auditsRow = d.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('done', 'partial')").get();
    const auditsRun = Number(auditsRow?.c || 0);

    // 2. Real findings grounded across all stored reports
    const reportRows = d.prepare("SELECT report FROM jobs WHERE report IS NOT NULL").all();
    let findingsGrounded = 0;
    for (const r of reportRows) {
      try {
        const parsed = JSON.parse(r.report);
        if (Array.isArray(parsed.findings)) {
          findingsGrounded += parsed.findings.length;
        }
      } catch {}
    }

    // 3. Active Night Shift watches
    const watchesRow = d.prepare("SELECT COUNT(*) AS c FROM watches WHERE active = 1").get();
    const watchesActive = Number(watchesRow?.c || 0);

    // 4. Attestations (check if any recorded in events or orders, or null)
    let attestationsMade: number | null = null;
    try {
      const attestRow = d.prepare("SELECT COUNT(*) AS c FROM events WHERE type = 'attestation'").get();
      attestationsMade = Number(attestRow?.c || 0);
    } catch {}

    return Response.json({
      auditsRun: auditsRun > 0 ? auditsRun : null,
      findingsGrounded: findingsGrounded > 0 ? findingsGrounded : null,
      watchesActive: watchesActive > 0 ? watchesActive : null,
      attestationsMade: attestationsMade && attestationsMade > 0 ? attestationsMade : null,
    });
  } catch (err: any) {
    return Response.json({
      auditsRun: null,
      findingsGrounded: null,
      watchesActive: null,
      attestationsMade: null,
    });
  }
}
