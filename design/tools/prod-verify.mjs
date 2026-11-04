import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const base = process.env.QA_BASE_URL ?? "http://localhost:3100";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = []; const cspViolations = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
let docLoads = 0;
page.on("request", (r) => { if (r.resourceType() === "document") docLoads += 1; });

await page.goto("/login", { waitUntil: "domcontentloaded" });
await page.fill('input[name="username"]', env.APP_USERNAME);
await page.fill('input[name="password"]', env.APP_PASSWORD);
await Promise.all([page.waitForURL("**/"), page.click('button[type="submit"]')]);
await page.waitForTimeout(12000);
const afterLogin = { url: page.url(), documentLoads: docLoads, h1: (await page.locator("h1").first().textContent())?.trim() };
docLoads = 0;
await page.waitForTimeout(20000);
const idle = { documentLoads: docLoads, url: page.url() };
for (const route of ["/events", "/cameras", "/faces", "/settings", "/settings/system"]) {
  docLoads = 0;
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  console.log(route, "loads:", docLoads, "h1:", (await page.locator("h1").first().textContent().catch(() => null))?.trim());
}
console.log(JSON.stringify({ afterLogin, idle, consoleErrors, cspViolations, production: true }, null, 2));
await browser.close();
