import { complete } from "../../lib/llm";

async function testModel(modelName: string) {
  try {
    console.log(`Testing model: ${modelName}...`);
    const out = await complete({
      system: "Respond with OK.",
      user: "Respond with exactly the single word: OK",
      maxTokens: 200,
      model: modelName,
    });
    console.log(`✅ ${modelName} SUCCESS:`, JSON.stringify(out.trim()));
    return true;
  } catch (err: any) {
    console.log(`❌ ${modelName} ERROR:`, err.message);
    return false;
  }
}

async function main() {
  for (const m of ["gemini-3.5-flash", "gemini-3.8-flash"]) {
    await testModel(m);
  }
}

main().catch(console.error);
