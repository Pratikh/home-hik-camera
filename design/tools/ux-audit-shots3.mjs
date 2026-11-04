/**
 * ux-audit-shots3.mjs — final measurement pass: design-system inconsistency,
 * keyboard order, heading scale, dashboard fold position, faces card geometry.
 * Read-only.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/audit/before");
const BASE = "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env"), "utf8")
    .split(/\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } });
await ctx.request.post("/api/auth/login", { data: { username: env.APP_USERNAME, password: env.APP_PASSWORD, next: "/" } });
const page = await ctx.newPage();
const out = {};

/* --- Keyboard order: how many tab stops before <main>? --- */
await page.goto("/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
out.keyboard = await page.evaluate(() => {
  const sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const stops = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
  const main = document.querySelector("main");
  const mainTop = main ? main.getBoundingClientRect().top : Infinity;
  const beforeMain = stops.filter((el) => el.getBoundingClientRect().top < mainTop || !main?.contains(el)).length;
  const skipLink = [...document.querySelectorAll("a")].find((a) => /skip/i.test(a.textContent || ""));
  return {
    tabStopsBeforeMain: beforeMain,
    totalTabStops: stops.length,
    hasSkipLink: Boolean(skipLink),
    firstFive: stops.slice(0, 5).map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)),
  };
});

/* --- Dashboard fold: where is "Recent security events"? --- */
out.dashboardFold = await page.evaluate(() => {
  const section = [...document.querySelectorAll("section")].find((s) => /Recent security events/i.test(s.getAttribute("aria-label") || ""));
  const grid = document.querySelector("section > div.grid");
  const rect = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), height: Math.round(el.getBoundingClientRect().height), bottom: Math.round(el.getBoundingClientRect().bottom) } : null);
  return { viewport: window.innerHeight, recentEvents: rect(section), cameraGrid: rect(grid), gridIsAboveFold: grid ? grid.getBoundingClientRect().bottom <= window.innerHeight : null };
});

/* --- Heading scale per page --- */
const pages = ["/", "/events", "/playback", "/faces", "/cameras", "/settings", "/settings/detection", "/settings/users", "/settings/system", "/settings/audit-log", "/events/stats", "/notifications", "/device", "/account"];
out.headings = {};
for (const path of pages) {
  await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(2200);
  out.headings[path] = await page.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent.trim().slice(0, 48), size: cs.fontSize, weight: cs.fontWeight };
    };
    return { title: document.title, h1: get("h1"), firstH2: get("h2"), firstH3: get("h3") };
  });
}

/* --- Faces: ragged card geometry --- */
await page.goto("/faces", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
out.facesCards = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("article")].slice(0, 8);
  return cards.map((card) => {
    const imgWrap = card.firstElementChild;
    const r = card.getBoundingClientRect();
    const ir = imgWrap?.getBoundingClientRect();
    return {
      cardH: Math.round(r.height),
      imgH: ir ? Math.round(ir.height) : null,
      imgW: ir ? Math.round(ir.width) : null,
      square: ir ? Math.abs(ir.height - ir.width) < 2 : null,
    };
  });
});

/* --- Button / input style inventory across the app (design-system drift) --- */
const routeList = ["/", "/events", "/playback", "/faces", "/cameras", "/notifications", "/device", "/account", "/settings", "/settings/users", "/settings/detection", "/settings/notifications", "/settings/system", "/settings/audit-log", "/events/stats"];
const buttons = {};
const inputs = {};
const cards = {};
for (const path of routeList) {
  await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(2000);
  const bag = await page.evaluate(() => {
    const sig = (el) => {
      const cs = getComputedStyle(el);
      return {
        h: Math.round(el.getBoundingClientRect().height),
        radius: cs.borderRadius,
        bg: cs.backgroundColor,
        border: cs.borderTopColor === "rgba(0, 0, 0, 0)" ? "none" : cs.borderTopColor,
        color: cs.color,
        font: cs.fontSize,
        pad: `${cs.paddingTop}/${cs.paddingLeft}`,
      };
    };
    return {
      buttons: [...document.querySelectorAll("button, a.rounded-lg, a.rounded-full, a.inline-flex")].filter((el) => el.getBoundingClientRect().height > 0).map(sig),
      inputs: [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=range]), select, textarea")].filter((el) => el.getBoundingClientRect().height > 0).map(sig),
      cards: [...document.querySelectorAll("article, section.rounded-xl, div.rounded-xl")].filter((el) => el.getBoundingClientRect().height > 0).map(sig),
    };
  });
  for (const [i, b] of bag.buttons.entries()) buttons[`${path}#${i}`] = b;
  for (const [i, b] of bag.inputs.entries()) inputs[`${path}#${i}`] = b;
  for (const [i, b] of bag.cards.entries()) cards[`${path}#${i}`] = b;
}
function summarise(map, keys) {
  const counts = {};
  for (const value of Object.values(map)) {
    const key = keys.map((k) => value[k]).join(" | ");
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
out.buttonStyles = summarise(buttons, ["h", "radius", "bg", "border", "font"]);
out.buttonCount = Object.keys(buttons).length;
out.inputStyles = summarise(inputs, ["h", "radius", "bg", "border", "pad"]);
out.inputCount = Object.keys(inputs).length;
out.cardStyles = summarise(cards, ["radius", "bg", "border"]);
out.cardCount = Object.keys(cards).length;

/* --- async state affordances --- */
await page.goto("/settings/system", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);
out.loadingState = await page.evaluate(() => ({
  hasSkeleton: Boolean(document.querySelector(".animate-pulse")),
  ariaLiveRegions: [...document.querySelectorAll("[aria-live]")].map((el) => el.getAttribute("aria-live")),
  roleStatus: document.querySelectorAll('[role="status"]').length,
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
}));

await browser.close();
writeFileSync(resolve(OUT, "uxaudit-measurements-3.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ keyboard: out.keyboard, dashboardFold: out.dashboardFold, facesCards: out.facesCards, loadingState: out.loadingState }, null, 2));
console.log("buttonStyles", JSON.stringify(out.buttonStyles.slice(0, 8)));
console.log("inputStyles", JSON.stringify(out.inputStyles.slice(0, 8)));
console.log("cardStyles", JSON.stringify(out.cardStyles.slice(0, 6)));
console.log("counts", out.buttonCount, out.inputCount, out.cardCount);
console.log("headings", JSON.stringify(out.headings, null, 1));
