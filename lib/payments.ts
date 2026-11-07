import { createPublicClient, formatUnits, http, keccak256, toHex } from "viem";
import { baseSepolia } from "viem/chains";
import { randomBytes, randomInt } from "crypto";
import { db } from "./db";
import { parseTarget } from "./target";
import { aiAvailable } from "./ai";
import { checkDeepBudget, getAIQuotaStatus } from "./quota";
import { DUST_MAX, ORDER_TTL_MS, PAY_CHAIN, TIER_INFO, priceMicro, treasury, type PaidTier } from "./pricing";

/**
 * Pay-per-audit on Base Sepolia USDC.
 *
 * Flow: createOrder → user sends exactly `amount` USDC to the treasury → claimOrder(txHash) verifies the
 * ERC-20 Transfer log on chain → the order becomes a single-use credit → consumeOrder when the audit starts
 * (refunded back to a credit if the run fails before producing a report).
 *
 * Binding a transfer to an order: every order gets a unique amount (price + 1..9999 micro-USDC), so a
 * transaction can only ever match one order, and a tx hash can only be claimed once (UNIQUE column).
 * This is a payment, not a refundable stake: an escrow contract would be needed for stake-and-slash.
 */
export class PayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
}

/** Find an ERC-20 Transfer(from, to == treasury, value == amount) emitted by the USDC contract. */
export function matchTransfer(logs: readonly RawLog[], usdc: string, to: string, amount: bigint): { from: string } | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== usdc.toLowerCase()) continue;
    if (l.topics.length !== 3 || l.topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    const toAddr = "0x" + l.topics[2].slice(-40);
    if (toAddr.toLowerCase() !== to.toLowerCase()) continue;
    let value: bigint;
    try {
      value = BigInt(l.data);
    } catch {
      continue;
    }
    if (value !== amount) continue;
    return { from: "0x" + l.topics[1].slice(-40) };
  }
  return null;
}

export interface ChainReader {
  getReceipt(hash: `0x${string}`): Promise<{ status: "success" | "reverted"; blockNumber: bigint; logs: readonly RawLog[] } | null>;
  blockTime(blockNumber: bigint): Promise<number>;
}

export function defaultReader(): ChainReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(PAY_CHAIN.rpc()) });
  return {
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber, logs: r.logs as unknown as RawLog[] };
      } catch (e: any) {
        if (/not be found|not found/i.test(e?.message ?? "")) return null;
        throw e;
      }
    },
    async blockTime(n) {
      return Number((await client.getBlock({ blockNumber: n })).timestamp);
    },
  };
}

export interface OrderView {
  id: string;
  tier: PaidTier;
  target: string;
  amount: string;
  status: "pending" | "paid" | "consumed";
  expiresAt: number;
  txHash?: string;
  payer?: string;
  jobId?: string;
}

function rowToView(r: any): OrderView {
  return {
    id: r.id,
    tier: r.tier,
    target: r.target,
    amount: r.amount,
    status: r.status,
    expiresAt: r.expires_at,
    txHash: r.tx_hash ?? undefined,
    payer: r.payer ?? undefined,
    jobId: r.job_id ?? undefined,
  };
}

export function payConfig() {
  const tr = treasury();
  const ai = aiAvailable();
  const aiQuota = getAIQuotaStatus();
  const deepBudget = checkDeepBudget();
  const tiers = (Object.keys(TIER_INFO) as PaidTier[]).map((id) => {
    let price = "";
    try {
      price = formatUnits(priceMicro(id), PAY_CHAIN.decimals);
    } catch {
      /* misconfigured price */
    }
    const deepQuotaOk = id !== "deep" || deepBudget.ok;
    return {
      id,
      label: TIER_INFO[id].label,
      blurb: TIER_INFO[id].blurb,
      price,
      available: !!tr && !!price && (id !== "deep" || ai) && deepQuotaOk,
      unavailableReason: !tr
        ? "Payments are not configured on this deployment."
        : id === "deep" && !ai
        ? "The deep swarm needs an AI API key (ANTHROPIC_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY) on the server."
        : id === "deep" && !deepQuotaOk
        ? `Insufficient daily AI budget for Deep Swarm (${aiQuota.remaining}/${aiQuota.budget} remaining today; needs ${deepBudget.needed}).`
        : undefined,
    };
  });
  return {
    enabled: !!tr,
    chainId: PAY_CHAIN.id,
    chainName: PAY_CHAIN.name,
    usdc: PAY_CHAIN.usdc,
    decimals: PAY_CHAIN.decimals,
    treasury: tr,
    faucet: PAY_CHAIN.faucet,
    explorer: PAY_CHAIN.explorer,
    tiers,
    aiQuota,
  };
}

export function createOrder(targetRaw: string, tier: PaidTier, ip: string) {
  const tr = treasury();
  if (!tr) throw new PayError(501, "Payments are not configured (NIGHTWATCH_TREASURY).");
  if (!TIER_INFO[tier]) throw new PayError(400, "Unknown tier.");
  const raw = targetRaw.trim().slice(0, 2000);
  let kind: string;
  try {
    kind = parseTarget(raw).kind;
  } catch (e: any) {
    throw new PayError(400, e.message);
  }
  if (kind === "sample") throw new PayError(400, "Sandbox samples are free; no payment is needed.");
  if (tier === "deep" && !aiAvailable()) throw new PayError(503, "The deep swarm needs an AI API key (ANTHROPIC_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY) configured on the server.");
  if (tier === "deep") {
    const b = checkDeepBudget(raw);
    if (!b.ok) {
      throw new PayError(429, `Insufficient daily AI budget for Deep Swarm: requires ${b.needed} requests for the full lens set, only ${b.quota.remaining}/${b.quota.budget} remaining today.`);
    }
  }

  const d = db();
  const now = Date.now();
  const open = d.prepare("SELECT COUNT(*) AS c FROM orders WHERE ip = ? AND status = 'pending' AND expires_at > ?").get(ip, now).c as number;
  if (open >= 5) throw new PayError(429, "Too many unpaid orders open. Pay one or wait for them to expire (30 min).");

  const base = priceMicro(tier);
  for (let i = 0; i < 60; i++) {
    const amount = base + BigInt(randomInt(1, DUST_MAX + 1));
    const clash = d.prepare("SELECT 1 AS x FROM orders WHERE amount = ? AND status = 'pending' AND expires_at > ?").get(amount.toString(), now);
    if (clash) continue;
    const id = randomBytes(16).toString("hex");
    d.prepare("INSERT INTO orders (id, tier, target, amount, status, ip, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      tier,
      raw,
      amount.toString(),
      "pending",
      ip,
      now,
      now + ORDER_TTL_MS
    );
    return { orderId: id, tier, target: raw, amount: amount.toString(), amountDisplay: formatUnits(amount, PAY_CHAIN.decimals), treasury: tr, usdc: PAY_CHAIN.usdc, chainId: PAY_CHAIN.id, expiresAt: now + ORDER_TTL_MS };
  }
  throw new PayError(503, "Too many open orders right now. Try again in a minute.");
}

const ID_RE = /^[0-9a-f]{32}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

export function getOrder(id: string): OrderView | null {
  if (!ID_RE.test(id)) return null;
  const r = db().prepare("SELECT * FROM orders WHERE id = ?").get(id);
  return r ? rowToView(r) : null;
}

/** Verify the payment onchain and turn the order into a single-use credit. Idempotent for the same tx. */
export async function claimOrder(orderId: string, txHashIn: string, reader: ChainReader = defaultReader()): Promise<OrderView> {
  if (!ID_RE.test(orderId)) throw new PayError(400, "Invalid order id.");
  if (!TX_RE.test(txHashIn)) throw new PayError(400, "Invalid transaction hash.");
  const txHash = txHashIn.toLowerCase() as `0x${string}`;
  const tr = treasury();
  if (!tr) throw new PayError(501, "Payments are not configured.");
  const d = db();
  const row = d.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!row) throw new PayError(404, "Order not found.");
  if (row.status !== "pending") {
    if (row.tx_hash === txHash) return rowToView(row);
    throw new PayError(409, `Order is already ${row.status}.`);
  }
  const used = d.prepare("SELECT id FROM orders WHERE tx_hash = ?").get(txHash);
  if (used && used.id !== orderId) throw new PayError(409, "That transaction was already used for another order.");

  const receipt = await reader.getReceipt(txHash);
  if (!receipt) throw new PayError(404, "Transaction not found yet on Base Sepolia. Wait a few seconds and try again.");
  if (receipt.status !== "success") throw new PayError(400, "That transaction reverted.");
  const amount = BigInt(row.amount);
  const m = matchTransfer(receipt.logs, PAY_CHAIN.usdc, tr, amount);
  if (!m) {
    throw new PayError(400, `No USDC transfer of exactly ${formatUnits(amount, PAY_CHAIN.decimals)} to the NightWatch treasury in that transaction.`);
  }
  const tsMs = (await reader.blockTime(receipt.blockNumber)) * 1000;
  if (tsMs < row.created_at - 60_000 || tsMs > row.expires_at + 60_000) {
    throw new PayError(400, "That payment was not made within this order's 30-minute window.");
  }
  try {
    const res = d.prepare("UPDATE orders SET status = 'paid', tx_hash = ?, payer = ?, paid_at = ? WHERE id = ? AND status = 'pending'").run(txHash, m.from, Date.now(), orderId);
    if (res.changes !== 1) throw new PayError(409, "Order was updated concurrently. Reload and check its status.");
  } catch (e: any) {
    if (e instanceof PayError) throw e;
    throw new PayError(409, "That transaction was already used for another order.");
  }
  return rowToView(d.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
}

/** Atomically spend a paid credit. Fails if it is unpaid, already spent, or for a different tier/target. */
export function consumeOrder(orderId: string, tier: PaidTier, target: string): OrderView {
  if (!ID_RE.test(orderId)) throw new PayError(400, "Invalid order id.");
  const d = db();
  const res = d.prepare("UPDATE orders SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'paid' AND tier = ? AND target = ?").run(Date.now(), orderId, tier, target.trim());
  if (res.changes !== 1) {
    const r = d.prepare("SELECT tier, target, status FROM orders WHERE id = ?").get(orderId);
    if (!r) throw new PayError(404, "Order not found.");
    if (r.status === "pending") throw new PayError(402, "This order has not been paid yet.");
    if (r.status === "consumed") throw new PayError(409, "This payment was already used.");
    if (r.tier !== tier) throw new PayError(400, `This order is for the ${r.tier} tier.`);
    throw new PayError(400, "This payment was made for a different target.");
  }
  return rowToView(d.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
}

/** The run failed before producing a report: give the credit back. */
export function refundOrder(orderId: string) {
  db().prepare("UPDATE orders SET status = 'paid', consumed_at = NULL, job_id = NULL WHERE id = ? AND status = 'consumed'").run(orderId);
}

export function attachJob(orderId: string, jobId: string) {
  db().prepare("UPDATE orders SET job_id = ? WHERE id = ?").run(jobId, orderId);
}
