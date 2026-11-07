import { promises as fs } from "fs";
import path from "path";
import type { AuditReport } from "./types";

/** Best-effort local persistence. Reports are also returned in full to the client, which is the source of truth for verification. */
const DIR = process.env.NIGHTWATCH_DATA_DIR || path.join(process.cwd(), "data", "reports");

export async function saveReport(id: string, report: AuditReport, hash: string) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify({ id, hash, report }, null, 2));
}

export async function loadReport(id: string): Promise<{ id: string; hash: string; report: AuditReport } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}
