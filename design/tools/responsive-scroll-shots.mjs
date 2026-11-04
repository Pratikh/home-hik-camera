/**
 * Supporting evidence pass: below-the-fold captures.
 *
 * At >=768px the app shell locks the page to the viewport (`md:h-dvh`) and the
 * only scrollable region is <main> (`md:overflow-y-auto`). Playwright's
 * `fullPage` screenshot therefore returns the same 834/1440px-tall image as the
 * viewport shot and never shows content below the fold. This script scrolls the
 * inner <main> to its maximum offset and captures `<route>-<size>-bottom.png`
 * so the audit has visual evidence for every part of each screen.
 *
 * Usage: node design/tools/responsive-scroll-shots.mjs [--size tablet|mobile|laptop|all]
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/audit/before");
const BASE = "http://localhost:3000";
const SIZES = {
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
  laptop: { width: 1440, height: 900 },
};
const ROUTES = [
  ["dashboard", "/", 6000],
  ["cameras", "/cameras", 4000],
  ["events", "/events", 7000],
  ["event-detail", "__EVENT__", 5000],
  ["event-stats", "/events/stats", 4000],
  ["faces", "/faces", 4000],
  ["playback", "/playback", 5000],
  ["notifications", "/notifications", 4000],
  ["device", "/device", 4000],
  ["account", "/account", 4000],
  ["settings", "/settings", 4000],
  ["settings-notifications", "/settings/notifications", 4000],
  ["settings-users", "/settings/users", 4000],
  ["settings-detection", "/settings/detection", 4000],
  ["settings-audit", "/settings/audit-log", 4000],
  ["settings-system", "/settings/system", 4000],
];

function env() {
  const out = {};
  for (const raw of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const args = process.argv.slice(2);
const sizeArg = args.includes("--size") ? args[args.indexOf("--size") + 1] : "all";
const sizes = sizeArg === "all" ? Object.keys(SIZES) : [sizeArg];
const e = env();
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const report = [];
let eventId = "evt_417d9dd35c747de1567a8a95";

const probe = await browser.newContext({ baseURL: BASE });
await probe.request.post("/api/auth/login", {
  data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
});
try {
  const res = await probe.request.get("/api/events/recent?limit=1");
  const body = await res.json();
  if (body?.events?.[0]?.id) eventId = body.events[0].id;
} catch {
  /* keep fallback */
}
await probe.close();
console.log("event id:", eventId);

for (const size of sizes) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size] });
  await ctx.request.post("/api/auth/login", {
    data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
  });
  const page = await ctx.newPage();
  for (const [key, rawPath, settle] of ROUTES) {
    const path = rawPath === "__EVENT__" ? `/events/${eventId}` : rawPath;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      await page.waitForTimeout(1200);
      try {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        console.log("skip", size, key);
        continue;
      }
    }
    await page.waitForTimeout(settle);
    const geo = await page.evaluate(() => {
      const main = document.querySelector("main");
      const docScrollable = document.documentElement.scrollHeight > window.innerHeight + 4;
      const mainScrollable = main ? main.scrollHeight > main.clientHeight + 4 : false;
      const mainTop = main ? main.getBoundingClientRect().top : 0;
      return { docScrollable, mainScrollable, mainTop, mainClient: main?.clientHeight ?? 0, mainScroll: main?.scrollHeight ?? 0 };
    });
    if (!geo.docScrollable && !geo.mainScrollable) {
      console.log(`${size}/${key}: fits viewport (nothing below fold)`);
      report.push({ size, route: key, belowFold: false, ...geo });
      continue;
    }
    await page.evaluate(() => {
      if (document.documentElement.scrollHeight > window.innerHeight + 4) {
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
      const main = document.querySelector("main");
      if (main) main.scrollTop = main.scrollHeight;
    });
    await page.waitForTimeout(600);
    const pos = await page.evaluate(() => {
      const main = document.querySelector("main");
      return { winY: window.scrollY, mainTop: main?.scrollTop ?? 0 };
    });
    const file = resolve(OUT, `${key}-${size}-bottom.png`);
    await page.screenshot({ path: file });
    console.log(`${size}/${key}: bottom captured (winY=${pos.winY}, mainScrollTop=${pos.mainTop}/${geo.mainScroll})`);
    report.push({ size, route: key, belowFold: true, file: file.split("/").pop(), ...geo, after: pos });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(ROOT, "design/tools/responsive-scroll-metrics.json"), JSON.stringify({ eventId, sizes, report }, null, 2));
console.log("captured bottom shots:", report.filter((r) => r.belowFold).length);
