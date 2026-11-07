import { base, baseSepolia } from "viem/chains";
import type { ChainId } from "./types";

export const CHAINS: Record<
  ChainId,
  { name: string; viem: typeof base | typeof baseSepolia; rpc: () => string; blockscout: string; explorer: string }
> = {
  8453: {
    name: "Base",
    viem: base,
    rpc: () => process.env.BASE_RPC_URL || "https://mainnet.base.org",
    blockscout: "https://base.blockscout.com",
    explorer: "https://basescan.org",
  },
  84532: {
    name: "Base Sepolia",
    viem: baseSepolia,
    rpc: () => process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    blockscout: "https://base-sepolia.blockscout.com",
    explorer: "https://sepolia.basescan.org",
  },
};

export const CHAIN_IDS: ChainId[] = [8453, 84532];
export const isChainId = (n: unknown): n is ChainId => n === 8453 || n === 84532;
