import { db } from "../../../lib/db";
import { aiAvailable, getAIConfig } from "../../../lib/ai";
import { getAIQuotaStatus } from "../../../lib/quota";
import { treasury } from "../../../lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, unknown> = { ok: true, node: process.version, worker: process.env.NIGHTWATCH_WORKER === "1" };
  try {
    out.db = db().prepare("SELECT 1 AS x").get().x === 1 ? "ok" : "fail";
    const quota = getAIQuotaStatus();
    out.aiQuota = quota;
    out.aiBudgetRemaining = quota.remaining;
  } catch (e: any) {
    out.ok = false;
    out.db = `error: ${e.message}`;
  }
  const cfg = getAIConfig();
  out.ai = aiAvailable();
  out.aiProvider = cfg.provider;
  out.aiModel = cfg.model;
  out.payments = !!treasury();
  return Response.json(out, { status: out.ok ? 200 : 503 });
}
