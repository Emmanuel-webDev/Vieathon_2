import { getGhSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getGhSession().catch(() => null);
  if (!s) return Response.json({ error: "Not signed in" }, { status: 401 });
  const repos: any[] = [];
  for (const page of [1, 2]) {
    const r = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, {
      headers: { authorization: `Bearer ${s.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      cache: "no-store",
    });
    if (r.status === 401) return Response.json({ error: "GitHub session expired. Reconnect." }, { status: 401 });
    if (!r.ok) return Response.json({ error: `GitHub returned HTTP ${r.status}` }, { status: 502 });
    const batch = await r.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return Response.json({
    login: s.login,
    repos: repos
      .filter((r) => !r.archived && !r.disabled)
      .map((r) => ({ fullName: r.full_name, owner: r.owner.login, name: r.name, private: r.private, fork: r.fork, pushedAt: r.pushed_at, homepage: r.homepage || null, description: r.description || null })),
  });
}
