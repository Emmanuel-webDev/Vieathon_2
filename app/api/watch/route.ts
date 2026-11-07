import { createWatch } from "@/lib/watch";
import { parseTarget } from "@/lib/target";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

const limited = (ip: string) => rateLimited(`watch:${ip}`, 3, 24 * 3600_000);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  let body: { target?: string; hours?: number; intervalMin?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const target = String(body.target ?? "").slice(0, 500);
  try {
    parseTarget(target);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
  if (limited(ip)) return Response.json({ error: "Limit: 3 Night Shifts per 24 hours." }, { status: 429 });
  try {
    const w = createWatch(target, Number(body.hours) || 10, Number(body.intervalMin) || 60);
    return Response.json(w);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
