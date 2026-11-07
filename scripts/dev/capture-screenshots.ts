import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const prefix = process.argv[2] || "before";
const outDir = path.join(process.cwd(), "screenshots");
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  // 1. Desktop Landing
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, `${prefix}-landing-desktop.png`), fullPage: true });
  console.log(`Saved ${prefix}-landing-desktop.png`);

  // 2. Mobile Landing
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, `${prefix}-landing-mobile.png`), fullPage: true });
  console.log(`Saved ${prefix}-landing-mobile.png`);

  // 3. Desktop Report (click RekktVault sample to generate/view real report)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  // Switch to Quick scan
  const quickTab = page.locator("button:has-text('Quick scan')");
  if (await quickTab.isVisible()) {
    await quickTab.click();
    await page.waitForTimeout(500);
    // Click sample button
    const sampleBtn = page.locator("button:has-text('Reentrancy + tx.origin vault')");
    if (await sampleBtn.isVisible()) {
      await sampleBtn.click();
      // Wait for report to render
      await page.waitForSelector("text=Report hash", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(outDir, `${prefix}-report-desktop.png`), fullPage: true });
      console.log(`Saved ${prefix}-report-desktop.png`);
    }
  }

  // 4. Deep Job View
  try {
    await page.goto("http://localhost:3000/deep/e1c2bfae5652d080", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, `${prefix}-deep-job.png`), fullPage: true });
    console.log(`Saved ${prefix}-deep-job.png`);
  } catch (e: any) {
    console.log("Could not capture deep job:", e.message);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
