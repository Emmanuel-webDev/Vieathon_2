"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (!mounted) return <div className="h-8 w-28" />;

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        title="Disconnect wallet"
        className="rounded-none border border-[rgba(239,235,227,0.18)] bg-[#232426] px-3 py-1.5 font-mono text-xs text-[#efebe3] transition hover:border-[#e8741f] hover:text-[#e8741f]"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#e8741f] mr-2 align-middle" />
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.slice(0, 2).map((c) => (
        <button
          key={c.uid}
          disabled={isPending}
          onClick={() => connect({ connector: c })}
          className="rounded-none border border-[rgba(239,235,227,0.18)] bg-[#232426] px-3 py-1.5 text-[11px] uppercase tracking-wider font-medium text-[#efebe3] transition hover:border-[#e8741f] hover:text-[#e8741f] disabled:opacity-40"
        >
          {c.name === "Injected" ? "Connect Wallet" : c.name}
        </button>
      ))}
    </div>
  );
}
