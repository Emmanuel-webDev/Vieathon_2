/**
 * Shared helper to resolve the canonical public origin (e.g. https://night-watch-3f97.onrender.com)
 * when running behind reverse proxies (Render, Fly.io, Railway, Cloudflare, etc.).
 *
 * Resolution order:
 *  1. NIGHTWATCH_PUBLIC_URL env var if set (strip any trailing slash)
 *  2. x-forwarded-proto + x-forwarded-host headers (first value if comma-separated)
 *  3. the Host header, with proto https unless the host is localhost or 127.0.0.1
 *  4. only then the request URL
 *
 * Invariants:
 *  - Never return 0.0.0.0
 *  - Never include the internal port when the public host came from a forwarded header
 */

function isLocalhost(host: string): boolean {
  const h = host.split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function getPublicOrigin(req: Request): string {
  // 1. NIGHTWATCH_PUBLIC_URL env var if set (strip any trailing slash)
  const envUrl = process.env.NIGHTWATCH_PUBLIC_URL?.trim();
  if (envUrl) {
    const stripped = envUrl.replace(/\/+$/, "");
    return /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`;
  }

  // 2. x-forwarded-proto + x-forwarded-host headers (first value if comma-separated)
  const xfh = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const xfp = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (xfh) {
    let host = xfh;
    // Never return 0.0.0.0
    if (!host.startsWith("0.0.0.0")) {
      // Never include internal port when host came from a forwarded header
      let internalPort = "";
      try {
        internalPort = new URL(req.url).port;
      } catch {}
      if (!internalPort && process.env.PORT) {
        internalPort = process.env.PORT;
      }

      const portMatch = host.match(/:(\d+)$/);
      if (portMatch) {
        const port = portMatch[1];
        if (
          port === "80" ||
          port === "443" ||
          port === internalPort ||
          (internalPort && port === internalPort) ||
          port === "10000" ||
          port === "3000"
        ) {
          host = host.slice(0, -portMatch[0].length);
        }
      }

      const proto = xfp || (isLocalhost(host) ? "http" : "https");
      return `${proto}://${host}`;
    }
  }

  // 3. the Host header, with proto https unless the host is localhost or 127.0.0.1
  const hostHeader = req.headers.get("host")?.split(",")[0]?.trim();
  if (hostHeader) {
    const hostname = hostHeader.split(":")[0].toLowerCase();
    // Never return 0.0.0.0
    if (hostname !== "0.0.0.0") {
      const proto = xfp || (isLocalhost(hostHeader) ? "http" : "https");
      return `${proto}://${hostHeader}`;
    }
  }

  // 4. only then the request URL
  try {
    const parsed = new URL(req.url);
    let hostname = parsed.hostname;
    let proto = parsed.protocol.replace(/:$/, "");
    let port = parsed.port;

    // Never return 0.0.0.0
    if (hostname === "0.0.0.0") {
      hostname = "localhost";
      proto = "http";
    }

    const hostPart = port && port !== "80" && port !== "443" ? `${hostname}:${port}` : hostname;
    return `${proto}://${hostPart}`;
  } catch {
    return "http://localhost:3000";
  }
}

export function getPublicUrl(req: Request, path = ""): string {
  const origin = getPublicOrigin(req);
  const cleanPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${origin}${cleanPath}`;
}

