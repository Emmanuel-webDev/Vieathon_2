import { pad, getAddress } from "viem";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwpay-"));
process.env.NIGHTWATCH_DATA_DIR = tmp;
process.env.NIGHTWATCH_TREASURY = "0x1111111111111111111111111111111111111111";
process.env.ANTHROPIC_API_KEY = "test-not-used";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const rejects = async (name: string, fn: () => Promise<unknown> | unknown, status?: number, match?: RegExp) => {
  try { await fn(); ok(name, false, "did not throw"); } catch (e: any) { ok(name, (status === undefined || e.status === status) && (!match || match.test(e.message)), `${e.status} ${e.message}`); }
};

async function main() {
  const P = await import("../lib/payments");
  const { PAY_CHAIN } = await import("../lib/pricing");
  const T = process.env.NIGHTWATCH_TREASURY!;
  const payer = "0x2222222222222222222222222222222222222222";

  // ── Transfer matching
  ok("Transfer topic constant", P.TRANSFER_TOPIC === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  const mkLog = (amount: bigint, to = T, token = PAY_CHAIN.usdc, from = payer) => ({
    address: token,
    topics: [P.TRANSFER_TOPIC, pad(from as `0x${string}`), pad(to as `0x${string}`)] as unknown as string[],
    data: "0x" + amount.toString(16).padStart(64, "0"),
  });
  ok("match exact transfer", P.matchTransfer([mkLog(1_000_123n)], PAY_CHAIN.usdc, T, 1_000_123n)?.from.toLowerCase() === payer);
  ok("reject wrong amount", P.matchTransfer([mkLog(1_000_124n)], PAY_CHAIN.usdc, T, 1_000_123n) === null);
  ok("reject wrong recipient", P.matchTransfer([mkLog(1_000_123n, "0x3333333333333333333333333333333333333333")], PAY_CHAIN.usdc, T, 1_000_123n) === null);
  ok("reject wrong token contract", P.matchTransfer([mkLog(1_000_123n, T, "0x4444444444444444444444444444444444444444" as any)], PAY_CHAIN.usdc, T, 1_000_123n) === null);
  ok("reject lookalike event (2 topics)", P.matchTransfer([{ ...mkLog(1n), topics: [P.TRANSFER_TOPIC, pad(payer as any) as string] }], PAY_CHAIN.usdc, T, 1n) === null);

  // ── Orders
  const o1 = P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "1.1.1.1");
  const o2 = P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "2.2.2.2");
  ok("orders get unique amounts", o1.amount !== o2.amount && BigInt(o1.amount) > 1_000_000n && BigInt(o1.amount) <= 1_009_999n, `${o1.amount} ${o2.amount}`);
  await rejects("sample targets need no payment", () => P.createOrder("sample:rekkt-vault", "priority", "x"), 400);
  await rejects("garbage target rejected", () => P.createOrder("not a thing !!", "priority", "x"), 400);
  for (let i = 0; i < 3; i++) P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "9.9.9.9");
  P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "9.9.9.9");
  P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "9.9.9.9");
  await rejects("per-IP open-order cap", () => P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "priority", "9.9.9.9"), 429);

  const now = Math.floor(Date.now() / 1000);
  const reader = (logs: any[], opts: { status?: "success" | "reverted"; time?: number; missing?: boolean } = {}) => ({
    getReceipt: async () => (opts.missing ? null : { status: opts.status ?? "success", blockNumber: 5n, logs }),
    blockTime: async () => opts.time ?? now,
  });
  const tx = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;

  await rejects("tx not mined yet -> 404", () => P.claimOrder(o1.orderId, tx(1), reader([], { missing: true }) as any), 404);
  await rejects("reverted tx rejected", () => P.claimOrder(o1.orderId, tx(1), reader([mkLog(BigInt(o1.amount))], { status: "reverted" }) as any), 400);
  await rejects("wrong amount rejected", () => P.claimOrder(o1.orderId, tx(1), reader([mkLog(BigInt(o1.amount) + 1n)]) as any), 400, /exactly/);
  await rejects("payment before order existed rejected", () => P.claimOrder(o1.orderId, tx(1), reader([mkLog(BigInt(o1.amount))], { time: now - 3600 }) as any), 400, /window/);
  await rejects("consume before payment -> 402", () => P.consumeOrder(o1.orderId, "priority", o1.target), 402);

  const paid = await P.claimOrder(o1.orderId, tx(1), reader([mkLog(BigInt(o1.amount))]) as any);
  ok("valid payment marks order paid", paid.status === "paid" && paid.payer?.toLowerCase() === payer);
  const again = await P.claimOrder(o1.orderId, tx(1), reader([]) as any);
  ok("claim is idempotent for the same tx", again.status === "paid");
  await rejects("same tx cannot pay a second order", () => P.claimOrder(o2.orderId, tx(1), reader([mkLog(BigInt(o2.amount))]) as any), 409);
  await rejects("victim's tx cannot satisfy another order (amount mismatch)", () => P.claimOrder(o2.orderId, tx(2), reader([mkLog(BigInt(o1.amount))]) as any), 400);

  // ── Consume / refund
  await rejects("wrong tier rejected", () => P.consumeOrder(o1.orderId, "deep", o1.target), 400, /priority/);
  await rejects("different target rejected", () => P.consumeOrder(o1.orderId, "priority", "0x4200000000000000000000000000000000000006"), 400, /different target/);
  const c = P.consumeOrder(o1.orderId, "priority", o1.target);
  ok("consume spends the credit", c.status === "consumed");
  await rejects("double spend rejected", () => P.consumeOrder(o1.orderId, "priority", o1.target), 409);
  P.refundOrder(o1.orderId);
  ok("refund restores the credit", P.getOrder(o1.orderId)?.status === "paid");
  ok("credit usable again after refund", P.consumeOrder(o1.orderId, "priority", o1.target).status === "consumed");
  P.refundOrder(o2.orderId);
  ok("refund of an unpaid order is a no-op", P.getOrder(o2.orderId)?.status === "pending");

  // ── Config
  const cfg = P.payConfig();
  ok("config: enabled, tiers priced", cfg.enabled && cfg.tiers.find((t) => t.id === "priority")?.price === "1" && cfg.tiers.find((t) => t.id === "deep")?.price === "5");
  ok("config: USDC is Circle's Base Sepolia address", cfg.usdc === "0x036CbD53842c5426634e7929541eC2318f3dCF7e" && cfg.chainId === 84532);

  // ── Queue
  const { PriorityQueue } = await import("../lib/queue");
  const q = new PriorityQueue(1, 5000);
  const order: string[] = [];
  const t0 = 1_000_000;
  const hold = q.enqueue(false, undefined, t0);
  const releaseHold = await hold.ready;
  const add = (name: string, paid: boolean, at: number) => q.enqueue(paid, undefined, at).ready.then((r) => { order.push(name); r(); });
  const ps = [add("free@0", false, t0), add("paid@1000", true, t0 + 1000), add("free@10000", false, t0 + 10_000), add("paid@11000", true, t0 + 11_000), add("paid@16000", true, t0 + 16_000)];
  releaseHold();
  await Promise.all(ps);
  ok("paid jumps ahead of recent free scans, FIFO otherwise, no starvation", order.join(",") === "paid@1000,free@0,paid@11000,free@10000,paid@16000", order.join(","));
  const q2 = new PriorityQueue(1, 0);
  const h2 = await q2.enqueue(false).ready;
  const positions: number[] = [];
  const t = q2.enqueue(false, (p) => positions.push(p));
  let cancelled = false;
  t.ready.catch(() => (cancelled = true));
  t.cancel();
  await new Promise((r) => setTimeout(r, 5));
  ok("waiting job can be cancelled and never runs", cancelled && q2.stats.waiting === 0);
  h2();

  // ── Merge + grounding
  const { mergeCandidates } = await import("../lib/merge");
  const { groundFindings } = await import("../lib/ai");
  const base: any[] = [{ id: "a", title: "Possible reentrancy in withdraw()", severity: "high", category: "Reentrancy", origin: "static", file: "V.sol", line: 27, description: "", recommendation: "" }];
  const cand = (over: any) => ({ id: "c", title: "Reentrancy via call", severity: "critical", category: "Reentrancy", origin: "ai", file: "V.sol", line: 28, description: "", recommendation: "", corroboratedBy: ["funds"], ...over });
  const m1 = mergeCandidates(base, [cand({})]);
  ok("nearby same-category candidate corroborates (and raises severity)", m1.added.length === 0 && m1.corroborated === 1 && m1.merged[0].severity === "critical" && m1.merged[0].corroboratedBy?.[0] === "funds");
  const m2 = mergeCandidates(base, [cand({ line: 90, title: "Oracle", category: "Oracle" })]);
  ok("distant/different candidate is added", m2.added.length === 1 && m2.merged.length === 2);
  ok("merge does not mutate the baseline", base[0].severity === "high" && !base[0].corroboratedBy);

  const files = [{ path: "V.sol", content: "line1\nfunction w() {\n  (bool ok,) = msg.sender.call{value: b}(\"\");\n  bal[msg.sender] = 0;\n}\n" }];
  const raw = [
    { title: "ok", severity: "high", category: "Reentrancy", file: "V.sol", line: 3, evidence: "msg.sender.call{value: b}", description: "d", recommendation: "r" },
    { title: "bad file", severity: "high", category: "x", file: "Nope.sol", line: 1, evidence: "", description: "", recommendation: "" },
    { title: "bad line", severity: "high", category: "x", file: "V.sol", line: 99, evidence: "", description: "", recommendation: "" },
    { title: "invented code", severity: "high", category: "x", file: "V.sol", line: 3, evidence: "selfdestruct(owner)", description: "", recommendation: "" },
  ];
  const g = groundFindings(raw, files, "t", "funds");
  ok("grounding keeps real findings, drops invented ones", g.findings.length === 1 && g.dropped === 3 && g.findings[0].corroboratedBy?.[0] === "funds", `${g.findings.length}/${g.dropped}`);

  // ── Detection parsers + project targets
  const D = await import("../lib/detect");
  const fb = D.parseFoundryBroadcast({ transactions: [{ transactionType: "CREATE", contractName: "Vault", contractAddress: "0x4200000000000000000000000000000000000006" }, { transactionType: "CALL", contractAddress: "0x4200000000000000000000000000000000000007" }] }, 84532);
  ok("foundry broadcast: only CREATE txs", fb.length === 1 && fb[0].name === "Vault" && fb[0].chainId === 84532);
  const ig = D.parseIgnition({ "VaultModule#Vault": "0x4200000000000000000000000000000000000006" }, 8453);
  ok("hardhat ignition addresses", ig.length === 1 && ig[0].name === "Vault" && ig[0].chainId === 8453);
  const aj = D.parseAddressJson({ baseSepolia: { Token: "0x4200000000000000000000000000000000000006" }, "8453": { Vault: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, zero: "0x0000000000000000000000000000000000000000" }, "deployments JSON");
  ok("address json: chain from parent key, zero address ignored", aj.length === 2 && aj.find((x) => x.name === "Token")?.chainId === 84532 && aj.find((x) => x.name === "Vault")?.chainId === 8453, JSON.stringify(aj));
  const env = D.parseEnvText("NEXT_PUBLIC_VAULT_ADDRESS_BASE_SEPOLIA=0x4200000000000000000000000000000000000006\nOTHER=hello\n# c\nRPC=https://x", ".env example");
  ok("env example addresses + chain from key name", env.length === 1 && env[0].chainId === 84532);
  const urls = D.extractLiveUrls("Live: https://my-app.vercel.app/. Also [x](https://foo.netlify.app) and https://shields.io/badge and https://my-app.vercel.app", "README");
  ok("live URLs from README (deduped, trailing punctuation stripped, badges ignored)", urls.length === 2 && urls[0].url === "https://my-app.vercel.app/" , JSON.stringify(urls));
  ok("chainFromName", D.chainFromName("baseSepolia") === 84532 && D.chainFromName("base-mainnet") === 8453 && D.chainFromName("database") === undefined && D.chainFromName("sepolia") === undefined);

  const { projectRaw, parseTarget } = await import("../lib/target");
  const raw1 = projectRaw({ repo: { owner: "me", name: "app" }, url: "https://app.vercel.app", contracts: [{ address: "0x4200000000000000000000000000000000000006", chainId: 84532 }] });
  const pt = parseTarget(raw1);
  ok("project target round-trips", pt.kind === "project" && pt.project?.repo?.name === "app" && pt.project?.contracts?.[0].chainId === 84532);
  await rejects("project: bad repo rejected", () => parseTarget('project:{"repo":{"owner":"a/b","name":"c"}}'), undefined, /repo/);
  await rejects("project: empty rejected", () => parseTarget("project:{}"), undefined, /Choose/);
  await rejects("project: wrong chain rejected", () => parseTarget('project:{"contracts":[{"address":"0x4200000000000000000000000000000000000006","chainId":1}]}'), undefined, /Base/);
  ok("sepolia explorer link -> chain 84532", parseTarget("https://sepolia.basescan.org/address/0x4200000000000000000000000000000000000006").chainId === 84532);

  // ── AI Quota Guard (SQLite daily budget, skip + exact message, deep swarm refuse & refund)
  const Q = await import("../lib/quota");
  const LLM = await import("../lib/llm");
  const { runAudit } = await import("../lib/audit");
  const { startDeepJob } = await import("../lib/deep");
  const { GET: healthGet } = await import("../app/api/health/route");

  delete process.env.NIGHTWATCH_AI_DAILY_BUDGET;
  ok("default NIGHTWATCH_AI_DAILY_BUDGET is 15", Q.getDailyBudget() === 15 && Q.getAIQuotaStatus().budget === 15 && Q.getAIQuotaStatus().remaining === 15);

  process.env.NIGHTWATCH_AI_DAILY_BUDGET = "2";
  LLM.resetProviderCallCount();
  LLM.setMockProviderForTests(() => JSON.stringify({ triage: [], findings: [], summary: "ok" }));

  const healthBefore = await (await healthGet()).json();
  ok("/api/health reports remaining AI budget", healthBefore.aiQuota?.budget === 2 && healthBefore.aiQuota?.remaining === 2 && healthBefore.aiBudgetRemaining === 2);

  // Consume 2 provider calls via complete()
  await LLM.complete({ system: "s", user: "u1" });
  await LLM.complete({ system: "s", user: "u2" });
  ok("SQLite tracks every provider call", Q.getAIQuotaStatus().used === 2 && Q.getAIQuotaStatus().remaining === 0 && Q.getAIQuotaStatus().exhausted === true);
  await rejects("3rd provider call rejected when budget=2", () => LLM.complete({ system: "s", user: "u3" }), undefined, /Daily AI quota reached/);

  // Audit when quota is exhausted: skips AI, no fabrication, exact message
  const callsBeforeAudit = LLM.getProviderCallCount();
  const exhaustedAudit = await runAudit("sample:rekkt-vault", () => {});
  ok(
    "exhausted quota skips AI with exact message and zero fabricated triage/AI findings",
    exhaustedAudit.report.ai.used === false &&
      exhaustedAudit.report.ai.skippedReason === "Daily AI quota reached: static checks only, findings unconfirmed" &&
      exhaustedAudit.report.limitations.includes("Daily AI quota reached: static checks only, findings unconfirmed") &&
      LLM.getProviderCallCount() === callsBeforeAudit &&
      exhaustedAudit.report.findings.every((f) => f.origin !== "ai" && f.triage === undefined)
  );

  // Deep swarm pre-check: set budget so 4 calls remain (not enough for 6-call Solidity deep swarm)
  process.env.NIGHTWATCH_AI_DAILY_BUDGET = "6"; // 2 already used -> 4 remaining < 6 needed
  const cfgLowQuota = P.payConfig();
  ok("payConfig disables deep tier when remaining budget < full lens set", cfgLowQuota.tiers.find((t) => t.id === "deep")?.available === false && cfgLowQuota.aiQuota.remaining === 4);

  // Temporarily raise budget to allow creating + paying the order, then lower before starting Deep Swarm
  process.env.NIGHTWATCH_AI_DAILY_BUDGET = "20";
  const deepOrder = P.createOrder("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "deep", "3.3.3.3");
  await P.claimOrder(deepOrder.orderId, tx(99), reader([mkLog(BigInt(deepOrder.amount))]) as any);
  P.consumeOrder(deepOrder.orderId, "deep", deepOrder.target);
  ok("deep order consumed prior to startDeepJob", P.getOrder(deepOrder.orderId)?.status === "consumed");

  process.env.NIGHTWATCH_AI_DAILY_BUDGET = "6"; // 4 remaining < 6 required for contract full lens set
  const callsBeforeDeep = LLM.getProviderCallCount();
  await rejects("startDeepJob refuses when budget insufficient for full lens set", () => startDeepJob(deepOrder.orderId, deepOrder.target), undefined, /Insufficient daily AI budget/);
  ok(
    "startDeepJob refunds credit before starting and makes zero AI calls",
    P.getOrder(deepOrder.orderId)?.status === "paid" && LLM.getProviderCallCount() === callsBeforeDeep
  );

  LLM.setMockProviderForTests(null);
  delete process.env.NIGHTWATCH_AI_DAILY_BUDGET;

  // ── Batched triage + SQLite file-content hash cache
  process.env.NIGHTWATCH_AI_DAILY_BUDGET = "50";
  LLM.resetProviderCallCount();
  LLM.setMockProviderForTests(() =>
    JSON.stringify({
      triage: [
        {
          id: "sol-public-selfmint@src/RekktVault.sol:37",
          verdict: "confirmed",
          reason: "setOwner has no access control",
          refinedTitle: "Unprotected setOwner() allows arbitrary ownership takeover",
        },
      ],
      findings: [],
      summary: "cached triage summary",
    })
  );

  const calls0 = LLM.getProviderCallCount();
  const rCold = await runAudit("sample:rekkt-vault", () => {}, { skipCache: false });
  const callsAfterCold = LLM.getProviderCallCount() - calls0;
  ok("batched triage uses 1 call across all static leads on cold scan", callsAfterCold === 1, `calls=${callsAfterCold}`);
  ok(
    "triage refines setOwner title on confirmed lead",
    rCold.report.findings.some((f) => f.id.startsWith("sol-public-selfmint@") && f.title === "Unprotected setOwner() allows arbitrary ownership takeover")
  );

  const calls1 = LLM.getProviderCallCount();
  const rWarm = await runAudit("sample:rekkt-vault", () => {}, { skipCache: false });
  const callsAfterWarm = LLM.getProviderCallCount() - calls1;
  ok("cached repeat audit uses 0 provider calls via file-content hash", callsAfterWarm === 0 && rWarm.report.ai.used === true, `calls=${callsAfterWarm}`);

  // ── Explicit Qwen International fallback + provider/model attribution on every report
  process.env.NIGHTWATCH_PROVIDER = "qwen";
  process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  const qwenInfo = LLM.getProviderInfo();
  ok(
    "qwen explicit fallback resolves Singapore intl endpoint and default models",
    qwenInfo.provider === "qwen" &&
      qwenInfo.model === "qwen-plus" &&
      qwenInfo.deepModel === "qwen-max" &&
      qwenInfo.baseURL === "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  );
  const rQwen = await runAudit("sample:rekkt-vault", () => {});
  ok(
    "every report states provider and model in report.ai and limitations",
    rQwen.report.ai.provider === "qwen" &&
      rQwen.report.ai.model === "qwen-plus" &&
      rQwen.report.limitations.some((l) => l.includes("provider: qwen, model: qwen-plus")) &&
      rQwen.report.limitations.includes("Exploit scenarios are reasoned from the code, not executed.")
  );
  delete process.env.NIGHTWATCH_PROVIDER;
  delete process.env.DASHSCOPE_API_KEY;

  LLM.setMockProviderForTests(null);
  delete process.env.NIGHTWATCH_AI_DAILY_BUDGET;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
