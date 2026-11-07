"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { parseAbi } from "viem";

export interface PayConfig {
  enabled: boolean;
  chainId: number;
  chainName: string;
  usdc: `0x${string}`;
  treasury: `0x${string}` | null;
  faucet: string;
  explorer: string;
  tiers: { id: "priority" | "deep"; label: string; blurb: string; price: string; available: boolean; unavailableReason?: string }[];
  aiQuota?: { day: string; budget: number; used: number; remaining: number; exhausted: boolean };
}

const erc20 = parseAbi(["function transfer(address to, uint256 value) returns (bool)", "function balanceOf(address a) view returns (uint256)"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function usePayConfig() {
  const [cfg, setCfg] = useState<PayConfig | null>(null);
  const refresh = () => {
    fetch("/api/pay/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg(null));
  };
  useEffect(() => {
    refresh();
  }, []);
  return { cfg, refresh };
}

const store = {
  get(k: string): any {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

/** Pay for a Priority / Deep credit with testnet USDC and return the verified order id. */
export function usePayment() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: baseSepolia.id });
  const [status, setStatus] = useState<string | null>(null);

  async function claim(orderId: string, txHash: string): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const r = await fetch("/api/pay/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, txHash }) });
      const j = await r.json();
      if (r.ok) return true;
      if (r.status !== 404) throw new Error(j.error || `Verification failed (${r.status})`);
      await sleep(2000);
    }
    return false;
  }

  async function ensureCredit(target: string, tier: "priority" | "deep", cfg: PayConfig): Promise<string> {
    if (!isConnected || !address) throw new Error("Connect a wallet first (top right).");
    const creditKey = `nw_credit:${tier}:${target}`;
    const pendingKey = `nw_pending:${tier}:${target}`;

    // 1. a credit already paid for this exact target and tier
    const saved = store.get(creditKey);
    if (saved?.orderId) {
      const r = await fetch(`/api/pay/order/${saved.orderId}`, { cache: "no-store" });
      if (r.ok) {
        const o = await r.json();
        if (o.status === "paid" && o.tier === tier && o.target === target) return saved.orderId;
      }
      store.del(creditKey);
    }

    // 2. a payment already sent but not yet verified: finish verifying it instead of paying twice
    const pending = store.get(pendingKey);
    if (pending?.orderId && pending?.hash) {
      setStatus("Verifying your earlier payment…");
      try {
        if (await claim(pending.orderId, pending.hash)) {
          store.del(pendingKey);
          store.set(creditKey, { orderId: pending.orderId });
          return pending.orderId;
        }
        throw new Error(`Your earlier payment (${pending.hash}) is still being verified. Try again in a minute. You will not be charged twice.`);
      } catch (e: any) {
        if (/earlier payment/.test(e.message)) throw e;
        store.del(pendingKey); // expired / used / wrong: start over
      }
    }

    // 3. new order
    console.log(`[NightWatch:Pay] Creating order for tier='${tier}', target='${target}'...`);
    setStatus("Creating order…");
    const res = await fetch("/api/pay/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, tier }) });
    const order = await res.json();
    if (!res.ok) {
      console.error("[NightWatch:Pay Error] Could not create order:", order);
      throw new Error(order.error || "Could not create the order.");
    }
    console.log(`[NightWatch:Pay] Order created: ${order.orderId}, amount: ${order.amountDisplay} USDC, treasury: ${order.treasury}`);

    if (chainId !== cfg.chainId) {
      console.log(`[NightWatch:Pay] Prompting wallet to switch chain to ${cfg.chainName} (${cfg.chainId})...`);
      setStatus(`Switch your wallet to ${cfg.chainName}…`);
      await switchChainAsync({ chainId: cfg.chainId });
    }
    const amount = BigInt(order.amount);
    const bal = (await publicClient!.readContract({ address: order.usdc, abi: erc20, functionName: "balanceOf", args: [address] })) as bigint;
    console.log(`[NightWatch:Pay] Wallet balance: ${Number(bal) / 1e6} USDC, required: ${order.amountDisplay} USDC`);
    if (bal < amount) {
      throw new Error(`You need ${order.amountDisplay} testnet USDC on ${cfg.chainName} (you have ${Number(bal) / 1e6}). Get free testnet USDC at ${cfg.faucet}, plus a little Base Sepolia ETH for gas.`);
    }

    console.log(`[NightWatch:Pay] Requesting wallet transfer signature for ${order.amountDisplay} USDC...`);
    setStatus(`Confirm the ${order.amountDisplay} USDC transfer in your wallet…`);
    const hash = await writeContractAsync({ address: order.usdc, abi: erc20, functionName: "transfer", args: [order.treasury, amount], chainId: cfg.chainId });
    console.log(`[NightWatch:Pay] Transfer tx submitted: ${hash}`);
    store.set(pendingKey, { orderId: order.orderId, hash });
    setStatus(`Waiting for ${cfg.chainName} to confirm…`);
    await publicClient!.waitForTransactionReceipt({ hash });
    console.log(`[NightWatch:Pay] Tx confirmed onchain. Verifying on server (/api/pay/claim)...`);
    setStatus("Verifying the payment onchain…");
    if (!(await claim(order.orderId, hash))) {
      console.error(`[NightWatch:Pay Error] Payment verification timed out for tx ${hash}`);
      throw new Error(`Payment sent (${hash}) but not verified yet. Click again in a minute: you will not be charged twice.`);
    }
    console.log(`[NightWatch:Pay] Order verified and credit attached: ${order.orderId}`);
    store.del(pendingKey);
    store.set(creditKey, { orderId: order.orderId });
    return order.orderId;
  }

  return { ensureCredit, status, clearStatus: () => setStatus(null), isConnected };
}

export function TierPicker({
  cfg,
  tier,
  onChange,
}: {
  cfg: PayConfig | null;
  tier: "standard" | "priority" | "deep";
  onChange: (t: "standard" | "priority" | "deep") => void;
}) {
  const opts: { id: "standard" | "priority" | "deep"; num: string; label: string; price: string; blurb: string; ok: boolean; why?: string }[] = [
    { id: "standard", num: "01", label: "Standard", price: "Free", blurb: "Full pipeline: onchain checks, static rules, and AI triage.", ok: true },
    ...(["priority", "deep"] as const).map((id, idx) => {
      const t = cfg?.tiers.find((x) => x.id === id);
      return {
        id,
        num: idx === 0 ? "02" : "03",
        label: t?.label ?? id,
        price: t?.price ? `${t.price} USDC` : "—",
        blurb: t?.blurb ?? "",
        ok: !!t?.available,
        why: t?.unavailableReason ?? "Payments are not available.",
      };
    }),
  ];
  return (
    <div>
      <div role="radiogroup" aria-label="Audit tier" className="grid gap-px bg-[rgba(239,235,227,0.18)] border border-[rgba(239,235,227,0.18)] sm:grid-cols-3">
        {opts.map((o) => {
          const selected = tier === o.id;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={selected}
              disabled={!o.ok}
              onClick={() => onChange(o.id)}
              title={o.ok ? o.blurb : o.why}
              className={`p-4 text-left transition relative ${
                selected
                  ? "bg-[#2a2b2e] ring-1 ring-inset ring-[#e8741f]"
                  : "bg-[#232426] hover:bg-[#28292c]"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-[#8d8b86] mb-2 font-mono">
                <span>{o.num}</span>
                <span className={selected ? "text-[#e8741f] font-semibold" : ""}>{selected ? "SELECTED" : ""}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display uppercase text-lg tracking-wide text-[#efebe3]">{o.label}</span>
                <span className={`font-display text-lg tracking-wide ${selected ? "text-[#e8741f]" : "text-[#efebe3]"}`}>
                  {o.price}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#8d8b86]">{o.ok ? o.blurb : o.why}</p>
            </button>
          );
        })}
      </div>
      {cfg?.aiQuota && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <span className={cfg.aiQuota.exhausted ? "text-amber-300" : "text-[#8d8b86]"}>
            {cfg.aiQuota.exhausted
              ? `Daily AI quota reached (0/${cfg.aiQuota.budget} remaining today) — static checks only, findings unconfirmed.`
              : `Daily AI budget: ${cfg.aiQuota.remaining}/${cfg.aiQuota.budget} provider calls remaining (${cfg.aiQuota.day} UTC)`}
          </span>
        </div>
      )}
      {cfg?.enabled && tier !== "standard" && (
        <p className="mt-2 text-[11px] text-[#8d8b86]">
          Testnet only: verified USDC transfer on {cfg.chainName}. Faucet:{" "}
          <a href={cfg.faucet} target="_blank" rel="noreferrer" className="text-[#e8741f] underline hover:text-[#ff8630]">Circle Base Sepolia</a>. Priority skips ahead in queue; Deep runs multi-specialist verification. Failed runs auto-refund your credit.
        </p>
      )}
    </div>
  );
}
