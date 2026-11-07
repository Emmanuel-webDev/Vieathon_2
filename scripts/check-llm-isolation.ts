import fs from "fs";
import path from "path";

/**
 * Automated check: enforce that ONLY lib/llm.ts directly imports @anthropic-ai/sdk or openai.
 * All other modules must import from lib/llm or lib/ai.
 */

const ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_IMPORTS = ["@anthropic-ai/sdk", "openai"];
const ALLOWED_FILES = [
  path.resolve(ROOT, "lib", "llm.ts"),
  path.resolve(ROOT, "scripts", "check-llm-isolation.ts"),
];

const violations: { file: string; pkg: string; line: number }[] = [];

function scanDir(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
        continue;
      }
      scanDir(fullPath);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      if (ALLOWED_FILES.includes(path.resolve(fullPath))) {
        continue;
      }
      const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
      lines.forEach((line, idx) => {
        // Exclude comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const pkg of FORBIDDEN_IMPORTS) {
          // Check for import ... from "pkg", require("pkg"), import("pkg")
          const importPattern = new RegExp(`(import\\s+.*?from\\s*['"]${pkg}['"]|import\\s*\\(['"]${pkg}['"]\\)|require\\s*\\(['"]${pkg}['"]\\))`);
          if (importPattern.test(line)) {
            violations.push({ file: path.relative(ROOT, fullPath), pkg, line: idx + 1 });
          }
        }
      });
    }
  }
}

scanDir(ROOT);

if (violations.length > 0) {
  console.error("❌ LLM SDK isolation check failed! Direct SDK imports found outside lib/llm.ts:");
  for (const v of violations) {
    console.error(`   ${v.file}:${v.line} imports "${v.pkg}"`);
  }
  process.exit(1);
} else {
  console.log("✅ LLM SDK isolation check passed: Only lib/llm.ts imports @anthropic-ai/sdk and openai.");
}
