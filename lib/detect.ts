import { getAddress, isAddress } from "viem";
import { safeFetchText } from "./safe-fetch";
import type { ChainId } from "./types";

export interface DetectedContract {
  address: `0x${string}`;
  chainId?: ChainId;
  name?: string;
  source: string;
}
export interface DetectedUrl {
  url: string;
  source: string;
}
export interface Detection {
  repo: { owner: string; name: string; defaultBranch: string; private: boolean; description?: string };
  frameworks: string[];
  liveUrls: DetectedUrl[];
  contracts: DetectedContract[];
  notes: string[];
}

/* ───────────── pure parsers (unit-tested) ───────────── */

export function chainFromName(name: string): ChainId | undefined {
  const n = name.toLowerCase();
  if (/(base[-_ ]?sepolia|basesepolia|84532)/.test(n)) return 84532;
  if (/(^|[^a-z])base([^a-z]|$)|base[-_ ]?mainnet|basemainnet|8453/.test(n)) return 8453;
  return undefined;
}

const ADDR_STRICT = /^0x[a-fA-F0-9]{40}$/;
const junk = (a: string) => /^0x0{30,}/i.test(a) || /^0xf{40}$/i.test(a);
const clean = (a: string): `0x${string}` | null => (ADDR_STRICT.test(a) && !junk(a) && isAddress(a) ? (getAddress(a) as `0x${string}`) : null);

export function parseFoundryBroadcast(json: any, chainId: ChainId): DetectedContract[] {
  const out: DetectedContract[] = [];
  for (const tx of json?.transactions ?? []) {
    if (!["CREATE", "CREATE2"].includes(tx?.transactionType)) continue;
    const a = clean(String(tx.contractAddress ?? ""));
    if (a) out.push({ address: a, chainId, name: tx.contractName ?? undefined, source: "Foundry broadcast" });
  }
  return out;
}

export function parseIgnition(json: any, chainId: ChainId): DetectedContract[] {
  const out: DetectedContract[] = [];
  for (const [k, v] of Object.entries(json ?? {})) {
    const a = clean(String(v));
    if (a) out.push({ address: a, chainId, name: k.split("#").pop(), source: "Hardhat Ignition" });
  }
  return out;
}

export function parseHardhatDeployment(json: any, chainId: ChainId | undefined, name: string): DetectedContract[] {
  const a = clean(String(json?.address ?? ""));
  return a ? [{ address: a, chainId, name, source: "hardhat-deploy" }] : [];
}

/** Walk arbitrary JSON (deployments.json / addresses.json); chain comes from a parent key like "baseSepolia" or "84532". */
export function parseAddressJson(json: any, source: string): DetectedContract[] {
  const out: DetectedContract[] = [];
  const walk = (node: any, nameKey: string | undefined, chain: ChainId | undefined, depth: number) => {
    if (out.length >= 50 || depth > 6) return;
    if (typeof node === "string") {
      const a = clean(node);
      if (a) out.push({ address: a, chainId: chain, name: nameKey, source });
    } else if (Array.isArray(node)) {
      node.forEach((v) => walk(v, nameKey, chain, depth + 1));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const c = chainFromName(k);
        walk(v, c ? nameKey : k, c ?? chain, depth + 1);
      }
    }
  };
  walk(json, undefined, undefined, 0);
  return out;
}

export function parseEnvText(text: string, source: string): DetectedContract[] {
  const out: DetectedContract[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?(0x[a-fA-F0-9]{40})["']?\s*(?:#.*)?$/);
    if (!m) continue;
    const a = clean(m[2]);
    if (a) out.push({ address: a, chainId: chainFromName(m[1]), name: m[1], source });
  }
  return out;
}

export function parseReadmeAddresses(text: string): DetectedContract[] {
  const out: DetectedContract[] = [];
  for (const m of text.matchAll(/0x[a-fA-F0-9]{40}\b/g)) {
    const a = clean(m[0]);
    if (!a) continue;
    const ctx = text.slice(Math.max(0, m.index! - 120), m.index! + 60);
    out.push({ address: a, chainId: chainFromName(ctx.replace(/base-?(?=\w{0,3}$)/i, "")), source: "README mention" });
  }
  return out.slice(0, 20);
}

const HOST_RE = /https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vercel\.app|netlify\.app|pages\.dev|onrender\.com|fly\.dev|railway\.app|up\.railway\.app|github\.io|web\.app|firebaseapp\.com|surge\.sh|herokuapp\.com)(?:\/[^\s)"'<>\]]*)?/gi;

export function extractLiveUrls(text: string, source: string): DetectedUrl[] {
  const seen = new Set<string>();
  const out: DetectedUrl[] = [];
  for (const m of text.matchAll(HOST_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, source });
  }
  return out;
}

/* ───────────── repo detection ───────────── */

const RANK: Record<string, number> = { "Foundry broadcast": 0, "Hardhat Ignition": 1, "hardhat-deploy": 2, "deployments JSON": 3, ".env example": 4, "README mention": 5 };

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const t = token ?? process.env.GITHUB_TOKEN;
  if (t) h.authorization = `Bearer ${t}`;
  return h;
}

export async function detectProject(owner: string, name: string, refIn: string | undefined, token?: string): Promise<Detection> {
  const notes: string[] = [];
  const metaRes = await safeFetchText(`https://api.github.com/repos/${owner}/${name}`, { headers: ghHeaders(token) });
  if (metaRes.status === 404) throw new Error(`Repo ${owner}/${name} not found. If it is private, connect GitHub with private-repo access.`);
  if (metaRes.status >= 400) throw new Error(`GitHub returned HTTP ${metaRes.status} for ${owner}/${name}.`);
  const meta = JSON.parse(metaRes.text);
  const ref: string = refIn || meta.default_branch;

  const treeRes = await safeFetchText(`https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers: ghHeaders(token), maxBytes: 8_000_000 });
  if (treeRes.status >= 400) throw new Error(`Could not read the file tree of ${owner}/${name}@${ref}.`);
  const tree = JSON.parse(treeRes.text);
  if (tree.truncated) notes.push("Repository is very large; file-tree listing was truncated, so some deployment files may have been missed.");
  const paths: string[] = (tree.tree as any[]).filter((e) => e.type === "blob" && (e.size ?? 0) < 400_000 && !/(^|\/)node_modules\//.test(e.path)).map((e) => e.path);

  const frameworks: string[] = [];
  if (paths.some((p) => /(^|\/)foundry\.toml$/.test(p))) frameworks.push("Foundry");
  if (paths.some((p) => /(^|\/)hardhat\.config\.(ts|js|cjs|mjs)$/.test(p))) frameworks.push("Hardhat");

  type Job = { path: string; kind: "foundry" | "ignition" | "hardhat" | "json" | "env" | "readme" | "pkg"; chainId?: ChainId; name?: string };
  const jobs: Job[] = [];
  let nHardhat = 0, nJson = 0, nEnv = 0, nFoundry = 0;
  for (const p of paths) {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^broadcast\/[^/]+\/(8453|84532)\/run-latest\.json$/)) && nFoundry++ < 8) jobs.push({ path: p, kind: "foundry", chainId: Number(m[1]) as ChainId });
    else if ((m = p.match(/(?:^|\/)ignition\/deployments\/chain-(8453|84532)\/deployed_addresses\.json$/))) jobs.push({ path: p, kind: "ignition", chainId: Number(m[1]) as ChainId });
    else if ((m = p.match(/(?:^|\/)deployments\/([^/]+)\/([^/]+)\.json$/)) && chainFromName(m[1]) && nHardhat++ < 15) jobs.push({ path: p, kind: "hardhat", chainId: chainFromName(m[1]), name: m[2] });
    else if (/^(?:[^/]+\/){0,2}(deployments?|addresses|contracts?|deployed[\w-]*)\.json$/i.test(p) && !/package(-lock)?\.json$/.test(p) && nJson++ < 5) jobs.push({ path: p, kind: "json" });
    else if (/(^|\/)\.env\.[\w.]*(example|sample)$/.test(p) && nEnv++ < 4) jobs.push({ path: p, kind: "env" });
    else if (/^readme\.md$/i.test(p)) jobs.push({ path: p, kind: "readme" });
    else if (p === "package.json") jobs.push({ path: p, kind: "pkg" });
  }

  const contracts: DetectedContract[] = [];
  const liveUrls: DetectedUrl[] = [];
  if (meta.homepage && /^https?:\/\//i.test(meta.homepage)) liveUrls.push({ url: meta.homepage, source: "GitHub repo homepage" });

  await Promise.all(
    jobs.map(async (j) => {
      try {
        const raw = await safeFetchText(`https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(ref)}/${j.path.split("/").map(encodeURIComponent).join("/")}`, {
          headers: token ?? process.env.GITHUB_TOKEN ? { authorization: `Bearer ${token ?? process.env.GITHUB_TOKEN}` } : {},
          maxBytes: 450_000,
        });
        if (raw.status !== 200) return;
        if (j.kind === "foundry") contracts.push(...parseFoundryBroadcast(JSON.parse(raw.text), j.chainId!));
        else if (j.kind === "ignition") contracts.push(...parseIgnition(JSON.parse(raw.text), j.chainId!));
        else if (j.kind === "hardhat") contracts.push(...parseHardhatDeployment(JSON.parse(raw.text), j.chainId, j.name!));
        else if (j.kind === "json") contracts.push(...parseAddressJson(JSON.parse(raw.text), "deployments JSON"));
        else if (j.kind === "env") contracts.push(...parseEnvText(raw.text, ".env example"));
        else if (j.kind === "readme") {
          contracts.push(...parseReadmeAddresses(raw.text));
          liveUrls.push(...extractLiveUrls(raw.text, "README"));
        } else if (j.kind === "pkg") {
          const pkg = JSON.parse(raw.text);
          if (typeof pkg.homepage === "string" && /^https?:\/\//i.test(pkg.homepage)) liveUrls.push({ url: pkg.homepage, source: "package.json homepage" });
        }
      } catch {
        /* unreadable or malformed file: skip */
      }
    })
  );

  const byAddr = new Map<string, DetectedContract>();
  for (const c of contracts) {
    const k = c.address.toLowerCase();
    const prev = byAddr.get(k);
    if (!prev || (RANK[c.source] ?? 9) < (RANK[prev.source] ?? 9) || (!prev.chainId && c.chainId)) byAddr.set(k, { ...prev, ...c, chainId: c.chainId ?? prev?.chainId, name: c.name ?? prev?.name });
  }
  const seenUrl = new Set<string>();
  const urls = liveUrls.filter((u) => {
    const k = u.url.replace(/\/+$/, "").toLowerCase();
    if (seenUrl.has(k)) return false;
    seenUrl.add(k);
    return true;
  });

  if (!frameworks.length) notes.push("No foundry.toml or hardhat.config found.");
  return {
    repo: { owner, name, defaultBranch: meta.default_branch, private: !!meta.private, description: meta.description ?? undefined },
    frameworks,
    liveUrls: urls.slice(0, 6),
    contracts: [...byAddr.values()].sort((a, b) => (RANK[a.source] ?? 9) - (RANK[b.source] ?? 9)).slice(0, 12),
    notes,
  };
}
