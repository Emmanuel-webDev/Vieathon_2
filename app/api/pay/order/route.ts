import { PayError, createOrder } from "@/lib/payments";
import { clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(`order:${ip}`, 20, 3600_000)) return Response.json({ error: "Too many orders. Try again later." }, { status: 429 });
  let body: { target?: string; tier?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.tier !== "priority" && body.tier !== "deep") return Response.json({ error: "Unknown tier." }, { status: 400 });
  try {
    return Response.json(createOrder(String(body.target ?? ""), body.tier, ip));
  } catch (e: any) {
    if (e instanceof PayError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e.message }, { status: 500 });
  }
}
