import type { Finding, Severity } from "./types";

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
function jaccard(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const normCat = (c: string) => c.toLowerCase().replace(/[^a-z]/g, "");
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Same file, nearby line, and either the same category or a similar title. */
export function sameIssue(a: Finding, b: Finding): boolean {
  if (!a.file || !b.file || a.file !== b.file) return false;
  if (Math.abs((a.line ?? 0) - (b.line ?? 0)) > 3) return false;
  return normCat(a.category) === normCat(b.category) || jaccard(a.title, b.title) >= 0.34;
}

/**
 * Fold specialist-agent candidates into the baseline findings. A candidate that matches an existing
 * finding corroborates it (and raises its severity if the specialist rated it higher); the rest are added.
 */
export function mergeCandidates(existing: Finding[], candidates: Finding[]) {
  const merged = existing.map((f) => ({ ...f }));
  const added: Finding[] = [];
  let corroborated = 0;
  for (const c of candidates) {
    const hit = merged.find((m) => sameIssue(m, c));
    if (hit) {
      const set = new Set([...(hit.corroboratedBy ?? []), ...(c.corroboratedBy ?? [])]);
      if (set.size !== (hit.corroboratedBy ?? []).length) corroborated++;
      hit.corroboratedBy = [...set];
      if (RANK[c.severity] < RANK[hit.severity] && hit.triage?.verdict !== "dismissed") hit.severity = c.severity;
      if (!hit.patch && c.patch) hit.patch = c.patch;
    } else {
      const copy = { ...c };
      merged.push(copy);
      added.push(copy);
    }
  }
  return { merged, added, corroborated };
}
