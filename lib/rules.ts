import type { Finding, Severity, SourceFile } from "./types";

/**
 * Deterministic Solidity heuristics. These are *leads*, not verdicts:
 * every hit carries file + line + the matching source line, and the AI triage step
 * later confirms or dismisses each one against the surrounding code.
 */

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  re: RegExp;
  description: string;
  recommendation: string;
  /** extra guard on the matched line / file */
  when?: (line: string, file: SourceFile) => boolean;
}

const rules: Rule[] = [
  {
    id: "sol-tx-origin-auth",
    title: "tx.origin used for authorization",
    severity: "high",
    category: "Access control",
    re: /\btx\.origin\b/,
    when: (l) => /(require|if|assert|==|!=)/.test(l),
    description: "tx.origin is the original signer, so any contract the victim interacts with can relay calls that pass this check (phishing-style attack).",
    recommendation: "Authorize with msg.sender (or a signature check) instead of tx.origin.",
  },
  {
    id: "sol-delegatecall",
    title: "delegatecall present",
    severity: "medium",
    category: "Dangerous call",
    re: /\.delegatecall\s*\(/,
    description: "delegatecall runs foreign code in this contract's storage context. If the target is attacker-influenced, it can overwrite storage or self-destruct.",
    recommendation: "Make sure the target is immutable/trusted and not user-supplied; prefer standard proxy libraries.",
  },
  {
    id: "sol-selfdestruct",
    title: "selfdestruct present",
    severity: "medium",
    category: "Dangerous call",
    re: /\b(selfdestruct|suicide)\s*\(/,
    description: "selfdestruct can force-send ETH and remove code. Behavior changed with EIP-6780 but it is still a red flag when reachable by privileged keys.",
    recommendation: "Remove it, or confirm it is access-controlled and necessary.",
  },
  {
    id: "sol-unchecked-low-level-call",
    title: "Low-level call return value not checked",
    severity: "high",
    category: "Unchecked return value",
    re: /(?:^\s*|[;{}]\s*)[\w.\[\]()]+\.(call|send)\s*(\{[^}]*\})?\s*\([^;]*\)\s*;/,
    description: "A failed low-level call returns false instead of reverting. Ignoring it can leave state updated while funds were never sent.",
    recommendation: "Capture `(bool ok, ) = ...` and `require(ok)`, or use Address.sendValue / SafeTransferLib.",
  },
  {
    id: "sol-unchecked-erc20-transfer",
    title: "ERC-20 transfer/transferFrom return value ignored",
    severity: "medium",
    category: "Unchecked return value",
    re: /(?:^\s*|[;{}]\s*)[A-Za-z_][\w.\[\]()]*\.(transfer|transferFrom)\s*\([^;]*\)\s*;/,
    when: (l) => !/safe(Transfer|TransferFrom)/.test(l) && !/payable\s*\(/.test(l) && !/\.transfer\s*\(\s*[^,)]+\s*\)\s*;/.test(l),
    description: "Some tokens (e.g. USDT-style) return false rather than reverting. Ignoring the result lets accounting drift from reality.",
    recommendation: "Use OpenZeppelin SafeERC20 (safeTransfer / safeTransferFrom).",
  },
  {
    id: "sol-arbitrary-from-transferfrom",
    title: "transferFrom with caller-controlled `from`",
    severity: "high",
    category: "Access control",
    re: /\.(safeTransferFrom|transferFrom)\s*\(\s*(from|_from|user|account|owner_)\s*,/,
    description: "If `from` is a function argument, anyone can spend tokens from any address that has approved this contract.",
    recommendation: "Pull funds only from msg.sender, or verify a signature/allowance relationship for `from`.",
  },
  {
    id: "sol-ecrecover-zero",
    title: "ecrecover used directly",
    severity: "medium",
    category: "Signature handling",
    re: /\becrecover\s*\(/,
    description: "Raw ecrecover returns address(0) on malformed signatures and accepts malleable (s,v) pairs. Missing zero-address checks or nonce/replay protection are common exploits.",
    recommendation: "Use OpenZeppelin ECDSA.recover, include chainId + nonce + deadline in the signed digest (EIP-712).",
  },
  {
    id: "sol-block-timestamp-randomness",
    title: "Block data used as randomness",
    severity: "medium",
    category: "Weak randomness",
    re: /(keccak256|uint\d*)\s*\([^;]*(block\.(timestamp|number|prevrandao|difficulty|coinbase)|blockhash)[^;]*\)/,
    description: "Block fields are observable and, on L2 sequencers, influenceable. Using them for randomness lets attackers predict outcomes.",
    recommendation: "Use a verifiable randomness source (Chainlink VRF) or commit-reveal.",
  },
  {
    id: "sol-spot-price-oracle",
    title: "Possible spot-price oracle from DEX reserves",
    severity: "high",
    category: "Oracle manipulation",
    re: /\b(getReserves|slot0)\s*\(/,
    when: (l) => !/\bfunction\b/.test(l),
    description: "Prices derived from instantaneous pool reserves/slot0 can be moved within a single transaction using a flash loan.",
    recommendation: "Use a Chainlink feed or a TWAP with a meaningful window and sanity bounds.",
  },
  {
    id: "sol-unprotected-initializer",
    title: "initialize() without an initializer guard",
    severity: "high",
    category: "Initialization",
    re: /function\s+(initialize|init|__\w+_init)\s*\([^)]*\)\s*(external|public)(?![^{]*\b(initializer|onlyInitializing|reinitializer|onlyOwner|onlyRole|auth|only\w+))/,
    description: "An initializer that can be called repeatedly (or by anyone) lets an attacker take ownership.",
    recommendation: "Add OpenZeppelin `initializer`, call `_disableInitializers()` in the implementation constructor.",
  },
  {
    id: "sol-public-selfmint",
    title: "mint/burn external function without visible access control",
    severity: "high",
    category: "Access control",
    re: /function\s+(mint|_mint\w*|burn|burnFrom|setOwner|transferOwnership|setFee\w*|setAdmin|upgradeTo\w*)\s*\([^)]*\)\s*(external|public)(?![^{;]*\b(only\w+|auth\w*|requiresAuth|if(Admin|Owner|Authorized|Governance)\w*|whenNotPaused\s+only\w+))(?![^{;]*\b(view|pure)\b)/,
    description: "A sensitive state-changing function is externally callable and the signature shows no modifier. It may be protected inside the body — triage will check.",
    recommendation: "Restrict with onlyOwner / role-based access control and emit events for each privileged action.",
  },
  {
    id: "sol-floating-pragma",
    title: "Floating pragma",
    severity: "info",
    category: "Hygiene",
    re: /pragma\s+solidity\s*\^/,
    description: "Contracts should be deployed with the compiler version they were tested on.",
    recommendation: "Pin the pragma (e.g. `pragma solidity 0.8.26;`).",
  },
  {
    id: "sol-old-compiler",
    title: "Solidity < 0.8 (no built-in overflow checks)",
    severity: "medium",
    category: "Arithmetic",
    re: /pragma\s+solidity\s*[\^>=~\s]*0\.[0-7]\./,
    description: "Pre-0.8 Solidity wraps silently on overflow unless SafeMath is used consistently.",
    recommendation: "Upgrade to >=0.8.20 or verify SafeMath is applied to every arithmetic operation.",
  },
  {
    id: "sol-unchecked-block",
    title: "unchecked arithmetic block",
    severity: "info",
    category: "Arithmetic",
    re: /\bunchecked\s*\{/,
    description: "Overflow protection is disabled inside this block. Safe only if bounds are provably enforced.",
    recommendation: "Confirm each operation inside cannot overflow/underflow.",
  },
];

function stripComments(src: string): string {
  // keep line numbers: replace comment text with spaces
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, (m) => " ".repeat(m.length));
}

export function runSolidityRules(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  // "Solidity < 0.8" is a property of the whole contract, not of each file: report it once per source group
  // (files are prefixed "Name[0xaddr]/" for onchain sources; repo files share the empty group).
  const groupOf = (p: string) => (/^[^/]+\[0x[0-9a-fA-F]+\]\//.test(p) ? p.slice(0, p.indexOf("/")) : "");
  const oldCompilerReported = new Set<string>();
  const usesSafeMath = new Set<string>();
  for (const f of files) if (/\.sol$/i.test(f.path) && /\bSafeMath\b/.test(f.content)) usesSafeMath.add(groupOf(f.path));
  for (const file of files) {
    if (!/\.sol$/i.test(file.path)) continue;
    // Library code vendored from OZ etc. is noisy; skip well-known dependency paths.
    if (/(^|\/)(@openzeppelin|openzeppelin-contracts|solmate|solady|forge-std|@chainlink|@uniswap)\//i.test(file.path)) continue;
    const clean = stripComments(file.content);
    const lines = clean.split("\n");
    const original = file.content.split("\n");

    // function-signature rules can span several lines: test against a joined window
    for (let i = 0; i < lines.length; i++) {
      for (const rule of rules) {
        const isSig = rule.id === "sol-unprotected-initializer" || rule.id === "sol-public-selfmint";
        if (isSig && !/function\s/.test(lines[i])) continue;
        // For signature rules, test only the function header: from this line up to the first "{" or ";".
        let target = lines[i];
        if (isSig) {
          let hdr = "";
          for (let k = i; k < Math.min(lines.length, i + 8); k++) {
            const cut = lines[k].search(/[{;]/);
            hdr += (cut >= 0 ? lines[k].slice(0, cut) : lines[k]) + " ";
            if (cut >= 0) break;
          }
          target = hdr;
        }
        if (!rule.re.test(target)) continue;
        if (rule.when && !rule.when(lines[i], file)) continue;
        const key = `${rule.id}:${file.path}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let severity = rule.severity;
        let description = rule.description;
        if (rule.id === "sol-old-compiler") {
          const g = groupOf(file.path);
          if (oldCompilerReported.has(g)) continue;
          oldCompilerReported.add(g);
          if (usesSafeMath.has(g)) {
            severity = "low";
            description += " SafeMath is used in this source; check that it covers every operation.";
          }
        }
        let title = rule.title;
        if (rule.id === "sol-public-selfmint") {
          const fnNameMatch = target.match(/function\s+(\w+)/);
          const fnName = fnNameMatch ? fnNameMatch[1] : "";
          if (/owner|admin|upgrade/i.test(fnName)) {
            title = `External ${fnName}() without visible access control`;
          } else if (/mint/i.test(fnName)) {
            title = `External ${fnName}() without visible access control (unauthorized mint)`;
          } else if (/burn/i.test(fnName)) {
            title = `External ${fnName}() without visible access control (unauthorized burn)`;
          } else if (/fee|recipient|setter/i.test(fnName)) {
            title = `External ${fnName}() without visible access control (parameter update)`;
          } else if (fnName) {
            title = `External ${fnName}() without visible access control`;
          }
        }
        findings.push({
          id: `${rule.id}@${file.path}:${i + 1}`,
          title,
          severity,
          category: rule.category,
          origin: "static",
          file: file.path,
          line: i + 1,
          evidence: original[i]?.trim().slice(0, 200),
          description,
          recommendation: rule.recommendation,
        });
      }
    }

    // Reentrancy heuristic: external value call followed by a state write inside the same function, no guard.
    const fnRe = /function\s+(\w+)\s*\([^)]*\)[^{;]*\{/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(clean))) {
      const start = m.index + m[0].length;
      let depth = 1;
      let j = start;
      while (j < clean.length && depth > 0) {
        if (clean[j] === "{") depth++;
        else if (clean[j] === "}") depth--;
        j++;
      }
      const body = clean.slice(start, j);
      const header = m[0];
      if (/nonReentrant|ReentrancyGuard|\bview\b|\bpure\b/.test(header)) continue;
      const callMatch = body.match(/\.call\s*\{\s*value\s*:|\.call\s*\(|\.transfer\s*\(|\.send\s*\(|\.safeTransfer\w*\s*\(|\.safeTransferFrom\s*\(|\.functionCall\w*\s*\(|sendValue\s*\(/);
      if (!callMatch || callMatch.index === undefined) continue;
      const after = body.slice(callMatch.index + callMatch[0].length);
      // a storage write after the call: assignment to mapping/array element or state var-looking identifier
      const write = after.match(/^\s*[A-Za-z_][\w.]*\s*(\[[^\]]+\])+\s*(=|\+=|-=)[^=]/m) || after.match(/^\s*[A-Za-z_]\w*\s*(\+=|-=)\s*/m);
      if (!write) continue;
      const callLine = clean.slice(0, start + callMatch.index).split("\n").length;
      const key = `sol-reentrancy:${file.path}:${callLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        id: `sol-reentrancy@${file.path}:${callLine}`,
        title: `Possible reentrancy in ${m[1]}() (external call before state update)`,
        severity: "high",
        category: "Reentrancy",
        origin: "static",
        file: file.path,
        line: callLine,
        evidence: original[callLine - 1]?.trim().slice(0, 200),
        description:
          "An external call or token transfer happens before a later state write in the same function, with no nonReentrant guard. A malicious receiver or ERC-777/hook token can re-enter and act on stale state.",
        recommendation: "Apply checks-effects-interactions (update state before the call) and/or OpenZeppelin ReentrancyGuard.",
      });
    }
  }
  return findings;
}
