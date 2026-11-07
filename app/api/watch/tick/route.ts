import { runDueWatches } from "@/lib/watch";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Call from a cron: POST /api/watch/tick with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runDueWatches());
}
