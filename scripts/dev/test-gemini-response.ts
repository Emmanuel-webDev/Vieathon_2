import { complete } from "../../lib/llm";

async function main() {
  console.log("Testing gemini-3.5-flash completion...");
  const res = await complete({
    model: "gemini-3.5-flash",
    system: 'You are a code reviewer. Answer in JSON format: {"status": "ok", "note": string}',
    user: "Review line: uint256 a = 1;",
    maxTokens: 300,
    json: true,
  });
  console.log("Response:", res);
}

main().catch(console.error);
