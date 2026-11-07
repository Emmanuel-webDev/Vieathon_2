import { createPublicClient, http, getAddress, parseAbi, isAddress, keccak256, type PublicClient } from "viem";
import { CHAINS } from "./chains";
import type { ChainId } from "./types";
import type { ContractFacts, Finding } from "./types";

export function baseClient(chainId: ChainId = 8453): PublicClient {
  const c = CHAINS[chainId];
  return createPublicClient({ chain: c.viem, transport: http(c.rpc()) }) as PublicClient;
}

/** Which Base network (mainnet first, then Sepolia) has contract code at this address? */
export async function findChain(address: `0x${string}`, hint?: ChainId): Promise<ChainId | null> {
  const order: ChainId[] = hint ? [hint, ...([8453, 84532] as ChainId[]).filter((c) => c !== hint)] : [8453, 84532];
  let failures = 0;
  let lastError = "";
  for (const id of order) {
    try {
      const code = await baseClient(id).getCode({ address: getAddress(address) });
      if (code && code !== "0x") return id;
    } catch (e: any) {
      failures++;
      lastError = e?.shortMessage || e?.message || "unknown error";
    }
  }
  // Every network errored: that is an RPC problem, not proof that the address has no code.
  if (failures === order.length) throw new Error(`Could not reach the Base RPC (${String(lastError).split("\n")[0].slice(0, 120)}). Try again shortly.`);
  return null;
}

// EIP-1967 slots
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

const ownerAbi = parseAbi(["function owner() view returns (address)"]);
const pausedAbi = parseAbi(["function paused() view returns (bool)"]);
const initAbi = parseAbi(["function initialized() view returns (bool)"]);

function slotToAddress(v: string | undefined | null): `0x${string}` | undefined {
  if (!v || /^0x0*$/.test(v)) return undefined;
  const addr = ("0x" + v.slice(-40)) as `0x${string}`;
  return isAddress(addr) ? getAddress(addr) : undefined;
}

/**
 * Walk the opcode stream (skipping PUSH data) looking for SELFDESTRUCT (0xff) and DELEGATECALL (0xf4).
 * This is an exact opcode scan, not a byte grep.
 */
export function scanOpcodes(bytecode: string): { selfdestruct: boolean; delegatecall: boolean } {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  let selfdestruct = false;
  let delegatecall = false;
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; // skip PUSH immediates
    else if (op === 0xff) selfdestruct = true;
    else if (op === 0xf4) delegatecall = true;
  }
  return { selfdestruct, delegatecall };
}

export interface OnchainResult {
  facts: ContractFacts;
  findings: Finding[];
  /** Implementation address when this is a proxy (so the caller can pull its source too). */
  implementation?: `0x${string}`;
}

export async function inspectAddress(
  address: `0x${string}`,
  log: (m: string, level?: "info" | "warn" | "ok") => void,
  chainId: ChainId = 8453
): Promise<OnchainResult> {
  const client = baseClient(chainId);
  const addr = getAddress(address);
  const findings: Finding[] = [];
  const notes: string[] = [];

  const code = await client.getCode({ address: addr });
  const hasCode = !!code && code !== "0x";
  const facts: ContractFacts = {
    address: addr,
    chainId,
    codeSizeBytes: hasCode ? (code!.length - 2) / 2 : 0,
    isContract: hasCode,
    isProxy: false,
    verifiedSource: false,
    notes,
  };

  if (!hasCode) {
    log(`${addr} has no code on ${CHAINS[chainId].name} — it is an EOA or an undeployed address.`, "warn");
    notes.push(`Address has no contract code on ${CHAINS[chainId].name}.`);
    return { facts, findings };
  }
  log(`${CHAINS[chainId].name} RPC: ${addr} is a contract, ${facts.codeSizeBytes} bytes of runtime code`, "ok");

  const [implRaw, adminRaw, beaconRaw] = await Promise.all([
    client.getStorageAt({ address: addr, slot: IMPL_SLOT }).catch(() => undefined),
    client.getStorageAt({ address: addr, slot: ADMIN_SLOT }).catch(() => undefined),
    client.getStorageAt({ address: addr, slot: BEACON_SLOT }).catch(() => undefined),
  ]);
  const impl = slotToAddress(implRaw);
  const admin = slotToAddress(adminRaw);
  const beacon = slotToAddress(beaconRaw);
  if (impl) {
    facts.isProxy = true;
    facts.implementation = impl;
    facts.admin = admin;
    log(`EIP-1967 proxy → implementation ${impl}${admin ? `, admin ${admin}` : ""}`);
  } else if (beacon) {
    facts.isProxy = true;
    notes.push(`Beacon proxy (beacon ${beacon}); implementation is resolved through the beacon.`);
    log(`Beacon proxy detected (beacon ${beacon})`);
  }

  // Upgradeability control
  if (facts.isProxy && admin) {
    const adminCode = await client.getCode({ address: admin }).catch(() => undefined);
    const adminIsContract = !!adminCode && adminCode !== "0x";
    findings.push({
      id: "onchain-upgradeable-proxy",
      title: adminIsContract ? "Upgradeable proxy controlled by a contract admin" : "Upgradeable proxy controlled by a single EOA",
      severity: adminIsContract ? "low" : "high",
      category: "Centralization / Upgradeability",
      origin: "onchain",
      evidence: `EIP-1967 admin slot = ${admin} (${adminIsContract ? "contract" : "externally owned account"})`,
      description: adminIsContract
        ? "The proxy can be upgraded by an admin contract. Users must trust whoever controls that contract (multisig/timelock/ProxyAdmin owner)."
        : "The proxy admin is a plain EOA. A single compromised private key can replace the implementation and drain every user of this contract.",
      recommendation: adminIsContract
        ? "Verify the admin contract owner is a multisig with a timelock, and document the upgrade policy."
        : "Move the proxy admin to a multisig (e.g. Safe) behind a timelock, or renounce upgradeability once the contract is stable.",
    });
  }

  // owner()
  try {
    const owner = (await client.readContract({ address: addr, abi: ownerAbi, functionName: "owner" })) as `0x${string}`;
    facts.owner = owner;
    if (/^0x0{40}$/.test(owner)) {
      notes.push("owner() is the zero address (ownership renounced).");
      log("owner() = 0x0 (renounced)", "ok");
    } else {
      const oc = await client.getCode({ address: owner }).catch(() => undefined);
      facts.ownerIsContract = !!oc && oc !== "0x";
      log(`owner() = ${owner} (${facts.ownerIsContract ? "contract" : "EOA"})`);
      if (!facts.ownerIsContract) {
        findings.push({
          id: "onchain-eoa-owner",
          title: "Privileged owner is a single EOA",
          severity: "medium",
          category: "Centralization / Access control",
          origin: "onchain",
          evidence: `owner() = ${owner} has no contract code on Base`,
          description:
            "Functions guarded by the owner role are controlled by one private key. If it leaks, an attacker inherits every owner-only power (pausing, minting, fee changes, withdrawals — depending on the contract).",
          recommendation: "Transfer ownership to a multisig (Safe) and consider a timelock for sensitive actions.",
        });
      }
    }
  } catch {
    /* no owner() — fine */
  }

  try {
    const paused = await client.readContract({ address: addr, abi: pausedAbi, functionName: "paused" });
    notes.push(`paused() = ${paused}`);
  } catch {
    /* ignore */
  }
  try {
    const initialized = await client.readContract({ address: addr, abi: initAbi, functionName: "initialized" });
    if (initialized === false) {
      findings.push({
        id: "onchain-uninitialized",
        title: "Contract reports initialized() = false",
        severity: "critical",
        category: "Initialization",
        origin: "onchain",
        evidence: "initialized() returned false on Base mainnet",
        description: "An uninitialized contract can usually be initialized by anyone, who then becomes owner/admin.",
        recommendation: "Initialize immediately from the deployer, or confirm this flag does not gate privileged setup.",
      });
    }
  } catch {
    /* ignore */
  }

  const ops = scanOpcodes(code!);
  facts.hasSelfdestructOpcode = ops.selfdestruct;
  if (ops.selfdestruct && !facts.isProxy) {
    findings.push({
      id: "onchain-selfdestruct-opcode",
      title: "Runtime bytecode contains SELFDESTRUCT",
      severity: "low",
      category: "Bytecode",
      origin: "onchain",
      evidence: "Opcode 0xff found outside PUSH data in deployed runtime code",
      description:
        "Since Dencun (EIP-6780) SELFDESTRUCT only wipes a contract in the same transaction it was created, so rug-by-selfdestruct is largely mitigated. It still signals legacy or risky design and can send out the contract's ETH balance.",
      recommendation: "Confirm the opcode is unreachable or required; remove it if not.",
    });
  }

  return { facts, findings, implementation: impl };
}

export interface AddressSnapshot {
  address: string;
  isContract: boolean;
  codeHash?: string;
  implementation?: string;
  admin?: string;
  owner?: string;
}

/** Cheap, deterministic fingerprint of an address's security-relevant state, for change detection. */
export async function snapshotAddress(address: `0x${string}`, chainId: ChainId = 8453): Promise<AddressSnapshot> {
  const client = baseClient(chainId);
  const addr = getAddress(address);
  const code = await client.getCode({ address: addr });
  if (!code || code === "0x") return { address: addr, isContract: false };
  const [implRaw, adminRaw] = await Promise.all([
    client.getStorageAt({ address: addr, slot: IMPL_SLOT }).catch(() => undefined),
    client.getStorageAt({ address: addr, slot: ADMIN_SLOT }).catch(() => undefined),
  ]);
  let owner: string | undefined;
  try {
    owner = (await client.readContract({ address: addr, abi: ownerAbi, functionName: "owner" })) as string;
  } catch {
    /* no owner() */
  }
  return {
    address: addr,
    isContract: true,
    codeHash: keccak256(code),
    implementation: slotToAddress(implRaw),
    admin: slotToAddress(adminRaw),
    owner,
  };
}
