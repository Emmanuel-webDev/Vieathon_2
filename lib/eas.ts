import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import type { AuditReport } from "./types";

/** EAS predeploys on Base (OP Stack). */
export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;

/** Schema registered once via `npm run register-schema`. */
export const NIGHTWATCH_SCHEMA =
  "bytes32 reportHash,string target,uint8 critical,uint8 high,uint8 medium,uint8 low,uint64 scannedAt,bool aiReviewed";

export const easAbi = [
  {
    type: "function",
    name: "attest",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "Attested",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "uid", type: "bytes32", indexed: false },
      { name: "schemaUID", type: "bytes32", indexed: true },
    ],
  },
] as const;

export const schemaRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export function targetLabel(report: AuditReport): string {
  const t = report.target;
  if (t.kind === "contract") return `base:${t.address}`;
  if (t.kind === "github" && t.repo) return `github:${t.repo.owner}/${t.repo.name}${t.repo.ref ? `@${t.repo.ref}` : ""}`;
  if (t.kind === "sample") return `sample:${t.sample}`;
  if (t.kind === "project" && t.project) return `project:${t.project.repo ? `${t.project.repo.owner}/${t.project.repo.name}` : t.project.url ?? "contracts"}`;
  return `url:${t.url}`;
}

export function encodeAttestationData(report: AuditReport, reportHash: Hex): Hex {
  return encodeAbiParameters(
    parseAbiParameters("bytes32 reportHash, string target, uint8 critical, uint8 high, uint8 medium, uint8 low, uint64 scannedAt, bool aiReviewed"),
    [
      reportHash,
      targetLabel(report).slice(0, 200),
      Math.min(255, report.summary.critical),
      Math.min(255, report.summary.high),
      Math.min(255, report.summary.medium),
      Math.min(255, report.summary.low),
      BigInt(Math.floor(new Date(report.scannedAt).getTime() / 1000)),
      report.ai.used,
    ]
  );
}

export const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const EAS_CHAIN_ID = (process.env.NEXT_PUBLIC_EAS_CHAIN === "mainnet" ? 8453 : 84532) as 8453 | 84532;

export function easScanUrl(uid: string, chainId: number = EAS_CHAIN_ID): string {
  const domain = chainId === 8453 ? "base.easscan.org" : "base-sepolia.easscan.org";
  return `https://${domain}/attestation/view/${uid}`;
}

export function txScanUrl(tx: string, chainId: number = EAS_CHAIN_ID): string {
  const domain = chainId === 8453 ? "basescan.org" : "sepolia.basescan.org";
  return `https://${domain}/tx/${tx}`;
}
