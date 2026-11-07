# NightWatch — 3-Minute Live Demo Script (`DEMO.md`)

This is a click-by-click script for a 3-minute live demonstration of **NightWatch**, with exact expected outputs at every step and an instant offline fallback using pre-exported reports in [`docs/sample-reports/`](./docs/sample-reports/).

> **Methodology Notice (shown in UI and every report):**
> *"Exploit scenarios are reasoned from the code, not executed."*

---

## Pre-Demo Check (15 seconds before starting)

1. Confirm the server is running and SQLite + AI quota are healthy:
   ```bash
   curl http://localhost:3000/api/health
   ```
   **Expected JSON:**
   ```json
   {
     "ok": true,
     "db": "ok",
     "ai": {
       "provider": "gemini",
       "model": "gemini-3.5-flash",
       "deepModel": "gemini-3.5-flash",
       "available": true,
       "quota": {
         "day": "2026-11-07",
         "budget": 15,
         "used": 5,
         "remaining": 10,
         "exhausted": false
       }
     }
   }
   ```
2. Open `http://localhost:3000` in your browser.
   - Near the tier picker, verify the live badge shows **`AI quota: 10/15 left today`** (or current remaining budget) and the banner note states **`Exploit scenarios are reasoned from the code, not executed.`**

---

## Minute 0:00 – 1:00 — Sandbox Audit, Title Polish & Verifier Accuracy (`sample:rekkt-vault`)

1. **Click:** On the home scanner, click the **"Try Judge Sandbox (`sample:rekkt-vault`)"** pill (or enter `sample:rekkt-vault` and click **Run NightWatch Audit**).
2. **Expected Live Stream:**
   - Stage `collect`: `Sandbox sample: Reentrancy + tx.origin vault (1 file)`
   - Stage `static`: `Static rules scanned 1 Solidity file(s) → 6 lead(s)`
   - Stage `ai`: `AI triage cache hit (files hash 6aebf6d9ff34) — 0 provider calls used`
   - Stage `ai`: `Triage: 6 kept, 0 dismissed as false positives`
3. **Expected Report Summary:**
   - **Summary counts:** `2 Critical`, `2 High`, `1 Medium`, `0 Low`, `1 Info`
   - **Provider / Model attribution:** `Google Gemini (provider: gemini, model: gemini-3.5-flash)`
   - **Keccak256 Report Hash:** `0x4c042fb279991e969c2a0e6b9cd79a7873a05394e4b7ce974301641f33e94ce1` (deterministic over target + findings + summary)
4. **Point out two key quality guarantees:**
   - **Refined Title Polish:** Look at `sol-public-selfmint@src/RekktVault.sol:37`. Although the static regex rule matched the `setOwner` function, AI triage refined the title from the generic static rule label to:
     > **`Unprotected setOwner() allows arbitrary contract ownership takeover`** (`CRITICAL`, `<CONFIRMED>`)
   - **Verifier Accuracy (No Bogus Attacker Gain):** Open the Deep Swarm report `/deep/e1c2bfae5652d080` (or inspect `sol-tx-origin-auth@src/RekktVault.sol:42`).
     - In `RekktVault.sol:42`, `sweep()` checks `require(tx.origin == owner)` and sends ETH to `payable(owner)`.
     - Because `sweep()` pays `owner` and not the attacker, the verifier explicitly records:
       - `verdict`: **`"not_exploitable"`**
       - `attacker`: **`"phishing contract"`**
       - `gain`: **`"none"`**
       - `victim`: **`"none"`**
       - `severity`: downgraded to **`low`** (`triage.verdict: "dismissed"`)

---

## Minute 1:00 – 2:15 — GitHub Auto-Detect + Base Sepolia Demo Contract (`NightWatchDemoVault`)

1. **Click:** Switch to the **Project / GitHub** input or paste the public demo repository URL:
   ```text
   https://github.com/Emmanuel-webDev/nightwatch-demo-vault
   ```
2. **Click Auto-Detect (or inspect project detection):**
   - NightWatch reads `foundry.toml` and `broadcast/Deploy.s.sol/84532/run-latest.json` from the repo and automatically detects the deployed Base Sepolia contract:
     - **Detected Framework:** `Foundry`
     - **Detected Contract:** `NightWatchDemoVault` at **`0x70139e580853f6c54c976F027DA3059f27e554ee`** (`chainId: 84532`, source: `Foundry broadcast`)
3. **Click:** Audit the contract address directly (`0x70139e580853f6c54c976f027da3059f27e554ee`) on **Base Sepolia**:
   - **Expected Onchain Facts:**
     - `Base Sepolia RPC: 0x70139e580853f6c54c976F027DA3059f27e554ee is a contract, 2218 bytes of runtime code`
     - `owner() = 0xC0477B7C64fB76C4f5dFc083c9113D59556f5222 (EOA)`
     - `Verified source found via Etherscan V2: NightWatchDemoVault (1 file)` (`compiler: v0.8.20+commit.a1b79de6`)
   - **Expected Findings & Summary (`1 Critical`, `2 High`, `1 Medium` active; `2 Dismissed` false positives):**
     1. **`CRITICAL` (`<CONFIRMED>`):** `Unprotected setOwner() allows arbitrary contract ownership takeover` (`sol-public-selfmint` at `NightWatchDemoVault.sol:38`)
     2. **`HIGH` (`<CONFIRMED>`):** `External call before state update (reentrancy risk)` in `withdrawAll()` (`sol-reentrancy` at `NightWatchDemoVault.sol:27` — uses `unchecked { balances[msg.sender] = 0; }` after `.call{value: bal}("")`)
     3. **`HIGH` (`<CONFIRMED>`):** `tx.origin used for authorization` in `emergencySweep(address payable to)` (`sol-tx-origin-auth` at `NightWatchDemoVault.sol:43` — unlike `RekktVault.sweep()`, this sends the vault's ETH to caller-supplied `to`, so a phishing contract gains the vault ETH!)
     4. **`MEDIUM` (`<UNVERIFIED>` onchain fact):** `Privileged owner is a single EOA (0xC0477B7C64fB76C4f5dFc083c9113D59556f5222)`
     5. **`DISMISSED` (`<DISMISSED>`):** `Unchecked low-level call return value` & `Solidity floating pragma`
   - **Expected Report Hash:** `0x57b78ce4d6f4a4ed7dc82e60703c89bb2d8aad5afd0fd2cc198f3b68e74a0b99`

---

## Minute 2:15 – 3:00 — Real Base Mainnet Contract (`WETH9`) & AI Quota Guard

1. **Click:** Enter the canonical Base Mainnet WETH contract address:
   ```text
   0x4200000000000000000000000000000000000006
   ```
2. **Expected Results:**
   - `Base RPC: 0x4200000000000000000000000000000000000006 is a contract, 2041 bytes of runtime code`
   - `Verified source found via Sourcify: WETH9 (1 file)`
   - `Static rules scanned 1 Solidity file(s) → 1 lead(s)` (`sol-reentrancy` on `withdraw(uint wad)`)
   - **AI False-Positive Dismissal:** Gemini triage recognizes that `balanceOf[msg.sender] -= wad;` happens **before** `msg.sender.transfer(wad);` (`checks-effects-interactions` pattern + 2300 gas stipend) and dismisses the static lead (`Triage: 0 kept, 1 dismissed as false positives`).
   - **Expected Summary:** `0 Critical, 0 High, 0 Medium, 0 Low, 0 Info`
   - **Expected Report Hash:** `0x7ee543d51d491dbffd7c02e62b7945d5b1023362acf10f163deee492dd747f20`
3. **Highlight Cost & Quota Guard:**
   - Because all three demo targets are now cached in SQLite (`ai_cache`) by file-content SHA-256 hash, re-running any of them in the live demo uses **0 live AI calls** and completes in ~1 second.
   - If the daily AI quota (`NIGHTWATCH_AI_DAILY_BUDGET`, default `15`) is ever reached, NightWatch never fabricates findings: it skips the AI stage and displays `"Daily AI quota reached: static checks only, findings unconfirmed"`, while Deep Swarm checks the budget upfront and refuses + refunds before starting if insufficient quota remains.

---

## Instant Fallback (If Live AI Provider or Base RPC Is Slow / Unreachable)

If network connectivity, Base RPC, or the AI provider is slow during the live presentation, open the pre-generated static reports directly from [`docs/sample-reports/`](./docs/sample-reports/) in your browser or editor:

| Demo Target | Readable HTML Report | Raw JSON Report | Keccak256 Report Hash |
| :--- | :--- | :--- | :--- |
| **1. Sample (`sample:rekkt-vault`)** | [`docs/sample-reports/sample-rekkt-vault.html`](./docs/sample-reports/sample-rekkt-vault.html) | [`docs/sample-reports/sample-rekkt-vault.json`](./docs/sample-reports/sample-rekkt-vault.json) | `0x4c042fb279991e969c2a0e6b9cd79a7873a05394e4b7ce974301641f33e94ce1` |
| **2. Base Sepolia Demo (`NightWatchDemoVault`)** | [`docs/sample-reports/demo-nightwatch-vault.html`](./docs/sample-reports/demo-nightwatch-vault.html) | [`docs/sample-reports/demo-nightwatch-vault.json`](./docs/sample-reports/demo-nightwatch-vault.json) | `0x57b78ce4d6f4a4ed7dc82e60703c89bb2d8aad5afd0fd2cc198f3b68e74a0b99` |
| **3. Base Mainnet (`WETH9`)** | [`docs/sample-reports/base-weth.html`](./docs/sample-reports/base-weth.html) | [`docs/sample-reports/base-weth.json`](./docs/sample-reports/base-weth.json) | `0x7ee543d51d491dbffd7c02e62b7945d5b1023362acf10f163deee492dd747f20` |

