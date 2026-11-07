import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { OAUTH_STATE_COOKIE } from "@/lib/session";
import { getPublicOrigin } from "@/lib/origin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!id) return Response.json({ error: "GitHub OAuth is not configured (GITHUB_OAUTH_CLIENT_ID)." }, { status: 501 });
  const origin = getPublicOrigin(req);
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: "/",
    maxAge: 600,
  });
  const url = new URL(req.url);
  const scope = url.searchParams.get("private") === "1" ? "repo" : "public_repo";
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", id);
  gh.searchParams.set("redirect_uri", `${origin}/api/github/callback`);
  gh.searchParams.set("scope", scope);
  gh.searchParams.set("state", state);
  return Response.redirect(gh.toString(), 302);
}
