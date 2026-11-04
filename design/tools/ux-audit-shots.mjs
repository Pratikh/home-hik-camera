/**
 * ux-audit-shots.mjs — supplementary evidence capture for the UX audit (task-2).
 *
 * Read-only. Logs in via the app's own API, screenshots the screens and states
 * that the before/*-desktop.png set does not cover, and measures on-screen
 * typography/tap-target/heading statistics for the findings report.
 *
 * Run: node design/tools/ux-audit-shots.mjs
 * Out: design/audit/before/uxaudit-*.png
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

mkdirSync(OUT, { recursive: true });
const e = env();
const browser = await chromium.launch();
const report = { pages: {}, mobile: {}, consoleErrors: [] };

const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } });
const login = await ctx.request.post("/api/auth/login", {
  data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
});
console.log("login", login.status());
if (login.status() !== 200) process.exit(1);

const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 240));
});
page.on("pageerror", (err) => report.consoleErrors.push(`pageerror: ${String(err).slice(0, 240)}`));

async function measure(label) {
  const data = await page.evaluate(() => {
    const sel = 'a[href],button,input,select,textarea,[role="slider"],[tabindex]:not([tabindex="-1"])';
    const interactive = [...document.querySelectorAll(sel)];
    const small = [];
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 44 || r.height < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || "",
          name: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 48),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    const fontMap = {};
    for (const el of document.querySelectorAll("p,span,a,button,dt,dd,li,label,h1,h2,h3,h4,time,legend,input,select")) {
      const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (!direct) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px)) continue;
      const key = `${px}px`;
      fontMap[key] = (fontMap[key] || 0) + 1;
    }
    const headings = {};
    for (const h of document.querySelectorAll("h1,h2,h3,h4")) headings[h.tagName] = (headings[h.tagName] || 0) + 1;
    return {
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((x) => x.textContent.trim()),
      headings,
      smallTargets: small,
      smallTargetCount: small.length,
      interactiveCount: interactive.length,
      fontSizes: fontMap,
      elementsWithInlineStyle: document.querySelectorAll("[style]").length,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
      unlabeledInputs: [...document.querySelectorAll("input,select,textarea")].filter((el) => {
        const id = el.getAttribute("id");
        const hasLabel = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
        return !hasLabel;
      }).length,
      liveRegions: document.querySelectorAll('[role="status"],[role="alert"],[aria-live]').length,
      bodyScrollHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  });
  report.pages[label] = data;
  return data;
}

const DESKTOP = [
  ["dashboard", "/", 7000],
  ["events", "/events", 5000],
  ["cameras", "/cameras", 3000],
  ["faces", "/faces", 3000],
  ["playback", "/playback", 6000],
  ["notifications", "/notifications", 4000],
  ["device", "/device", 3000],
  ["account", "/account", 3000],
  ["settings", "/settings", 3000],
  ["settings-users", "/settings/users", 3000],
  ["settings-notifications", "/settings/notifications", 4000],
  ["settings-detection", "/settings/detection", 4000],
  ["settings-audit", "/settings/audit-log", 3000],
  ["settings-system", "/settings/system", 4000],
  ["event-stats", "/events/stats", 3000],
];

for (const [name, path, wait] of DESKTOP) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: resolve(OUT, `uxaudit-${name}.png`) });
  const m = await measure(name);
  console.log(
    `shot ${name} url=${page.url()} targets<44=${m.smallTargetCount}/${m.interactiveCount} h1=${JSON.stringify(m.h1)} fonts=${JSON.stringify(m.fontSizes)} inlineStyles=${m.elementsWithInlineStyle} unlabeled=${m.unlabeledInputs}`,
  );
}

/* Event detail needs a real id. */
const events = await ctx.request.get("/api/events?date=&pageSize=5&camera=all&startTime=00:00&endTime=23:59&page=1");
const eventBody = await events.json().catch(() => ({ events: [] }));
const firstEvent = eventBody.events?.[0];
report.eventCount = eventBody.total ?? eventBody.events?.length ?? 0;
if (firstEvent) {
  await page.goto(`/events/${firstEvent.id}`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(OUT, "uxaudit-event-detail.png") });
  report.pages["event-detail"] = await measure("event-detail");
  console.log("shot event-detail", firstEvent.id);
} else {
  console.log("no events available for event-detail");
}

/* Empty-state: a date far in the past with no events. */
await page.goto("/events?date=2019-01-01", { waitUntil: "domcontentloaded" }).catch(() => undefined);
await page.waitForTimeout(2000);
await page.fill('input[aria-label="Date"]', "2019-01-01").catch(() => undefined);
await page.getByRole("button", { name: "Search" }).click().catch(() => undefined);
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(OUT, "uxaudit-events-empty.png") });
console.log("shot events-empty");

/* Focus-visible evidence: tab through the quick filters on Events. */
await page.goto("/events", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
for (let i = 0; i < 5; i += 1) await page.keyboard.press("Tab");
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    box: `${Math.round(r.width)}x${Math.round(r.height)}`,
  };
});
report.focusProbe = focused;
console.log("focus probe", JSON.stringify(focused));
await page.screenshot({ path: resolve(OUT, "uxaudit-focus-events.png") });

/* Header status lamp text sampled over 12s: is "Checking" a terminal state? */
const samples = [];
await page.goto("/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 5; i += 1) {
  await page.waitForTimeout(2500);
  const text = await page
    .evaluate(() => document.querySelector("header")?.innerText?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "");
  samples.push(text);
}
report.headerSamples = samples;
console.log("header samples", JSON.stringify(samples));

await page.screenshot({ path: resolve(OUT, "uxaudit-dashboard-header.png") });

/* Dashboard hover affordance vs touch (no hover): same tile, touch context. */
const mobile = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const mLogin = await mobile.request.post("/api/auth/login", {
  data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
});
console.log("mobile login", mLogin.status());
const mp = await mobile.newPage();
mp.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(`[mobile] ${m.text().slice(0, 200)}`);
});
for (const [name, path, wait] of [
  ["dashboard", "/", 6000],
  ["events", "/events", 4500],
  ["settings-detection", "/settings/detection", 3500],
  ["settings-notifications", "/settings/notifications", 3500],
  ["playback", "/playback", 6000],
  ["settings-users", "/settings/users", 3000],
]) {
  await mp.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
  await mp.waitForTimeout(wait);
  await mp.screenshot({ path: resolve(OUT, `uxaudit-mobile-${name}.png`) });
  const data = await mp.evaluate(() => {
    const sel = 'a[href],button,input,select,textarea,[role="slider"],[tabindex]:not([tabindex="-1"])';
    const interactive = [...document.querySelectorAll(sel)];
    let small = 0;
    let under24 = 0;
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 44 || r.height < 44) small += 1;
      if (r.width < 24 || r.height < 24) under24 += 1;
    }
    const nav = document.querySelector('nav[aria-label="Primary"]:last-of-type');
    const navBox = nav ? nav.getBoundingClientRect() : null;
    const navItem = nav?.querySelector("a")?.getBoundingClientRect();
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    return {
      title: document.title,
      interactive: interactive.length,
      smallTargets: small,
      under24,
      navHeight: navBox ? Math.round(navBox.height) : null,
      navItem: navItem ? `${Math.round(navItem.width)}x${Math.round(navItem.height)}` : null,
      navItemFont: nav?.querySelector("a") ? getComputedStyle(nav.querySelector("a")).fontSize : null,
      horizontalOverflow,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  report.mobile[name] = data;
  console.log(`mobile ${name}`, JSON.stringify(data));
}

/* Detection page on mobile: is the fixed Save bar covered by the bottom nav? */
const geometry = await mp.evaluate(() => {
  const save = document.querySelector('[data-testid="detection-save"]');
  const nav = document.querySelector('nav[aria-label="Primary"]:last-of-type');
  if (!save || !nav) return null;
  const s = save.getBoundingClientRect();
  const n = nav.getBoundingClientRect();
  const navZ = getComputedStyle(nav).zIndex;
  const bar = save.closest("div.fixed") || save.parentElement?.parentElement;
  const barZ = bar ? getComputedStyle(bar).zIndex : null;
  const overlap = s.bottom > n.top && s.top < n.bottom;
  return { save: { top: Math.round(s.top), bottom: Math.round(s.bottom) }, nav: { top: Math.round(n.top), bottom: Math.round(n.bottom) }, navZ, barZ, overlap };
});
report.saveBarGeometryMobile = geometry;
console.log("save bar geometry (mobile)", JSON.stringify(geometry));

/* Detection page on desktop: does the fixed Save bar overlay the sidebar's Log out? */
const desktopGeometry = await page.evaluate(async () => {
  const r = await fetch("/api/settings/detection");
  void r;
  return null;
});
void desktopGeometry;
await page.goto("/settings/detection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const detDesktop = await page.evaluate(() => {
  const save = document.querySelector('[data-testid="detection-save"]');
  const logout = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Log out");
  const bar = save?.closest("div.fixed");
  const rect = (el) => (el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom), left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) } : null);
  const b = rect(bar);
  const l = rect(logout);
  const overlap = b && l ? !(b.bottom <= l.top || b.top >= l.bottom || b.right <= l.left || b.left >= l.right) : null;
  return { bar: b, logout: l, overlap, barLeft: b?.left, sidebarWidth: 220 };
});
report.saveBarGeometryDesktop = detDesktop;
console.log("save bar geometry (desktop)", JSON.stringify(detDesktop));
await page.screenshot({ path: resolve(OUT, "uxaudit-detection-desktop-bar.png") });

/* Unsaved-changes probe: toggle a switch, navigate away, come back. */
await page.goto("/settings/detection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const before = await page.getByTestId("person-enabled").isChecked().catch(() => null);
await page.getByTestId("person-enabled").click({ force: true }).catch(() => undefined);
await page.waitForTimeout(500);
const after = await page.getByTestId("person-enabled").isChecked().catch(() => null);
await page.goto("/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.goto("/settings/detection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const reloaded = await page.getByTestId("person-enabled").isChecked().catch(() => null);
report.unsavedChanges = { before, after, reloaded, lost: before === reloaded && after !== before };
console.log("unsaved probe", JSON.stringify(report.unsavedChanges));

/* Login page (logged-out context) */
const anon = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const ap = await anon.newPage();
await ap.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await ap.waitForTimeout(1200);
await ap.screenshot({ path: resolve(OUT, "uxaudit-login.png") });
const loginA11y = await ap.evaluate(() => ({
  h1: [...document.querySelectorAll("h1")].map((x) => x.textContent.trim()),
  inputs: [...document.querySelectorAll("input")].map((el) => ({
    name: el.getAttribute("name"),
    type: el.getAttribute("type"),
    height: Math.round(el.getBoundingClientRect().height),
    ariaLabel: el.getAttribute("aria-label"),
    hasLabel: Boolean(el.closest("label")),
    autocomplete: el.getAttribute("autocomplete"),
    autofocus: el.hasAttribute("autofocus"),
  })),
  buttonHeight: Math.round(document.querySelector('button[type="submit"]')?.getBoundingClientRect().height ?? 0),
  focusedOnLoad: document.activeElement?.tagName ?? null,
}));
report.login = loginA11y;
console.log("login a11y", JSON.stringify(loginA11y));
await ap.screenshot({ path: resolve(OUT, "uxaudit-login-focus.png") });

/* What the browser reports about contrast-relevant form control styling. */
await page.goto("/settings/users", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const inputStyles = await page.evaluate(() => {
  const input = document.querySelector("form input");
  if (!input) return null;
  const cs = getComputedStyle(input);
  return { border: cs.border, background: cs.backgroundColor, height: Math.round(input.getBoundingClientRect().height), fontSize: cs.fontSize };
});
report.inputStyle = inputStyles;
console.log("input style", JSON.stringify(inputStyles));

await browser.close();
writeFileSync(resolve(ROOT, "design/audit/before/uxaudit-measurements.json"), JSON.stringify(report, null, 2));
console.log("wrote design/audit/before/uxaudit-measurements.json");
console.log("console errors:", report.consoleErrors.slice(0, 15));
