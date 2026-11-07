import type { AuditTarget, ChainId, ProjectSpec } from "./types";
import { sampleById } from "./samples";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Turn whatever the user pasted into a typed audit target. Throws a user-readable error on garbage. */
export function parseTarget(input: string): AuditTarget {
  const raw = input.trim();
  if (!raw) throw new Error("Paste a Base contract address, a GitHub repo URL, or a live app URL.");

  if (raw.startsWith("sample:")) {
    const id = raw.slice(7);
    if (!sampleById(id)) throw new Error(`Unknown sandbox sample "${id}".`);
    return { raw, kind: "sample", sample: id };
  }

  if (raw.startsWith("project:")) {
    let spec: unknown;
    try {
      spec = JSON.parse(raw.slice(8));
    } catch {
      throw new Error("Invalid project target.");
    }
    return { raw, kind: "project", project: normalizeProject(spec) };
  }

  if (ADDRESS_RE.test(raw)) {
    return { raw, kind: "contract", address: raw as `0x${string}` };
  }

  // basescan / blockscout links -> address
  const explorer = raw.match(/(?:basescan\.org|blockscout\.com)\/(?:address|token)\/(0x[a-fA-F0-9]{40})/i);
  if (explorer) {
    const chainId: ChainId = /sepolia/i.test(raw) ? 84532 : 8453;
    return { raw, kind: "contract", address: explorer[1] as `0x${string}`, chainId };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like an address or a URL.");
  }

  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("GitHub URL must include owner and repo, e.g. github.com/owner/repo");
    const [owner, name0, kind, ref, ...rest] = parts;
    const name = name0.replace(/\.git$/, "");
    const repo: NonNullable<AuditTarget["repo"]> = { owner, name };
    if ((kind === "tree" || kind === "blob") && ref) {
      repo.ref = ref;
      if (rest.length) repo.subpath = rest.join("/");
    }
    return { raw, kind: "github", repo };
  }

  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are supported.");
  return { raw, kind: "url", url: url.toString() };
}

const PART = /^[A-Za-z0-9._-]{1,100}$/;

/** Strictly validate a project spec (repo + live URL + contracts). Throws a user-readable error. */
export function normalizeProject(input: unknown): ProjectSpec {
  if (!input || typeof input !== "object") throw new Error("Invalid project target.");
  const i = input as any;
  const out: ProjectSpec = {};
  if (i.repo) {
    const { owner, name, ref } = i.repo;
    if (!PART.test(owner ?? "") || !PART.test(name ?? "")) throw new Error("Invalid GitHub repo in project.");
    out.repo = { owner, name, ...(ref && typeof ref === "string" && /^[\w./-]{1,100}$/.test(ref) ? { ref } : {}) };
  }
  if (i.url) {
    let u: URL;
    try {
      u = new URL(String(i.url));
    } catch {
      throw new Error("Invalid live URL in project.");
    }
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Live URL must be http(s).");
    out.url = u.toString();
  }
  if (Array.isArray(i.contracts) && i.contracts.length) {
    if (i.contracts.length > 8) throw new Error("A project can include at most 8 contracts.");
    out.contracts = i.contracts.map((c: any) => {
      if (!ADDRESS_RE.test(String(c?.address ?? ""))) throw new Error("Invalid contract address in project.");
      if (c.chainId !== undefined && c.chainId !== 8453 && c.chainId !== 84532) throw new Error("Contracts must be on Base (8453) or Base Sepolia (84532).");
      return { address: c.address as `0x${string}`, ...(c.chainId ? { chainId: c.chainId as ChainId } : {}) };
    });
  }
  if (!out.repo && !out.url && !out.contracts?.length) throw new Error("Choose a repo, a live URL, or a contract.");
  return out;
}

export function projectRaw(spec: ProjectSpec): string {
  return `project:${JSON.stringify(normalizeProject(spec))}`;
}

export function describeTarget(t: AuditTarget): string {
  if (t.kind === "project" && t.project) {
    return [t.project.repo && `${t.project.repo.owner}/${t.project.repo.name}`, t.project.url, t.project.contracts?.length && `${t.project.contracts.length} contract(s)`].filter(Boolean).join(" + ");
  }
  return t.address ?? (t.repo ? `${t.repo.owner}/${t.repo.name}` : t.url ?? t.sample ?? t.raw);
}
