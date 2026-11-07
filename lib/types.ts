export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type TargetKind = "contract" | "github" | "url" | "sample" | "project";

export type ChainId = 8453 | 84532;

export interface ProjectSpec {
  repo?: { owner: string; name: string; ref?: string };
  url?: string;
  contracts?: { address: `0x${string}`; chainId?: ChainId }[];
}

export type ReportTier = "standard" | "priority" | "deep" | "partial-deep";

export interface SourceFile {
  path: string;
  content: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  /** Where the finding came from. "ai" findings are always grounded in a file/line from the submitted code. */
  origin: "onchain" | "static" | "web" | "ai";
  file?: string;
  line?: number;
  evidence?: string;
  description: string;
  recommendation: string;
  /** Unified-diff style patch suggestion, when the AI could produce one. */
  patch?: string;
  /** Static-rule findings are heuristics: the AI triage marks them confirmed / dismissed with a reason. */
  triage?: { verdict: "confirmed" | "likely" | "dismissed"; reason: string };
  /** Deep swarm only: an adversarial reviewer's concrete attack scenario, grounded in the submitted code. */
  exploit?: {
    verdict: "exploitable" | "conditional" | "not_exploitable";
    steps: string[];
    attacker?: string;
    gain?: string;
    victim?: string;
    preconditions?: string;
    impact?: string;
  };
  /** Deep swarm only: which specialist agents independently reported this. */
  corroboratedBy?: string[];
}

export interface AuditTarget {
  raw: string;
  kind: TargetKind;
  address?: `0x${string}`;
  repo?: { owner: string; name: string; ref?: string; subpath?: string };
  url?: string;
  sample?: string;
  chainId?: ChainId;
  project?: ProjectSpec;
}

export interface ContractFacts {
  address: string;
  chainId: ChainId;
  codeSizeBytes: number;
  isContract: boolean;
  isProxy: boolean;
  implementation?: string;
  admin?: string;
  owner?: string;
  ownerIsContract?: boolean;
  verifiedSource: boolean;
  sourceProvider?: string;
  contractName?: string;
  compiler?: string;
  hasSelfdestructOpcode?: boolean;
  notes: string[];
}

export interface ReportSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AuditReport {
  version: 1;
  target: AuditTarget;
  scannedAt: string; // ISO
  filesAnalyzed: { path: string; bytes: number }[];
  contractFacts?: ContractFacts[];
  findings: Finding[];
  summary: ReportSummary;
  ai: { used: boolean; model: string; provider: string; skippedReason?: string };
  tier?: ReportTier;
  deep?: DeepInfo;
  limitations: string[];
}

export interface DeepInfo {
  model: string;
  provider?: string;
  status: "done" | "partial";
  stages: {
    specialistsTotal: number;
    specialistsSucceeded: number;
    specialistsFailed: number;
    verifierRan: boolean;
  };
  agents: { id: string; label: string; candidates: number; kept: number; error?: string; status?: "succeeded" | "failed" }[];
  verified: number;
  exploitable: number;
  conditional: number;
  notExploitable: number;
  durationMs: number;
}

export type AuditEvent =
  | { type: "log"; level: "info" | "warn" | "error" | "ok"; message: string; t: number }
  | { type: "stage"; stage: string; status: "start" | "done" | "skipped"; t: number }
  | { type: "finding"; finding: Finding; t: number }
  | { type: "report"; report: AuditReport; reportHash: `0x${string}`; reportId: string; t: number }
  | { type: "guard"; watchId: string; key: string; expiresAt: number; t: number }
  | { type: "error"; message: string; t: number };
