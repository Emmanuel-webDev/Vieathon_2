import { lookup } from "dns/promises";
import net from "net";

/**
 * SSRF guard: NightWatch fetches user-supplied URLs server-side, so we refuse
 * anything that resolves to a private, loopback, link-local or metadata address.
 */
function isPrivateIp(ip: string): boolean {
  if (process.env.NIGHTWATCH_ALLOW_LOCAL_TEST === "1") return false;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return false;
  }
  return true;
}

export async function assertPublicHost(hostname: string) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Refusing to fetch private address ${hostname}`);
    return;
  }
  const records = await lookup(hostname, { all: true });
  if (!records.length) throw new Error(`Could not resolve ${hostname}`);
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error(`${hostname} resolves to a private address; refusing to fetch.`);
  }
}

export async function safeFetchText(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {}
): Promise<{ status: number; headers: Headers; text: string; finalUrl: string; truncated: boolean }> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  let current = url;
  for (let i = 0; i <= (opts.maxRedirects ?? 4); i++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) is allowed");
    await assertPublicHost(u.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "NightWatch/0.1 (+security-audit)", ...opts.headers },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("Redirect without location");
        current = new URL(loc, current).toString();
        continue;
      }
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      let truncated = false;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > maxBytes) {
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      return { status: res.status, headers: res.headers, text, finalUrl: current, truncated };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}
