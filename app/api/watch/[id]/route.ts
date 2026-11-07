import { authorize, getWatch, stopWatch } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k");
  if (!/^[0-9a-f]{16}$/.test(id) || !authorize(id, k)) return Response.json({ error: "Not found" }, { status: 404 });
  const w = getWatch(id);
  if (!w) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(w);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k");
  if (!/^[0-9a-f]{16}$/.test(id) || !authorize(id, k)) return Response.json({ error: "Not found" }, { status: 404 });
  stopWatch(id);
  return Response.json({ ok: true });
}
