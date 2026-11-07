import { PayError, consumeOrder, getOrder, refundOrder } from "@/lib/payments";
import { startDeepJob } from "@/lib/deep";
import { aiAvailable } from "@/lib/ai";
import { AIQuotaExceededError, checkDeepBudget } from "@/lib/quota";
import { parseTarget } from "@/lib/target";
import { getGhSession } from "@/lib/session";

export const runtime = "nodejs";

/** Start the deep swarm with a paid credit. The target comes from the order, not from the request. */
export async function POST(req: Request) {
  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const orderId = String(body.orderId ?? "");
  if (!aiAvailable()) return Response.json({ error: "The deep swarm needs an AI API key configured on the server." }, { status: 503 });
  try {
    const o = getOrder(orderId);
    if (!o) return Response.json({ error: "Order not found." }, { status: 404 });
    if (o.tier !== "deep") return Response.json({ error: "This order is not for the deep swarm." }, { status: 400 });
    consumeOrder(orderId, "deep", o.target);
    const budget = checkDeepBudget(o.target);
    if (!budget.ok) {
      refundOrder(orderId);
      return Response.json(
        {
          error: `Insufficient daily AI budget for Deep Swarm: requires ${budget.needed} requests for the full lens set, only ${budget.quota.remaining}/${budget.quota.budget} remaining today. Your credit was refunded.`,
          refunded: true,
        },
        { status: 429 }
      );
    }
    try {
      const t = parseTarget(o.target);
      const needsGh = t.kind === "github" || (t.kind === "project" && !!t.project?.repo);
      const token = needsGh ? (await getGhSession().catch(() => null))?.token : undefined;
      return Response.json(startDeepJob(orderId, o.target, token));
    } catch (e: any) {
      refundOrder(orderId);
      const status = e instanceof AIQuotaExceededError || e?.name === "AIQuotaExceededError" ? 429 : 500;
      return Response.json({ error: `Could not start the swarm: ${e.message}. Your credit was refunded.`, refunded: true }, { status });
    }
  } catch (e: any) {
    if (e instanceof PayError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e.message }, { status: 500 });
  }
}
