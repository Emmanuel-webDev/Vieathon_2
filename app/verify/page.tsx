"use client";

import { useState } from "react";
import { createPublicClient, http, decodeAbiParameters, parseAbiParameters } from "viem";
import { base, baseSepolia } from "viem/chains";
import { hashReport } from "@/lib/hash";
import { EAS_ADDRESS } from "@/lib/eas";
import type { AuditReport } from "@/lib/types";

const targetChain = process.env.NEXT_PUBLIC_EAS_CHAIN === "mainnet" ? base : baseSepolia;

const getAttestationAbi = [
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export default function VerifyPage() {
  const [json, setJson] = useState("");
  const [uid, setUid] = useState("");
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    const lines: string[] = [];
    let ok = true;
    try {
      const report = JSON.parse(json) as AuditReport;
      const h = hashReport(report);
      lines.push(`Recomputed report hash: ${h}`);
      if (uid.trim()) {
        const client = createPublicClient({ chain: targetChain, transport: http() });
        const att = await client.readContract({ address: EAS_ADDRESS, abi: getAttestationAbi, functionName: "getAttestation", args: [uid.trim() as `0x${string}`] });
        if (/^0x0+$/.test(att.uid)) {
          ok = false;
          lines.push(`No attestation with that UID exists on ${targetChain.name}.`);
        } else {
          const [reportHash, target, critical, high, medium, low, scannedAt, aiReviewed] = decodeAbiParameters(
            parseAbiParameters("bytes32 reportHash, string target, uint8 critical, uint8 high, uint8 medium, uint8 low, uint64 scannedAt, bool aiReviewed"),
            att.data
          );
          lines.push(`Attested by ${att.attester} at ${new Date(Number(att.time) * 1000).toUTCString()}`);
          lines.push(`Attested target: ${target} · ${critical}C/${high}H/${medium}M/${low}L · AI reviewed: ${aiReviewed}`);
          if (att.revocationTime > 0n) {
            ok = false;
            lines.push("This attestation has been REVOKED.");
          }
          if (reportHash.toLowerCase() === h.toLowerCase()) lines.push("✓ Hash matches attestation: this is the exact attested report.");
          else {
            ok = false;
            lines.push(`✗ Hash mismatch. Attestation holds ${reportHash}. The report was altered.`);
          }
          void scannedAt;
        }
      } else {
        lines.push("Add an attestation UID to compare onchain state against Base.");
      }
    } catch (e: any) {
      ok = false;
      lines.push(`Error: ${e.shortMessage || e.message}`);
    }
    setResult({ ok, lines });
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <a href="/" className="text-xs uppercase tracking-widest text-[#8d8b86] hover:text-[#efebe3] transition">
        ← Return to NightWatch
      </a>
      <h1 className="mb-2 mt-4 font-display uppercase text-4xl text-[#efebe3]">Verify a Report</h1>
      <p className="mb-6 text-xs text-[#8d8b86] leading-relaxed">
        Paste a downloaded NightWatch report JSON and its onchain EAS attestation UID. Verified in your browser against {targetChain.name}.
      </p>

      <label htmlFor="rep" className="mb-1 block text-[11px] uppercase tracking-widest text-[#8d8b86]">Report JSON</label>
      <textarea
        id="rep"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={8}
        spellCheck={false}
        className="mb-4 w-full rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] p-3 font-mono text-xs text-[#efebe3] focus:border-[#e8741f] focus:outline-none"
      />

      <label htmlFor="uid" className="mb-1 block text-[11px] uppercase tracking-widest text-[#8d8b86]">Attestation UID (0x…)</label>
      <input
        id="uid"
        value={uid}
        onChange={(e) => setUid(e.target.value)}
        spellCheck={false}
        placeholder="0x…"
        className="mb-4 w-full rounded-none border border-[rgba(239,235,227,0.18)] bg-[#1c1d1f] p-3 font-mono text-xs text-[#efebe3] focus:border-[#e8741f] focus:outline-none"
      />

      <button
        onClick={verify}
        disabled={busy || !json.trim()}
        className="btn-sharp btn-primary-sharp px-6 py-2.5 text-xs font-bold disabled:opacity-40"
      >
        {busy ? "VERIFYING…" : "VERIFY ATTESTATION"}
      </button>

      {result && (
        <div className={`mt-6 border p-4 font-mono text-xs ${result.ok ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300" : "border-red-500/40 bg-red-950/20 text-[#ef4444]"}`}>
          {result.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </main>
  );
}
