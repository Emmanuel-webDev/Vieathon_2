"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWriteContract, usePublicClient } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { decodeEventLog } from "viem";
import type { AuditReport } from "@/lib/types";
import { EAS_ADDRESS, ZERO_ADDRESS, ZERO_BYTES32, easAbi, encodeAttestationData, easScanUrl, txScanUrl } from "@/lib/eas";

const SCHEMA_UID = process.env.NEXT_PUBLIC_EAS_SCHEMA_UID as `0x${string}` | undefined;
const targetChain = process.env.NEXT_PUBLIC_EAS_CHAIN === "mainnet" ? base : baseSepolia;

export function AttestPanel({ report, reportHash }: { report: AuditReport; reportHash: `0x${string}` }) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: targetChain.id });
  const [state, setState] = useState<{ phase: "idle" | "signing" | "confirming" | "done" | "error"; tx?: string; uid?: string; error?: string }>({ phase: "idle" });

  if (!SCHEMA_UID) {
    return (
      <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-4 text-xs text-[#8d8b86]">
        Onchain attestation is not configured on this deployment (<code className="font-mono text-[#efebe3]">NEXT_PUBLIC_EAS_SCHEMA_UID</code> is unset).
      </div>
    );
  }

  async function attest() {
    try {
      console.log(`[NightWatch:Attest] Preparing EAS attestation for report hash ${reportHash} on ${targetChain.name}...`);
      setState({ phase: "signing" });
      if (chainId !== targetChain.id) {
        console.log(`[NightWatch:Attest] Switching chain to ${targetChain.name} (${targetChain.id})...`);
        await switchChainAsync({ chainId: targetChain.id });
      }
      const dataPayload = encodeAttestationData(report, reportHash);
      console.log(`[NightWatch:Attest] Encoded payload: ${dataPayload.slice(0, 40)}... (schema UID: ${SCHEMA_UID})`);
      const tx = await writeContractAsync({
        address: EAS_ADDRESS,
        abi: easAbi,
        functionName: "attest",
        chainId: targetChain.id,
        args: [
          {
            schema: SCHEMA_UID!,
            data: {
              recipient: ZERO_ADDRESS,
              expirationTime: 0n,
              revocable: true,
              refUID: ZERO_BYTES32,
              data: dataPayload,
              value: 0n,
            },
          },
        ],
      });
      console.log(`[NightWatch:Attest] Attestation tx broadcast: ${tx}`);
      setState({ phase: "confirming", tx });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: tx });
      console.log(`[NightWatch:Attest] Attestation confirmed onchain! Block: ${receipt.blockNumber}`);
      let uid: string | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: easAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "Attested") uid = ev.args.uid as string;
        } catch {
          /* other log */
        }
      }
      console.log(`[NightWatch:Attest] Successfully created attestation UID: ${uid}`);
      setState({ phase: "done", tx, uid });
    } catch (e: any) {
      console.error("[NightWatch:Attest Error]", e);
      setState({ phase: "error", error: (e?.shortMessage || e?.message || "Transaction failed").slice(0, 240) });
    }
  }

  const c = report.summary;
  return (
    <div className="border border-[rgba(239,235,227,0.18)] bg-[#232426] p-5">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#efebe3]">
        <span className="inline-block h-2 w-2 rounded-full bg-[#e8741f]" /> Attest this scan on {targetChain.name} (EAS)
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[#8d8b86]">
        Writes report hash, target and severity counts ({c.critical}C / {c.high}H / {c.medium}M / {c.low}L) immutably to {targetChain.name}. It proves <em>what was scanned and what was found</em> — it is not a claim that the project is safe.
      </p>
      {!isConnected ? (
        <div className="flex flex-wrap gap-2">
          {connectors.map((cn) => (
            <button
              key={cn.uid}
              disabled={connecting}
              onClick={() => connect({ connector: cn, chainId: targetChain.id })}
              className="btn-sharp btn-outline-sharp px-3 py-1.5 text-[11px]"
            >
              Connect {cn.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={attest}
            disabled={state.phase === "signing" || state.phase === "confirming" || state.phase === "done"}
            className="btn-sharp btn-primary-sharp px-4 py-2 text-xs font-bold"
          >
            {state.phase === "signing" ? "CONFIRM IN WALLET…" : state.phase === "confirming" ? `WAITING FOR ${targetChain.name.toUpperCase()}…` : state.phase === "done" ? "ATTESTED ✓" : `ATTEST ON ${targetChain.name.toUpperCase()}`}
          </button>
          <span className="font-mono text-xs text-[#8d8b86]">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
          <button onClick={() => disconnect()} className="text-xs text-[#8d8b86] underline hover:text-[#efebe3]">disconnect</button>
        </div>
      )}
      {state.phase === "done" && (
        <div className="mt-3 space-y-1 text-xs">
          {state.tx && (
            <a className="text-[#e8741f] underline hover:text-[#ff8630] font-mono block" href={txScanUrl(state.tx, targetChain.id)} target="_blank" rel="noreferrer">
              View transaction on {targetChain.name === "Base" ? "Basescan" : "Base Sepolia Explorer"} →
            </a>
          )}
          {state.uid && (
            <div>
              <a className="text-[#e8741f] underline hover:text-[#ff8630] font-mono" href={easScanUrl(state.uid, targetChain.id)} target="_blank" rel="noreferrer">
                View attestation on EAS →
              </a>
              <div className="mt-1 break-all font-mono text-[11px] text-[#8d8b86]">UID: {state.uid}</div>
            </div>
          )}
        </div>
      )}
      {state.phase === "error" && <div className="mt-3 text-xs text-[#ef4444] font-mono">{state.error}</div>}
    </div>
  );
}
