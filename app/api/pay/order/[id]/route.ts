import { getOrder } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let o = null;
  try {
    o = getOrder(id);
  } catch {
    /* db unavailable */
  }
  if (!o) return Response.json({ error: "Order not found" }, { status: 404 });
  return Response.json({ id: o.id, tier: o.tier, target: o.target, amount: o.amount, status: o.status, expiresAt: o.expiresAt, txHash: o.txHash, jobId: o.jobId });
}
