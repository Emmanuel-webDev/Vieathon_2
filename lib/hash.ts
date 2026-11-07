import { keccak256, toBytes } from "viem";
import type { AuditReport } from "./types";

/** Canonical JSON (sorted keys, undefined dropped) so the same report always hashes the same on server and client. */
export function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function hashReport(report: AuditReport): `0x${string}` {
  return keccak256(toBytes(canonicalize(report)));
}
