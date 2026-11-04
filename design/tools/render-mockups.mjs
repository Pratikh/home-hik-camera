import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

/**
 * Render the static design mockups to PNG at the three reference breakpoints.
 * Usage: node design/tools/render-mockups.mjs [outDir]
 */
const ROOT = process.cwd();
const MOCK = resolve(ROOT, "design/mockups");
const OUT = resolve(ROOT, process.argv[2] ?? "design/mockups/screens");

const SIZES = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

const only = process.env.MOCK_ONLY ? process.env.MOCK_ONLY.split(",") : null;

mkdirSync(OUT, { recursive: true });
const files = readdirSync(MOCK).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });

for (const size of Object.keys(SIZES)) {
  const page = await context.newPage();
  await page.setViewportSize(SIZES[size]);
  for (const file of files) {
    const name = basename(file, ".html");
    if (only && !only.includes(name)) continue;
    await page.goto(`file://${resolve(MOCK, file)}`, { waitUntil: "load" });
    await page.waitForTimeout(450);
    await page.screenshot({ path: resolve(OUT, `${name}-${size}.png`) });
    await page.screenshot({ path: resolve(OUT, `${name}-${size}-full.png`), fullPage: true });
    console.log("shot", name, size);
  }
  await page.close();
}

await browser.close();
console.log("done ->", OUT);
