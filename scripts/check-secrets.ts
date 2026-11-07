/**
 * Secret / database leak scanner. Does NOT rely on git.
 *
 *   npx tsx scripts/check-secrets.ts            -> scan the project directory tree
 *   npx tsx scripts/check-secrets.ts out.zip    -> also scan the entries of a zip you built
 *
 * Fails (exit 1) on: .env* files (except .env.example), *.db / *.sqlite* files, or contents
 * that look like keys: AIza..., AQ.xxx, sk-..., or 0x + 64 hex (private key / secret shaped).
 * Excluded dirs: node_modules, .next, .git, data (data/ must never be shipped; the zip check catches it).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import os from "os";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data"]);
const FILE_RULES: [RegExp, string][] = [
  [/^\.env(\..+)?$/i, ".env file"],
  [/\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3)$/i, "SQLite database"],
];
const ALLOW_FILES = new Set([".env.example"]);
const CONTENT_RULES: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key (AIza)"],
  [/\bAQ\.[0-9A-Za-z_-]{30,}/, "Google AI Studio key (AQ.)"],
  [/\bsk-[A-Za-z0-9_-]{20,}/, "sk- style secret key"],
  [/\b0x[0-9a-fA-F]{64}\b/, "0x + 64 hex (possible private key)"],
];
// Known public 32-byte constants (event topics, EIP-1967 slots, public schema UID, public tx/report hashes) are not secrets.
const ALLOW_HEX = new Set(
  [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000001111111111111111111111111111111111111111",
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
    "0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3",
    "0x7e6a3354690e40033ae07111579f21ad37ca8aeeac4f23b2a53da8b98a20c061",
    "0x4c042fb279991e969c2a0e6b9cd79a7873a05394e4b7ce974301641f33e94ce1",
    "0x57b78ce4d6f4a4ed7dc82e60703c89bb2d8aad5afd0fd2cc198f3b68e74a0b99",
    "0x7ee543d51d491dbffd7c02e62b7945d5b1023362acf10f163deee492dd747f20",
  ].map((s) => s.toLowerCase())
);
const SELF = path.resolve(__filename);

const violations: string[] = [];
let scanned = 0;

function checkName(rel: string) {
  const base = path.basename(rel);
  if (ALLOW_FILES.has(base)) return;
  for (const [re, why] of FILE_RULES) if (re.test(base)) violations.push(`[FILE] ${rel}: ${why}`);
}

function checkContent(rel: string, buf: Buffer) {
  if (buf.length > 2_000_000 || buf.includes(0)) return; // skip binaries / huge files
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [re, why] of CONTENT_RULES) {
      const g = new RegExp(re.source, "g");
      for (const m of line.matchAll(g)) {
        if (why.startsWith("0x") && ALLOW_HEX.has(m[0].toLowerCase())) continue;
        violations.push(`[CONTENT] ${rel}:${i + 1}: ${why}: ${m[0].slice(0, 8)}…(redacted)`);
      }
    }
  });
}

function walk(dir: string) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(abs);
      continue;
    }
    scanned++;
    checkName(rel);
    if (ALLOW_FILES.has(ent.name) || path.resolve(abs) === SELF) continue;
    if (/^\.env/i.test(ent.name)) continue; // already flagged by name; never print its contents
    if (/^(package-lock\.json|tsconfig\.tsbuildinfo)$/.test(ent.name)) continue;
    checkContent(rel, fs.readFileSync(abs));
  }
}

function scanZip(zipPath: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nw-zip-"));
  try {
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`]);
    } else {
      execFileSync("unzip", ["-q", zipPath, "-d", tmp]);
    }
    const before = scanned;
    const walkZip = (d: string) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, ent.name);
        const rel = `${path.basename(zipPath)}!/` + path.relative(tmp, abs).replace(/\\/g, "/");
        if (ent.isDirectory()) { walkZip(abs); continue; } // no dir skipping inside a zip: data/ in a zip is a leak
        scanned++;
        checkName(rel);
        if (!ALLOW_FILES.has(ent.name) && !/^\.env/i.test(ent.name)) checkContent(rel, fs.readFileSync(abs));
      }
    };
    walkZip(tmp);
    console.log(`Zip ${zipPath}: ${scanned - before} entries scanned`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`=== check:secrets — scanning directory tree ${ROOT} ===`);
walk(ROOT);
console.log(`Directory: ${scanned} files scanned (skipped dirs: ${[...SKIP_DIRS].join(", ")})`);
for (const z of process.argv.slice(2)) scanZip(path.resolve(z));

// .env.local legitimately exists locally; it must just never ship. Report it separately.
const local = violations.filter((v) => /^\[FILE\] \.env\.local:/.test(v));
const real = violations.filter((v) => !local.includes(v));
if (local.length && !process.argv.includes("--strict")) {
  console.log(`note: .env.local present locally (expected; excluded by .gitignore/.dockerignore). Use --strict to fail on it.`);
}
const fail = process.argv.includes("--strict") ? violations : real;
if (fail.length) {
  console.error(`\nFAILED: ${fail.length} violation(s)`);
  for (const v of fail) console.error("  " + v);
  process.exit(1);
}
console.log("\nPASSED: no secret files, DB files, or key-shaped strings found.");
