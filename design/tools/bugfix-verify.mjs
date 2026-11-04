import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const base = process.env.QA_BASE_URL ?? "http://localhost:3000";
const env = Object.fromEntries(readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); let v = l.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return [l.slice(0, i).trim(), v]; }));

const ROUTES = ["/", "/cameras", "/events", "/playback", "/faces", "/notifications", "/device", "/account", "/settings", "/settings/users", "/settings/notifications", "/settings/detection", "/settings/audit-log", "/settings/system"];
const results = [];
const browser = await chromium.launch();

// --- authenticated route stability ---
const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
const loginRes = await ctx.request.post("/api/auth/login", { data: { username: env.APP_USERNAME, password: env.APP_PASSWORD, next: "/" } });
const setCookie = loginRes.headers()["set-cookie"] ?? "";
results.push({ check: "login", status: loginRes.status(), secureCookie: /secure/i.test(setCookie), httpOnly: /httponly/i.test(setCookie), sameSite: /samesite=lax/i.test(setCookie), maxAge: /max-age=(\d+)/i.exec(setCookie)?.[1] ?? null });

const page = await ctx.newPage();
let docLoads = 0;
page.on("request", (r) => { if (r.resourceType() === "document") docLoads += 1; });
for (const route of ROUTES) {
  docLoads = 0;
  try { await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch { /* recorded below */ }
  await page.waitForTimeout(2500);
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const heading = await page.locator("h1").first().textContent().catch(() => null);
  results.push({ check: "route", route, documentLoads: docLoads, horizontalOverflow: overflow, h1: heading?.trim() ?? null });
}

// --- sustained idle stability on the dashboard ---
await page.goto("/", { waitUntil: "domcontentloaded" });
docLoads = 0;
await page.waitForTimeout(30000);
const idle = await page.evaluate(() => ({ url: location.href, title: document.title, visible: document.visibilityState }));
results.push({ check: "sustained-idle-30s", documentLoads: docLoads, ...idle });

// --- logout ---
await page.getByRole("button", { name: "Log out" }).first().click();
await page.waitForTimeout(1500);
const afterLogout = await page.evaluate(() => location.pathname);
const sessionAfterLogout = await ctx.request.get("/api/auth/session");
results.push({ check: "logout", pathname: afterLogout, sessionStatus: sessionAfterLogout.status() });
await ctx.close();

// --- tampered session cookie ---
const badCtx = await browser.newContext({ baseURL: base });
await badCtx.addCookies([{ name: "cctv_session", value: "tampered.invalid.token", url: base }]);
const badPage = await badCtx.newPage();
let badDocs = 0;
badPage.on("request", (r) => { if (r.resourceType() === "document") badDocs += 1; });
badPage.on("console", (m) => { if (m.type() === "error") results.push({ check: "bad-cookie-console-error", text: m.text().slice(0, 160) }); });
await badPage.goto("/", { waitUntil: "domcontentloaded" });
await badPage.waitForTimeout(15000);
results.push({ check: "tampered-cookie", finalPath: await badPage.evaluate(() => location.pathname), documentLoads: badDocs });
await badCtx.close();

await browser.close();
console.log(JSON.stringify(results, null, 2));
const bad = results.filter((r) => (r.check === "route" && (r.documentLoads > 1 || r.horizontalOverflow > 0)) || (r.check === "sustained-idle-30s" && r.documentLoads > 0) || (r.check === "tampered-cookie" && r.documentLoads > 1) || (r.check === "logout" && r.pathname !== "/login"));
console.log("\nFAILURES:", bad.length === 0 ? "none" : JSON.stringify(bad, null, 2));
