import { safeFetchText } from "./safe-fetch";
import type { Finding, SourceFile } from "./types";

/**
 * Real analysis of a live app: fetches the HTML + same-origin scripts, checks response headers,
 * hunts for leaked secrets, and extracts any Base contract addresses the frontend references
 * so they can be audited onchain.
 */

const SECRET_PATTERNS: { name: string; re: RegExp; severity: Finding["severity"] }[] = [
  { name: "Private key (64-hex, in key-like variable)", re: /(private[_-]?key|secret[_-]?key|mnemonic|seed[_-]?phrase)["'\s:=]+["']?(0x)?[a-fA-F0-9]{64}\b/i, severity: "critical" },
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/, severity: "critical" },
  { name: "OpenAI API key", re: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, severity: "critical" },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical" },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, severity: "critical" },
  { name: "Stripe secret key", re: /\bsk_live_[0-9a-zA-Z]{24,}\b/, severity: "critical" },
  { name: "Etherscan/Basescan-style API key in client bundle", re: /(etherscan|basescan)[\w_-]*["'\s:=]+["'][A-Z0-9]{34}["']/i, severity: "medium" },
  { name: "Alchemy/Infura RPC URL with embedded key", re: /https:\/\/[\w.-]*(alchemy|infura|quiknode|ankr)[\w.-]*\/[\w/-]*[A-Za-z0-9_-]{24,}/i, severity: "low" },
  { name: "Generic bearer/secret assigned in code", re: /(client[_-]?secret|api[_-]?secret|auth[_-]?token)["'\s:=]+["'][A-Za-z0-9_\-]{24,}["']/i, severity: "high" },
];

const HEADER_CHECKS: { header: string; title: string; severity: Finding["severity"]; why: string; fix: string; test?: (v: string) => boolean }[] = [
  {
    header: "content-security-policy",
    title: "No Content-Security-Policy header",
    severity: "medium",
    why: "Without CSP, any XSS (or a compromised third-party script) can run freely — in a dapp that means swapping the recipient of a transaction the user is about to sign.",
    fix: "Add a strict CSP restricting script-src to your own origin and known CDNs.",
  },
  {
    header: "strict-transport-security",
    title: "No Strict-Transport-Security (HSTS)",
    severity: "low",
    why: "Browsers may be downgraded to HTTP on first visit, enabling on-path tampering of the frontend.",
    fix: "Send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.",
  },
  {
    header: "x-content-type-options",
    title: "No X-Content-Type-Options: nosniff",
    severity: "info",
    why: "MIME sniffing can turn uploaded content into executable script.",
    fix: "Send `X-Content-Type-Options: nosniff`.",
  },
];


/** Hunt for credentials in client-side files. Shared by the live-URL scanner and the sandbox. */
export function scanSecrets(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const secretSeen = new Set<string>();
  for (const f of files) {
    for (const p of SECRET_PATTERNS) {
      const m = f.content.match(p.re);
      if (m && !secretSeen.has(p.name + f.path)) {
        secretSeen.add(p.name + f.path);
        const idx = m.index ?? 0;
        const line = f.content.slice(0, idx).split("\n").length;
        const redacted = m[0].replace(/([A-Za-z0-9_\-]{6})[A-Za-z0-9_\-]{8,}/g, "$1…[redacted]").slice(0, 120);
        findings.push({
          id: `web-secret-${p.name}@${f.path}`,
          title: `Exposed secret in client bundle: ${p.name}`,
          severity: p.severity,
          category: "Secret exposure",
          origin: "web",
          file: f.path,
          line,
          evidence: redacted,
          description: "This value is served to every visitor. Anyone can copy it and use it with your quota, funds or identity.",
          recommendation: "Rotate the credential now, move it behind a server-side route, and never ship it in the frontend bundle.",
        });
      }
    }
  }
  return findings;
}

const ADDR_RE = /0x[a-fA-F0-9]{40}\b/g;

export interface WebScanResult {
  findings: Finding[];
  files: SourceFile[];
  addresses: `0x${string}`[];
  title?: string;
  notes: string[];
}

export async function scanLiveApp(url: string, log: (m: string, level?: "info" | "warn" | "ok") => void): Promise<WebScanResult> {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const files: SourceFile[] = [];

  const page = await safeFetchText(url, { maxBytes: 1_500_000 });
  if (page.status >= 400) throw new Error(`${url} responded with HTTP ${page.status}`);
  const origin = new URL(page.finalUrl).origin;
  log(`Fetched ${page.finalUrl} (HTTP ${page.status}, ${(page.text.length / 1024).toFixed(0)} KB)`, "ok");
  if (page.truncated) notes.push("Page HTML exceeded size cap and was truncated.");

  const title = page.text.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();

  // headers
  for (const c of HEADER_CHECKS) {
    const v = page.headers.get(c.header);
    if (!v) {
      findings.push({
        id: `web-header-${c.header}`,
        title: c.title,
        severity: c.severity,
        category: "Web hardening",
        origin: "web",
        evidence: `Response from ${page.finalUrl} had no ${c.header} header`,
        description: c.why,
        recommendation: c.fix,
      });
    }
  }
  const xfo = page.headers.get("x-frame-options");
  const csp = page.headers.get("content-security-policy") ?? "";
  if (!xfo && !/frame-ancestors/i.test(csp)) {
    findings.push({
      id: "web-clickjacking",
      title: "App can be embedded in a frame (clickjacking)",
      severity: "medium",
      category: "Web hardening",
      origin: "web",
      evidence: "No X-Frame-Options and no CSP frame-ancestors",
      description: "An attacker page can iframe your dapp and trick users into clicking approve/sign buttons.",
      recommendation: "Send `Content-Security-Policy: frame-ancestors 'none'` (or your own origin).",
    });
  }
  if (csp && /script-src[^;]*'unsafe-inline'/i.test(csp) && !/'nonce-|'sha256-/.test(csp)) {
    findings.push({
      id: "web-csp-unsafe-inline",
      title: "CSP allows 'unsafe-inline' scripts",
      severity: "low",
      category: "Web hardening",
      origin: "web",
      evidence: csp.slice(0, 200),
      description: "unsafe-inline weakens CSP's XSS protection.",
      recommendation: "Use nonces or hashes instead of 'unsafe-inline'.",
    });
  }

  files.push({ path: new URL(page.finalUrl).pathname || "/", content: page.text });

  // same-origin scripts (bounded)
  const scriptSrcs = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const unique = [...new Set(scriptSrcs.map((s) => new URL(s, page.finalUrl).toString()))];
  const sameOrigin = unique.filter((s) => new URL(s).origin === origin).slice(0, 25);
  const external = unique.filter((s) => new URL(s).origin !== origin);

  // third-party scripts without SRI
  const tags = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)];
  for (const t of tags) {
    const abs = new URL(t[1], page.finalUrl).toString();
    if (new URL(abs).origin !== origin && !/integrity=/i.test(t[0]) && !/\.(googleapis|gstatic)\.com|googletagmanager|plausible|vercel-scripts/.test(abs)) {
      findings.push({
        id: `web-no-sri@${new URL(abs).hostname}`,
        title: `Third-party script loaded without Subresource Integrity (${new URL(abs).hostname})`,
        severity: "medium",
        category: "Supply chain",
        origin: "web",
        evidence: t[0].slice(0, 200),
        description: "If this CDN/host is compromised, arbitrary code runs inside your dapp with access to the user's wallet prompts.",
        recommendation: "Self-host the script or add an `integrity` hash and `crossorigin` attribute.",
      });
    }
  }
  if (external.length) notes.push(`${external.length} third-party script(s) referenced.`);

  log(`Downloading ${sameOrigin.length} same-origin script bundle(s)…`);
  let budget = 3_000_000;
  await Promise.all(
    sameOrigin.map(async (s) => {
      try {
        const r = await safeFetchText(s, { maxBytes: 1_200_000 });
        if (r.status === 200 && budget > 0) {
          budget -= r.text.length;
          files.push({ path: new URL(s).pathname, content: r.text });
        }
      } catch (e: any) {
        log(`Skipped script ${s}: ${e.message}`, "warn");
      }
    })
  );

  for (const f of scanSecrets(files)) findings.push(f);

  // source maps
  for (const f of files) {
    const sm = f.content.match(/\/\/# sourceMappingURL=(\S+\.map)/);
    if (sm) {
      notes.push(`Source map referenced by ${f.path}`);
      findings.push({
        id: `web-sourcemap@${f.path}`,
        title: "Public source map exposes original source",
        severity: "info",
        category: "Information disclosure",
        origin: "web",
        file: f.path,
        evidence: `sourceMappingURL=${sm[1]}`,
        description: "Production source maps let anyone read your original frontend code, making it easier to hunt for logic bugs.",
        recommendation: "Disable production source maps or restrict them.",
      });
      break;
    }
  }

  // Contract addresses referenced by the frontend → candidates to audit onchain
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const a of f.content.match(ADDR_RE) ?? []) {
      const lower = a.toLowerCase();
      if (/^0x0{40}$/.test(lower) || /^0xf{40}$/.test(lower) || /^0x0{38}[0-9a-f]{2}$/.test(lower)) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  const addresses = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a as `0x${string}`).slice(0, 12);
  log(addresses.length ? `Found ${addresses.length} address-like constants in the frontend bundle` : "No contract addresses referenced in the frontend bundle");

  return { findings, files, addresses, title, notes };
}
