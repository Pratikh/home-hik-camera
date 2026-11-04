/**
 * ux-audit-shots2.mjs — second evidence pass for the UX audit.
 * Fixes mobile nav/save-bar geometry, captures a real event detail page and the
 * Events list with data, and measures nav/target geometry precisely.
 *
 * Run: node design/tools/ux-audit-shots2.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/audit/before");
const BASE = "http://localhost:3000";

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

const e = env();
mkdirSync(OUT, { recursive: true });
const out = {};

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } });
await ctx.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
const page = await ctx.newPage();

/* --- Sidebar nav geometry (desktop) --- */
await page.goto("/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
out.sidebar = await page.evaluate(() => {
  const nav = document.querySelector("aside nav");
  const items = [...(nav?.querySelectorAll("a") ?? [])].map((a) => {
    const r = a.getBoundingClientRect();
    return { text: a.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), font: getComputedStyle(a).fontSize };
  });
  const header = document.querySelector("header");
  const headerLinks = [...(header?.querySelectorAll("button,a") ?? [])].map((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const firstTile = document.querySelector("article");
  return {
    items,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
    headerLinks,
    firstTile: firstTile ? { w: Math.round(firstTile.getBoundingClientRect().width), h: Math.round(firstTile.getBoundingClientRect().height) } : null,
    tileCaption: firstTile?.querySelector("h2")?.textContent?.trim() ?? null,
    tileVideoLabel: firstTile?.querySelector("video")?.getAttribute("aria-label") ?? null,
    visibleTileText: firstTile?.innerText?.replace(/\s+/g, " ").trim().slice(0, 160) ?? null,
  };
});
console.log("sidebar", JSON.stringify(out.sidebar));
await page.screenshot({ path: resolve(OUT, "uxaudit-dashboard-loaded.png") });

/* Hover the first tile to reveal the "Full screen" affordance. */
const tile = page.locator("article").first();
await tile.hover().catch(() => undefined);
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(OUT, "uxaudit-dashboard-hover.png") });

/* --- Real event detail --- */
const ev = await (await ctx.request.get("/api/events?camera=all&date=2026-11-04&startTime=00:00&endTime=23:59&page=1&pageSize=20")).json();
out.eventsApi = { total: ev.total, first: ev.events?.[0]?.id ?? null, pageSize: ev.pageSize };
console.log("events api", JSON.stringify(out.eventsApi));
if (ev.events?.[0]) {
  await page.goto(`/events/${ev.events[0].id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: resolve(OUT, "uxaudit-event-detail.png") });
  await page.screenshot({ path: resolve(OUT, "uxaudit-event-detail-full.png"), fullPage: true });
  out.eventDetail = await page.evaluate(() => ({
    h1: [...document.querySelectorAll("h1")].map((x) => x.textContent.trim()),
    h2: [...document.querySelectorAll("h2")].map((x) => x.textContent.trim()),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 1500),
  }));
  console.log("event detail h1/h2", JSON.stringify(out.eventDetail.h1), JSON.stringify(out.eventDetail.h2));
}

/* --- Events with data + filter block height --- */
await page.goto("/events", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
await page.screenshot({ path: resolve(OUT, "uxaudit-events-loaded.png") });
out.eventsPage = await page.evaluate(() => {
  const form = document.querySelector("form");
  const firstRow = document.querySelector('section[aria-label="Event list"] li');
  const detail = document.querySelector('article[aria-label="Event details"]');
  const r = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height) } : null);
  return {
    filterForm: r(form),
    firstRow: r(firstRow),
    detailPanel: r(detail),
    viewport: window.innerHeight,
    rowCount: document.querySelectorAll('section[aria-label="Event list"] li').length,
    detailText: detail?.innerText?.replace(/\s+/g, " ").slice(0, 600) ?? null,
  };
});
console.log("events page", JSON.stringify(out.eventsPage));

/* --- Mobile: bottom nav geometry + detection save bar --- */
const mobile = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
await mobile.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
const mp = await mobile.newPage();

await mp.goto("/settings/detection", { waitUntil: "domcontentloaded" });
await mp.waitForTimeout(4500);
out.mobileDetection = await mp.evaluate(() => {
  const save = document.querySelector('[data-testid="detection-save"]');
  const mobileNav = document.querySelector('nav.fixed[aria-label="Primary"]');
  const rect = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom), left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
  const s = rect(save);
  const n = rect(mobileNav);
  const items = [...(mobileNav?.querySelectorAll("a") ?? [])].map((a) => ({ text: a.textContent.trim(), ...rect(a), font: getComputedStyle(a).fontSize }));
  return {
    save: s,
    mobileNav: n,
    mobileNavZ: mobileNav ? getComputedStyle(mobileNav).zIndex : null,
    saveBarZ: save?.closest("div.fixed") ? getComputedStyle(save.closest("div.fixed")).zIndex : null,
    overlap: s && n ? !(s.bottom <= n.top || s.top >= n.bottom) : null,
    items,
  };
});
console.log("mobileDetection", JSON.stringify(out.mobileDetection));
await mp.screenshot({ path: resolve(OUT, "uxaudit-mobile-detection-savebar.png") });

await mp.goto("/", { waitUntil: "domcontentloaded" });
await mp.waitForTimeout(5000);
out.mobileDashboard = await mp.evaluate(() => {
  const mobileNav = document.querySelector('nav.fixed[aria-label="Primary"]');
  const header = document.querySelector("header");
  const rect = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
  const headerChildren = [...(header?.children?.[1]?.children ?? [])].map((el) => ({
    text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24),
    ...rect(el),
  }));
  return {
    header: rect(header),
    headerChildren,
    mobileNav: rect(mobileNav),
    navItems: [...(mobileNav?.querySelectorAll("a") ?? [])].map((a) => ({ text: a.textContent.trim(), ...rect(a), font: getComputedStyle(a).fontSize })),
    tiles: [...document.querySelectorAll("article")].map((el) => ({ ...rect(el), text: el.innerText.replace(/\s+/g, " ").slice(0, 80) })),
  };
});
console.log("mobileDashboard", JSON.stringify(out.mobileDashboard));
await mp.screenshot({ path: resolve(OUT, "uxaudit-mobile-dashboard-loaded.png") });

/* Touch has no hover: is there any full-screen affordance on the tile? */
out.mobileTileAffordance = await mp.evaluate(() => {
  const article = document.querySelector("article");
  if (!article) return null;
  const btn = article.querySelector('button[aria-label^="Open"]');
  const span = [...article.querySelectorAll("span")].find((s) => s.textContent.includes("Full screen"));
  return {
    overlayButton: Boolean(btn),
    overlayButtonOpacity: span ? getComputedStyle(span).opacity : null,
    overlayButtonVisible: span ? getComputedStyle(span).display !== "none" && getComputedStyle(span).opacity !== "0" : null,
  };
});
console.log("mobileTileAffordance", JSON.stringify(out.mobileTileAffordance));

/* --- Tablet 834 check for the detection save bar (source-suspected overlap) --- */
const tablet = await browser.newContext({ baseURL: BASE, viewport: { width: 834, height: 1112 } });
await tablet.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
const tp = await tablet.newPage();
await tp.goto("/settings/detection", { waitUntil: "domcontentloaded" });
await tp.waitForTimeout(4000);
out.tabletDetection = await tp.evaluate(() => {
  const save = document.querySelector('[data-testid="detection-save"]');
  const mobileNav = document.querySelector('nav.fixed[aria-label="Primary"]');
  const bar = save?.closest("div.fixed");
  const rect = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom), left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) } : null);
  const s = rect(save);
  const n = rect(mobileNav);
  const b = rect(bar);
  return { save: s, bar: b, mobileNav: n, barZ: bar ? getComputedStyle(bar).zIndex : null, navZ: mobileNav ? getComputedStyle(mobileNav).zIndex : null };
});
console.log("tabletDetection", JSON.stringify(out.tabletDetection));
await tp.screenshot({ path: resolve(OUT, "uxaudit-tablet-detection.png") });

/* --- Faces: is the page disabled or a gallery? --- */
await page.goto("/faces", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: resolve(OUT, "uxaudit-faces.png") });
out.faces = await page.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900) }));
console.log("faces", JSON.stringify(out.faces));

/* --- Notifications history with data --- */
await page.goto("/notifications", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.screenshot({ path: resolve(OUT, "uxaudit-notifications-loaded.png") });

/* --- Playback with data --- */
await page.goto("/playback", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.screenshot({ path: resolve(OUT, "uxaudit-playback-loaded.png") });
await page.screenshot({ path: resolve(OUT, "uxaudit-playback-loaded-full.png"), fullPage: true });

/* --- System page with data --- */
await page.goto("/settings/system", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(OUT, "uxaudit-system-loaded.png") });

await browser.close();
writeFileSync(resolve(OUT, "uxaudit-measurements-2.json"), JSON.stringify(out, null, 2));
console.log("wrote", resolve(OUT, "uxaudit-measurements-2.json"));
