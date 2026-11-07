import { clearGhSession, getGhSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let s = null;
  try {
    s = await getGhSession();
  } catch {
    /* SESSION_SECRET missing */
  }
  return Response.json({
    configured: !!process.env.GITHUB_OAUTH_CLIENT_ID && !!process.env.SESSION_SECRET,
    login: s?.login ?? null,
  });
}

export async function DELETE() {
  await clearGhSession();
  return Response.json({ ok: true });
}
