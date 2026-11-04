import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const b = await chromium.launch();
const ctx = await b.newContext({ baseURL: "http://localhost:3000" });
await ctx.request.post("/api/auth/login", { data: { username: env.APP_USERNAME, password: env.APP_PASSWORD, next: "/" } });
const p = await ctx.newPage();
let n = 0;
p.on("response", async (res) => {
  if (res.request().resourceType() !== "document") return;
  n += 1;
  if (n > 3) return;
  console.log(`\n=== DOCUMENT ${n}: ${res.status()} ${res.url()} ===`);
  console.log(JSON.stringify(res.headers(), null, 2));
});
await p.goto("/", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const counts = await p.evaluate(() => {
  const entries = performance.getEntriesByType("navigation");
  return {
    navigationEntries: entries.length,
    entryTypes: entries.map((e) => ({ type: e.type, name: e.name, startTime: Math.round(e.startTime) })),
    dateNow: Date.now(),
    hasMetaRefresh: Array.from(document.querySelectorAll("meta[http-equiv]")).map((m) => m.getAttribute("http-equiv") + "=" + m.getAttribute("content")),
    scripts: document.scripts.length,
    visibility: document.visibilityState,
  };
});
console.log("\nPERF:", JSON.stringify(counts, null, 2));
await b.close();
