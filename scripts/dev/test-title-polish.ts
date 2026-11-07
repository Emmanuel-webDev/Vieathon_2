import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import { SAMPLES } from "../../lib/samples";
import { aiTriage, applyLeadTriage } from "../../lib/ai";
import type { Finding } from "../../lib/types";

async function main() {
  console.log("=== Testing Item 2: Title Polish on Triage Confirmation ===");

  // 1. Offline deterministic unit checks
  const mockLead1: Finding = {
    id: "sol-public-selfmint@src/RekktVault.sol:37",
    title: "mint/burn external function without visible access control",
    severity: "high",
    category: "Access control",
    origin: "static",
    file: "src/RekktVault.sol",
    line: 37,
    evidence: "function setOwner(address newOwner) external {",
    description: "Sensitive external function without modifier.",
    recommendation: "Restrict with onlyOwner.",
  };
  applyLeadTriage(mockLead1, {
    verdict: "confirmed",
    reason: "Anyone can overwrite owner.",
    refinedTitle: "Unprotected setOwner() allows arbitrary ownership takeover",
  });
  console.log(`[Offline AI refinedTitle] -> "${mockLead1.title}"`);
  if (mockLead1.title.includes("mint/burn")) throw new Error("Failed to refine title from AI refinedTitle");

  const mockLead2: Finding = {
    ...mockLead1,
    title: "mint/burn external function without visible access control",
  };
  applyLeadTriage(mockLead2, {
    verdict: "confirmed",
    reason: "Anyone can overwrite owner.",
  });
  console.log(`[Offline fallback refinedTitle] -> "${mockLead2.title}"`);
  if (mockLead2.title.includes("mint/burn")) throw new Error("Failed fallback title refinement");

  // 2. Live AI triage test with the exact mismatched title ("mint/burn external function without visible access control") on setOwner
  const vault = SAMPLES.find((s) => s.id === "rekkt-vault")!;
  const liveLead: Finding = {
    id: "sol-public-selfmint@src/RekktVault.sol:37",
    title: "mint/burn external function without visible access control",
    severity: "high",
    category: "Access control",
    origin: "static",
    file: "src/RekktVault.sol",
    line: 37,
    evidence: "function setOwner(address newOwner) external {",
    description: "A sensitive state-changing function is externally callable and the signature shows no modifier.",
    recommendation: "Restrict with onlyOwner.",
  };

  console.log(`\nBefore live aiTriage: [${liveLead.id}] "${liveLead.title}"`);
  const out = await aiTriage(
    {
      files: vault.files,
      leads: [liveLead],
      contextNote: "Judge sandbox RekktVault title refinement test.",
    },
    (m, l) => console.log(`[${l ?? "info"}] ${m}`)
  );

  const tr = out.triage.get(liveLead.id);
  console.log("Raw triage entry from LLM:", JSON.stringify(tr));
  applyLeadTriage(liveLead, tr);
  console.log(`After live aiTriage:  [${liveLead.id}] "${liveLead.title}" (verdict=${liveLead.triage?.verdict})`);

  if (liveLead.triage?.verdict !== "confirmed" || /mint\/burn/i.test(liveLead.title) || !/setOwner|owner/i.test(liveLead.title)) {
    throw new Error(`Unexpected live title polish result: title="${liveLead.title}", verdict="${liveLead.triage?.verdict}"`);
  }
  console.log("PASS: Static lead 'mint/burn external function...' on setOwner() was confirmed and refined to an accurate setOwner title.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

