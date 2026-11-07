import { authorizeJob, getJob } from "@/lib/deep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k");
  let ok = false;
  try {
    ok = authorizeJob(id, k);
  } catch {
    /* db unavailable */
  }
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  const j = getJob(id);
  return j ? Response.json(j) : Response.json({ error: "Not found" }, { status: 404 });
}
