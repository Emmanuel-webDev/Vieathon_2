import { cookies } from "next/headers";
import { OAUTH_STATE_COOKIE, setGhSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return Response.redirect(`${url.origin}/?gh=error`, 302);
  }
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/github/callback`,
    }),
  });
  const tok = (await tokenRes.json()) as { access_token?: string };
  if (!tok.access_token) return Response.redirect(`${url.origin}/?gh=error`, 302);
  const me = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json" } });
  if (!me.ok) return Response.redirect(`${url.origin}/?gh=error`, 302);
  const user = (await me.json()) as { login: string };
  await setGhSession({ token: tok.access_token, login: user.login });
  return Response.redirect(`${url.origin}/?gh=ok`, 302);
}
