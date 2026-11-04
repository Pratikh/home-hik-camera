/**
 * Interaction-state evidence for the responsive audit.
 *
 * 1. Events list: tapping an event row on <1024px. The detail panel lives in the
 *    second grid column at >=1024px, so at tablet/mobile it is appended AFTER the
 *    whole list. These shots document what the tap actually shows.
 * 2. Camera focus mode (the app's full-screen overlay): header, sidebar and
 *    bottom bar are hidden, so it must be checked separately at every size.
 *
 * Usage: node design/tools/responsive-states.mjs
 * Output: design/audit/before/events-selected-<size>.png,
 *         design/audit/before/events-selected-detail-<size>.png,
 *         design/audit/before/dashboard-focus-<size>.png
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/audit/before");
const BASE = "http://localhost:3000";
const SIZES = {
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
  laptop: { width: 1440, height: 900 },
};

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

function png(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

const e = env();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const size of Object.keys(SIZES)) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size] });
  await ctx.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
  const page = await ctx.newPage();

  // ---- events: tap a row ----
  await page.goto("/events", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(7000);
  const rows = page.locator("main ul li > button");
  const rowCount = await rows.count();
  if (rowCount > 0) {
    await rows.first().click();
    await page.waitForTimeout(900);
    const beforeShot = resolve(OUT, `events-selected-${size}.png`);
    await page.screenshot({ path: beforeShot });
    const geo = await page.evaluate(() => {
      const article = document.querySelector('article[aria-label="Event details"]');
      const list = document.querySelector('section[aria-label="Event list"]');
      const main = document.querySelector("main");
      const r = (el) => (el ? { ...el.getBoundingClientRect().toJSON() } : null);
      return {
        detail: r(article),
        list: r(list),
        scrollY: window.scrollY,
        viewportH: window.innerHeight,
        mainScrollTop: main?.scrollTop ?? null,
        detailBelowFold: article ? article.getBoundingClientRect().top > window.innerHeight : null,
        detailAfterList: article && list ? article.getBoundingClientRect().top > list.getBoundingClientRect().bottom - 2 : null,
      };
    });
    // Scroll the detail panel into view for "what the user finds" evidence.
    await page.evaluate(() => {
      const article = document.querySelector('article[aria-label="Event details"]');
      article?.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(500);
    const detailShot = resolve(OUT, `events-selected-detail-${size}.png`);
    await page.screenshot({ path: detailShot });
    results.push({ size, state: "events-selected", rows: rowCount, geo, shots: [png(beforeShot), png(detailShot)], files: [beforeShot, detailShot].map((f) => f.split("/").pop()) });
    console.log(`${size} events-selected rows=${rowCount} detailBelowFold=${geo.detailBelowFold} detailAfterList=${geo.detailAfterList}`);
  } else {
    console.log(`${size} events-selected: no rows found`);
  }

  // ---- dashboard: camera focus mode ----
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);
  const expand = page.locator('main button[aria-label^="Open "]').first();
  if ((await expand.count()) > 0) {
    await expand.click();
    await page.waitForTimeout(1200);
    const shot = resolve(OUT, `dashboard-focus-${size}.png`);
    await page.screenshot({ path: shot });
    const geo = await page.evaluate(() => {
      const header = document.querySelector("header");
      const aside = document.querySelector("aside");
      const navs = Array.from(document.querySelectorAll("nav"));
      const fixedTile = Array.from(document.querySelectorAll("article")).find((a) => getComputedStyle(a).position === "fixed");
      const exit = document.querySelector('button[aria-label^="Exit focus view"]');
      const r = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
      return {
        headerVisible: header ? header.getBoundingClientRect().height > 0 : false,
        sidebarVisible: aside ? aside.getBoundingClientRect().width > 0 : false,
        navCount: navs.length,
        fixedTile: r(fixedTile),
        exitButton: exit ? { ...r(exit), text: exit.textContent?.trim() } : null,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    results.push({ size, state: "camera-focus", geo, shot: png(shot), file: shot.split("/").pop() });
    console.log(`${size} focus: headerVisible=${geo.headerVisible} sidebar=${geo.sidebarVisible} tile=${JSON.stringify(geo.fixedTile)} exit=${geo.exitButton?.text}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    console.log(`${size} focus: no tile expand button`);
  }
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(ROOT, "design/tools/responsive-states.json"), JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
console.log("states captured:", results.length);
