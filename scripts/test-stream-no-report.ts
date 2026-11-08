import assert from "assert";

/**
 * Test: Audit stream ending with no final report event.
 * Verifies that the client reader logic detects premature stream termination
 * and surfaces a clear, actionable error instead of leaving the UI blank.
 */

interface AuditEvent {
  type: string;
  level?: string;
  message?: string;
  stage?: string;
  status?: string;
  report?: any;
}

// Simulates the scanner client stream consumption logic
async function simulateClientStream(streamChunks: string[]): Promise<{
  receivedReport: boolean;
  error: string | null;
  logs: string[];
}> {
  let receivedReport = false;
  let streamError: string | null = null;
  let clientError: string | null = null;
  const logs: string[] = [];

  const handle = (ev: AuditEvent) => {
    if (ev.type === "log" && ev.message) logs.push(ev.message);
    if (ev.type === "error" && ev.message) streamError = ev.message;
    if (ev.type === "report") receivedReport = true;
  };

  let buf = "";
  for (const chunk of streamChunks) {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const jsonStr = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
      try {
        const ev = JSON.parse(jsonStr) as AuditEvent;
        if (ev.type === "report") receivedReport = true;
        if (ev.type === "error") streamError = ev.message ?? "Error";
        handle(ev);
      } catch {}
    }
  }

  if (buf.trim()) {
    const trimmed = buf.trim();
    const jsonStr = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
    try {
      const ev = JSON.parse(jsonStr) as AuditEvent;
      if (ev.type === "report") receivedReport = true;
      if (ev.type === "error") streamError = ev.message ?? "Error";
      handle(ev);
    } catch {}
  }

  if (!receivedReport) {
    clientError = streamError || "Audit stream ended prematurely without producing a final report.";
    logs.push(`✗ ${clientError}`);
  }

  return { receivedReport, error: clientError, logs };
}

function sanitizeErrorMessage(msg: string): string {
  return String(msg || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\bAQ\.[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED_PRIVATE_KEY]");
}

async function runTests() {
  console.log("=== Running Test: Audit Stream Ending With No Report ===\n");

  // Case 1: Stream emits stages and logs then terminates abruptly (no report event)
  {
    const chunks = [
      JSON.stringify({ type: "log", level: "info", message: "Target: project → demo-vault" }) + "\n",
      JSON.stringify({ type: "stage", stage: "collect", status: "start" }) + "\n",
      JSON.stringify({ type: "log", level: "info", message: "Fetching files from GitHub…" }) + "\n",
      JSON.stringify({ type: "stage", stage: "collect", status: "done" }) + "\n",
    ];

    const res = await simulateClientStream(chunks);
    console.log("Case 1: Stream drops connection after collect stage");
    console.log("  Logs collected:", res.logs.length);
    console.log("  Report received:", res.receivedReport);
    console.log("  Resulting error:", res.error);

    assert.strictEqual(res.receivedReport, false, "Must not have report");
    assert.ok(res.error, "Must produce an error");
    assert.strictEqual(res.error, "Audit stream ended prematurely without producing a final report.");
    assert.ok(res.logs[res.logs.length - 1].includes("Audit stream ended prematurely"));
    console.log("  -> PASS\n");
  }

  // Case 2: Server emits an explicit error event in stream before closing
  {
    const chunks = [
      JSON.stringify({ type: "log", level: "info", message: "Target: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }) + "\n",
      JSON.stringify({ type: "error", message: "Base RPC failed: connection reset" }) + "\n",
    ];

    const res = await simulateClientStream(chunks);
    console.log("Case 2: Stream emits explicit error event");
    console.log("  Resulting error:", res.error);

    assert.strictEqual(res.receivedReport, false);
    assert.strictEqual(res.error, "Base RPC failed: connection reset");
    console.log("  -> PASS\n");
  }

  // Case 3: Error sanitization ensures no secrets leak into UI/logs
  {
    const rawError = "Failed with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 and AIzaSyDUMMYDUMMYDUMMYDUMMY12345";
    const sanitized = sanitizeErrorMessage(rawError);
    console.log("Case 3: Error message secret redaction");
    console.log("  Raw error:       " + rawError);
    console.log("  Sanitized error: " + sanitized);

    assert.ok(!sanitized.includes("ghp_"), "Must redact GitHub token");
    assert.ok(!sanitized.includes("AIzaSy"), "Must redact Google API key");
    assert.ok(sanitized.includes("[REDACTED_GITHUB_TOKEN]"), "Must replace token");
    assert.ok(sanitized.includes("[REDACTED_API_KEY]"), "Must replace key");
    console.log("  -> PASS\n");
  }

  console.log("ALL STREAM FAILURE TESTS PASSED!");
}

runTests();

