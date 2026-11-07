import { getPublicOrigin } from "../lib/origin";

function runTests() {
  console.log("=== Testing getPublicOrigin & OAuth redirect_uri Resolution ===\n");

  // 1. Simulated Render Proxy Headers
  {
    const req = new Request("http://0.0.0.0:10000/api/github/login", {
      headers: {
        host: "0.0.0.0:10000",
        "x-forwarded-host": "night-watch-3f97.onrender.com",
        "x-forwarded-proto": "https",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 1: Simulated Render Proxy");
    console.log("  Inbound headers: { host: '0.0.0.0:10000', 'x-forwarded-host': 'night-watch-3f97.onrender.com', 'x-forwarded-proto': 'https' }");
    console.log("  Request URL:     http://0.0.0.0:10000/api/github/login");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    if (redirect_uri !== "https://night-watch-3f97.onrender.com/api/github/callback") {
      throw new Error(`Render test failed: expected https://night-watch-3f97.onrender.com/api/github/callback, got ${redirect_uri}`);
    }
    console.log("  -> PASS\n");
  }

  // 2. Localhost development
  {
    const req = new Request("http://localhost:3000/api/github/login", {
      headers: {
        host: "localhost:3000",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 2: Localhost Development");
    console.log("  Inbound headers: { host: 'localhost:3000' }");
    console.log("  Request URL:     http://localhost:3000/api/github/login");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    if (redirect_uri !== "http://localhost:3000/api/github/callback") {
      throw new Error(`Localhost test failed: expected http://localhost:3000/api/github/callback, got ${redirect_uri}`);
    }
    console.log("  -> PASS\n");
  }

  // 3. Comma-separated forwarded headers (multi-proxy chain)
  {
    const req = new Request("http://0.0.0.0:10000/api/github/login", {
      headers: {
        host: "0.0.0.0:10000",
        "x-forwarded-host": "night-watch-3f97.onrender.com, 10.0.0.1",
        "x-forwarded-proto": "https, http",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 3: Comma-separated Forwarded Headers");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    if (redirect_uri !== "https://night-watch-3f97.onrender.com/api/github/callback") {
      throw new Error(`Multi-proxy test failed: got ${redirect_uri}`);
    }
    console.log("  -> PASS\n");
  }

  // 4. NIGHTWATCH_PUBLIC_URL explicit override (with trailing slash)
  {
    process.env.NIGHTWATCH_PUBLIC_URL = "https://custom.nightwatch.security/";
    const req = new Request("http://0.0.0.0:10000/api/github/login", {
      headers: {
        host: "0.0.0.0:10000",
        "x-forwarded-host": "night-watch-3f97.onrender.com",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 4: NIGHTWATCH_PUBLIC_URL Env Override");
    console.log("  Env var:         NIGHTWATCH_PUBLIC_URL=https://custom.nightwatch.security/");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    delete process.env.NIGHTWATCH_PUBLIC_URL;
    if (redirect_uri !== "https://custom.nightwatch.security/api/github/callback") {
      throw new Error(`Env override test failed: got ${redirect_uri}`);
    }
    console.log("  -> PASS\n");
  }

  // 5. Host Header with domain (no forwarded headers, direct HTTPS reverse proxy)
  {
    const req = new Request("http://nightwatch.base.org/api/github/login", {
      headers: {
        host: "nightwatch.base.org",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 5: Public Host Header");
    console.log("  Inbound headers: { host: 'nightwatch.base.org' }");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    if (redirect_uri !== "https://nightwatch.base.org/api/github/callback") {
      throw new Error(`Host header test failed: got ${redirect_uri}`);
    }
    console.log("  -> PASS\n");
  }

  // 6. Direct bind without proxy headers — must NEVER return 0.0.0.0
  {
    const req = new Request("http://0.0.0.0:10000/api/github/login", {
      headers: {
        host: "0.0.0.0:10000",
      },
    });
    const origin = getPublicOrigin(req);
    const redirect_uri = `${origin}/api/github/callback`;
    console.log("Case 6: Direct 0.0.0.0:10000 bind — Invariant Check");
    console.log("  Origin resolved: " + origin);
    console.log("  redirect_uri:    " + redirect_uri);
    if (origin.includes("0.0.0.0")) {
      throw new Error(`Invariant failed: origin must NEVER contain 0.0.0.0, got ${origin}`);
    }
    console.log("  -> PASS\n");
  }

  console.log("ALL ORIGIN & REDIRECT_URI TESTS PASSED!");
}

runTests();

