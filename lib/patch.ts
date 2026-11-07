/**
 * Strict unified-diff applier. Every context and removed line must match the real file
 * (whitespace-tolerant on trailing space only); otherwise we refuse rather than guess.
 * Models often get hunk line numbers slightly wrong, so we locate each hunk by its
 * content, preferring the position closest to the stated line.
 */
export interface PatchResult {
  ok: boolean;
  content?: string;
  error?: string;
  hunks?: number;
}

interface Hunk {
  oldStart: number;
  lines: { op: " " | "-" | "+"; text: string }[];
}

function parseHunks(patch: string): { files: string[]; hunks: Hunk[] } {
  const files: string[] = [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      files.push(raw.slice(4).trim().replace(/^[ab]\//, "").split("\t")[0]);
      cur = null;
      continue;
    }
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (h) {
      cur = { oldStart: Number(h[1]), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const op = raw[0];
    if (op === " " || op === "-" || op === "+") cur.lines.push({ op, text: raw.slice(1) });
    else if (raw === "") cur.lines.push({ op: " ", text: "" }); // blank context line stripped by some tools
  }
  return { files, hunks };
}

export function patchTargetFiles(patch: string): string[] {
  return [...new Set(parseHunks(patch).files.filter((f) => f !== "/dev/null"))];
}

const norm = (s: string) => s.replace(/[ \t]+$/g, "");

export function applyUnifiedDiff(original: string, patch: string): PatchResult {
  const { hunks } = parseHunks(patch);
  if (!hunks.length) return { ok: false, error: "Patch has no hunks." };
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = original.endsWith("\n");
  const src = original.replace(/\r\n/g, "\n").split("\n");
  if (hadTrailingNewline) src.pop();

  let offset = 0;
  for (const [idx, hunk] of hunks.entries()) {
    const oldSide = hunk.lines.filter((l) => l.op !== "+").map((l) => l.text);
    const newSide = hunk.lines.filter((l) => l.op !== "-").map((l) => l.text);
    if (oldSide.length === 0) return { ok: false, error: `Hunk ${idx + 1} has no context or removed lines; refusing to guess where to insert.` };

    const expected = hunk.oldStart - 1 + offset;
    const candidates: number[] = [];
    for (let i = 0; i + oldSide.length <= src.length; i++) {
      let match = true;
      for (let j = 0; j < oldSide.length; j++) {
        if (norm(src[i + j]) !== norm(oldSide[j])) {
          match = false;
          break;
        }
      }
      if (match) candidates.push(i);
    }
    if (!candidates.length) {
      return { ok: false, error: `Hunk ${idx + 1} does not match the current file contents (the code may have changed since the scan).` };
    }
    candidates.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected));
    if (candidates.length > 1 && Math.abs(candidates[0] - expected) === Math.abs(candidates[1] - expected)) {
      return { ok: false, error: `Hunk ${idx + 1} matches multiple places equally well; refusing to guess.` };
    }
    const at = candidates[0];
    src.splice(at, oldSide.length, ...newSide);
    offset += newSide.length - oldSide.length;
  }
  let out = src.join("\n");
  if (hadTrailingNewline) out += "\n";
  return { ok: true, content: eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out, hunks: hunks.length };
}
