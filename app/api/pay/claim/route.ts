import { PayError, claimOrder } from "@/lib/payments";
import { clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (rateLimited(`claim:${clientIp(req)}`, 60, 3600_000)) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  let body: { orderId?: string; txHash?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const o = await claimOrder(String(body.orderId ?? ""), String(body.txHash ?? ""));
    return Response.json({ id: o.id, status: o.status, tier: o.tier, payer: o.payer, txHash: o.txHash });
  } catch (e: any) {
    if (e instanceof PayError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `Could not verify the payment: ${e.shortMessage || e.message}` }, { status: 502 });
  }
}
