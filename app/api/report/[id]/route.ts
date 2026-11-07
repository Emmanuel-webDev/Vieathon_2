import { loadReport } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadReport(id);
  if (!r) return Response.json({ error: "Report not found" }, { status: 404 });
  return Response.json(r);
}
