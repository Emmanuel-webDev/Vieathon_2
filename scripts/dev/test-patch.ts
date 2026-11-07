import { applyUnifiedDiff, patchTargetFiles } from "../../lib/patch";

console.log("=== Testing Patch Engine & Fix PR Preconditions ===");

const original = "function withdraw() {\n  (bool ok,) = msg.sender.call{value: bal}(\"\");\n  bal = 0;\n}\n";

const patch = [
  "--- a/Vault.sol",
  "+++ b/Vault.sol",
  "@@ -1,4 +1,4 @@",
  " function withdraw() {",
  "+  bal = 0;",
  "   (bool ok,) = msg.sender.call{value: bal}(\"\");",
  "-  bal = 0;",
  " }",
].join("\n");

const targets = patchTargetFiles(patch);
console.log("Target files:", targets);

const res = applyUnifiedDiff(original, patch);
console.log("Patch application ok:", res.ok);
if (res.ok) {
  console.log("Patched content:\n" + res.content);
  console.log("✅ Patch engine successfully applied hunk!");
} else {
  console.error("❌ Patch application failed:", res.error);
  process.exit(1);
}

// Test rejection on context mismatch
const badPatch = patch.replace("msg.sender", "msg.origin");
const resBad = applyUnifiedDiff(original, badPatch);
console.log("Stale/mismatched patch rejected:", !resBad.ok);
if (!resBad.ok) {
  console.log("✅ Rejection reason:", resBad.error);
} else {
  console.error("❌ Failed to reject mismatched patch");
  process.exit(1);
}

console.log("✅ All patch engine checks passed!");
