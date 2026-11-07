import { isAddress, parseUnits } from "viem";

/**
 * Pay-per-audit configuration. Testnet only: payments are plain USDC transfers on Base Sepolia
 * to NIGHTWATCH_TREASURY. The server never holds a private key; it only reads the chain.
 */
export const PAY_CHAIN = {
  id: 84532,
  name: "Base Sepolia",
  /** Circle's official Base Sepolia USDC (developers.circle.com/stablecoins/usdc-contract-addresses). */
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  decimals: 6,
  rpc: () => process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",
  faucet: "https://faucet.circle.com",
} as const;

export type PaidTier = "priority" | "deep";
export type Tier = "standard" | PaidTier;

export const TIER_INFO: Record<PaidTier, { label: string; blurb: string; defaultUsdc: string; envKey: string }> = {
  priority: {
    label: "Priority",
    blurb: "Skips ahead of free scans waiting in the queue. Same analysis as the free tier.",
    defaultUsdc: "1",
    envKey: "NIGHTWATCH_PRICE_PRIORITY_USDC",
  },
  deep: {
    label: "Deep swarm",
    blurb: "Multiple specialist AI reviewers plus an adversarial verifier that tries to build a concrete exploit for each finding. Runs in the background.",
    defaultUsdc: "5",
    envKey: "NIGHTWATCH_PRICE_DEEP_USDC",
  },
};

/** Price in USDC base units (6 decimals). */
export function priceMicro(tier: PaidTier): bigint {
  const raw = process.env[TIER_INFO[tier].envKey] || TIER_INFO[tier].defaultUsdc;
  try {
    const v = parseUnits(raw, PAY_CHAIN.decimals);
    if (v <= 0n || v > 100_000_000n) throw new Error("out of range");
    return v;
  } catch {
    throw new Error(`${TIER_INFO[tier].envKey} must be a USDC amount between 0 and 100`);
  }
}

export function treasury(): `0x${string}` | null {
  const t = process.env.NIGHTWATCH_TREASURY;
  return t && isAddress(t) ? (t as `0x${string}`) : null;
}

export const ORDER_TTL_MS = 30 * 60_000;
/** Each order gets a unique 1..9999 micro-USDC suffix so a transfer maps to exactly one order. */
export const DUST_MAX = 9999;
