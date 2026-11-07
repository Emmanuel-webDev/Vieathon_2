import { safeFetchText } from "./safe-fetch";
import type { ChainId, SourceFile } from "./types";
import { CHAINS } from "./chains";

export interface ContractSource {
  provider: "sourcify" | "blockscout" | "etherscan";
  contractName?: string;
  compiler?: string;
  files: SourceFile[];
  /** If the explorer reports this address is a proxy, the implementation address. */
  implementation?: string;
}

const UA = { accept: "application/json" };

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await safeFetchText(url, { headers: { ...UA, ...headers }, maxBytes: 8_000_000 });
  if (res.status === 404) return { status: 404, json: null as any };
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  try {
    return { status: res.status, json: JSON.parse(res.text) };
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).hostname}`);
  }
}

async function fromSourcify(address: string, chainId: ChainId): Promise<ContractSource | null> {
  const { json } = await getJson(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=all`);
  if (!json || !json.sources) return null;
  const files: SourceFile[] = Object.entries<any>(json.sources).map(([path, v]) => ({
    path,
    content: typeof v === "string" ? v : v.content ?? "",
  }));
  if (!files.length) return null;
  const impl = json.proxyResolution?.implementations?.[0]?.address;
  return {
    provider: "sourcify",
    contractName: json.compilation?.name,
    compiler: json.compilation?.compilerVersion ?? json.compilation?.compiler,
    files,
    implementation: impl,
  };
}

async function fromBlockscout(address: string, chainId: ChainId): Promise<ContractSource | null> {
  const { json } = await getJson(`${CHAINS[chainId].blockscout}/api/v2/smart-contracts/${address}`);
  if (!json || !json.source_code) return null;
  const files: SourceFile[] = [{ path: json.file_path || `${json.name || "Contract"}.sol`, content: json.source_code }];
  for (const extra of json.additional_sources ?? []) {
    files.push({ path: extra.file_path, content: extra.source_code });
  }
  return {
    provider: "blockscout",
    contractName: json.name,
    compiler: json.compiler_version,
    files,
    implementation: json.implementations?.[0]?.address_hash ?? json.implementations?.[0]?.address,
  };
}

async function fromEtherscan(address: string, chainId: ChainId): Promise<ContractSource | null> {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return null;
  const { json } = await getJson(
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${key}`
  );
  const r = json?.result?.[0];
  if (!r || !r.SourceCode) return null;
  let raw: string = r.SourceCode;
  const files: SourceFile[] = [];
  try {
    // multi-file: "{{ ...standard json... }}" or "{ file: {content} }"
    const trimmed = raw.startsWith("{{") ? raw.slice(1, -1) : raw;
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      const sources = parsed.sources ?? parsed;
      for (const [path, v] of Object.entries<any>(sources)) files.push({ path, content: v.content ?? "" });
    }
  } catch {
    /* single file */
  }
  if (!files.length) files.push({ path: `${r.ContractName || "Contract"}.sol`, content: raw });
  return {
    provider: "etherscan",
    contractName: r.ContractName,
    compiler: r.CompilerVersion,
    files,
    implementation: r.Implementation || undefined,
  };
}

/** Try verified-source providers in order. Returns null when nothing is verified. */
export async function fetchContractSource(
  address: string,
  log: (m: string, level?: "info" | "warn") => void,
  chainId: ChainId = 8453
): Promise<ContractSource | null> {
  const providers: [string, (a: string, c: ChainId) => Promise<ContractSource | null>][] = [
    ["Sourcify", fromSourcify],
    ["Blockscout", fromBlockscout],
    ["Etherscan V2", fromEtherscan],
  ];
  for (const [name, fn] of providers) {
    try {
      const src = await fn(address, chainId);
      if (src) {
        log(`Verified source found via ${name}: ${src.contractName ?? "unnamed"} (${src.files.length} file${src.files.length === 1 ? "" : "s"})`);
        return src;
      }
      log(`${name}: no verified source for ${address}`);
    } catch (e: any) {
      log(`${name} lookup failed: ${e.message}`, "warn");
    }
  }
  return null;
}

/* ───────────────────────── GitHub ───────────────────────── */

const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|out|artifacts|cache|coverage|\.next|broadcast|typechain(-types)?)(\/|$)/;
const FORGE_DEPS = /(^|\/)(lib|dependencies)\/(forge-std|openzeppelin-contracts(-upgradeable)?|solmate|solady|ds-test|prb-math|@?openzeppelin)(\/|$)/i;
const SOL_RE = /\.sol$/i;
const WEB_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|env\.example|html)$/i;
const WEB_SKIP = /(package-lock\.json|pnpm-lock|yarn\.lock|tsconfig|\.min\.|\.d\.ts$|abi\/.*\.json$)/i;

function ghHeaders(token?: string) {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const t = token ?? process.env.GITHUB_TOKEN;
  if (t) h.authorization = `Bearer ${t}`;
  return h;
}

export interface RepoSource {
  files: SourceFile[];
  solidity: SourceFile[];
  web: SourceFile[];
  ref: string;
  isPrivate: boolean;
  truncatedNote?: string;
}

export async function fetchGithubRepo(
  owner: string,
  name: string,
  refIn: string | undefined,
  subpath: string | undefined,
  log: (m: string, level?: "info" | "warn") => void,
  token?: string
): Promise<RepoSource> {
  const meta = await getJson(`https://api.github.com/repos/${owner}/${name}`, ghHeaders(token));
  if (!meta.json) throw new Error(`Repo ${owner}/${name} not found, or it is private. Connect GitHub (with private repo access) to audit private repos you can read.`);
  const ref: string = refIn || (meta.json.default_branch as string);
  const isPrivate = !!meta.json.private;
  log(`Repo ${owner}/${name} @ ${ref}${isPrivate ? " (private)" : ""}`);
  const tree = await getJson(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    ghHeaders(token)
  );
  if (!tree.json?.tree) throw new Error(`Could not read file tree for ${owner}/${name}@${ref}`);

  const entries = (tree.json.tree as any[]).filter((e) => e.type === "blob" && (e.size ?? 0) < 250_000);
  const inScope = entries.filter((e) => !subpath || e.path.startsWith(subpath));
  const clean = inScope.filter((e) => !SKIP_DIR.test(e.path) && !FORGE_DEPS.test(e.path));

  const sol = clean
    .filter((e) => SOL_RE.test(e.path) && !/(^|\/)(test|tests|script|scripts|mocks?)\//i.test(e.path) && !/\.(t|s)\.sol$/.test(e.path))
    .sort((a, b) => b.size - a.size);
  const web = clean
    .filter((e) => WEB_RE.test(e.path) && !WEB_SKIP.test(e.path) && !SOL_RE.test(e.path))
    .filter((e) => /(^|\/)(src|app|pages|components|lib|hooks|utils|api|server|contracts?|config)\//i.test(e.path) || !e.path.includes("/"))
    .filter((e) => !/\.json$/.test(e.path) || /(wagmi|abi|config)/i.test(e.path) === false)
    .sort((a, b) => a.path.length - b.path.length);

  const MAX_SOL = 40;
  const MAX_WEB = 60;
  const picked = [...sol.slice(0, MAX_SOL), ...web.slice(0, MAX_WEB)];
  let truncatedNote: string | undefined;
  if (sol.length > MAX_SOL || web.length > MAX_WEB) {
    truncatedNote = `Repo is large: analyzed ${Math.min(sol.length, MAX_SOL)}/${sol.length} Solidity files and ${Math.min(web.length, MAX_WEB)}/${web.length} app files (largest contracts first).`;
    log(truncatedNote, "warn");
  }
  log(`Fetching ${picked.length} files from GitHub…`);

  const files: SourceFile[] = [];
  const queue = [...picked];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const e = queue.shift()!;
        try {
          const res = await safeFetchText(
            `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(ref!)}/${e.path.split("/").map(encodeURIComponent).join("/")}`,
            { headers: (token ?? process.env.GITHUB_TOKEN) ? { authorization: `Bearer ${token ?? process.env.GITHUB_TOKEN}` } : {}, maxBytes: 260_000 }
          );
          if (res.status === 200) files.push({ path: e.path, content: res.text });
        } catch (err: any) {
          log(`Skipped ${e.path}: ${err.message}`, "warn");
        }
      }
    })
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    solidity: files.filter((f) => SOL_RE.test(f.path)),
    web: files.filter((f) => !SOL_RE.test(f.path)),
    ref,
    isPrivate,
    truncatedNote,
  };
}
