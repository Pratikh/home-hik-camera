/**
 * Targeted DOM probe for the responsive audit.
 *
 * The screenshot pass (responsive-shots.mjs) proves what the screens look like;
 * this probe measures the things a screenshot alone cannot argue precisely:
 * bottom-bar item widths, header action crowding, tap-target sizes, truncated
 * text, fixed save bars vs the mobile nav, below-the-fold geometry, and tile /
 * form dimensions at each breakpoint.
 *
 * Usage: node design/tools/responsive-probe.mjs
 * Writes design/tools/responsive-probe.json (evidence JSON for RESPONSIVE-FINDINGS.md)
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/tools/responsive-probe.json");
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

function probe() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
  };
  const label = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.getAttribute("name") || el.getAttribute("placeholder") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
  };
  const applyTo = (el) => {
    const s = getComputedStyle(el);
    return { overflow: el.scrollWidth > el.clientWidth + 1, scrollW: el.scrollWidth, clientW: el.clientWidth, fs: parseFloat(s.fontSize), lh: s.lineHeight, align: s.textAlign, ellipsis: s.textOverflow, overflowX: s.overflowX, text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) };
  };
  const out = { vw, vh, path: location.pathname };
  const all = Array.from(document.querySelectorAll("body *")).filter(visible);

  // ---- header crowding -----------------------------------------------------
  const header = document.querySelector("header");
  out.header = null;
  if (header && visible(header)) {
    const kids = Array.from(header.children).filter(visible).map((c) => ({ ...rect(c), children: Array.from(c.children).filter(visible).map((k) => ({ tag: k.tagName.toLowerCase(), label: label(k), ...rect(k) })) }));
    out.header = { ...rect(header), scrollW: header.scrollWidth, clientW: header.clientWidth, children: kids };
    // Action block width compared to available space.
    const right = header.lastElementChild;
    if (right) out.header.actionBlock = { ...rect(right), contentW: right.scrollWidth };
  }

  // ---- mobile bottom bar ---------------------------------------------------
  const nav = Array.from(document.querySelectorAll("nav")).find((n) => getComputedStyle(n).position === "fixed" && visible(n));
  out.bottomNav = null;
  if (nav) {
    const items = Array.from(nav.querySelectorAll("a")).filter(visible).map((a) => ({ label: label(a), ...rect(a), ...applyTo(a) }));
    const cs = getComputedStyle(nav);
    out.bottomNav = { ...rect(nav), z: cs.zIndex, padBottom: cs.paddingBottom, bg: cs.backgroundColor, items };
  }

  // ---- sidebar -------------------------------------------------------------
  const aside = document.querySelector("aside");
  out.aside = aside && visible(aside) ? { ...rect(aside), links: Array.from(aside.querySelectorAll("a")).filter(visible).map((a) => ({ label: label(a), ...rect(a) })) } : null;

  // ---- scroll regions ------------------------------------------------------
  const main = document.querySelector("main");
  out.scroll = {
    docScrollH: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docOverflowX: document.documentElement.scrollWidth - vw,
    mainScrollH: main?.scrollHeight ?? null,
    mainClientH: main?.clientHeight ?? null,
    mainOverflowY: main ? getComputedStyle(main).overflowY : null,
  };

  // ---- tiny text -----------------------------------------------------------
  const textLeaves = all.filter((el) => el.children.length === 0 && (el.textContent || "").trim().length > 0);
  const tiny = textLeaves
    .map((el) => ({ ...applyTo(el), tag: el.tagName.toLowerCase() }))
    .filter((t) => t.fs < 12)
    .sort((a, b) => a.fs - b.fs);
  out.tinyText = { count: tiny.length, sizes: [...new Set(tiny.map((t) => t.fs))], samples: tiny.slice(0, 10) };

  // ---- tap targets ---------------------------------------------------------
  const interactive = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role='button'], summary")).filter(visible);
  const targets = interactive.map((el) => {
    const s = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || "", label: label(el), ...rect(el), fs: parseFloat(s.fontSize) };
  });
  out.tapTargets = {
    total: targets.length,
    under44: targets.filter((t) => t.w < 44 || t.h < 44),
    under24: targets.filter((t) => t.w < 24 || t.h < 24),
  };

  // ---- truncated text ------------------------------------------------------
  const clipped = all
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (el.textContent || "").trim().length > 0)
    .map((el) => ({ tag: el.tagName.toLowerCase(), ...applyTo(el) }));
  out.truncated = clipped.slice(0, 20);

  // ---- fixed / sticky chrome ----------------------------------------------
  out.fixed = all
    .filter((el) => getComputedStyle(el).position === "fixed")
    .map((el) => ({ tag: el.tagName.toLowerCase(), label: label(el), ...rect(el), z: getComputedStyle(el).zIndex }))
    .slice(0, 10);

  // ---- page-specific -------------------------------------------------------
  const specific = {};
  // camera tiles (dashboard + cameras)
  const tiles = Array.from(document.querySelectorAll("main article")).filter(visible);
  if (tiles.length) {
    specific.tiles = tiles.slice(0, 6).map((el) => {
      const caption = el.querySelector("h2");
      const media = el.querySelector("video, canvas, .aspect-video, [class*='aspect']");
      return { title: caption?.textContent?.trim().slice(0, 30) ?? null, ...rect(el), media: media ? rect(media) : null, mediaAspect: media ? +(media.width / media.height).toFixed(2) : null };
    });
    const firstRow = tiles.filter((t) => rect(t).y === rect(tiles[0]).y);
    specific.tileColumns = firstRow.length;
  }
  // events list rows + filter form
  const rows = Array.from(document.querySelectorAll("main ul li > button, main ul li > a")).filter(visible);
  if (rows.length) specific.eventRows = rows.slice(0, 4).map((el) => ({ ...rect(el), ...applyTo(el) }));
  const form = document.querySelector("main form");
  if (form) specific.filterForm = { ...rect(form), controls: Array.from(form.querySelectorAll("input,select,button")).filter(visible).map((el) => ({ tag: el.tagName.toLowerCase(), label: label(el), ...rect(el) })) };
  // playback geometry
  const player = Array.from(document.querySelectorAll("main section")).filter(visible).find((s) => s.getAttribute("aria-label") === "Playback");
  const timeline = Array.from(document.querySelectorAll("main section")).filter(visible).find((s) => s.getAttribute("aria-label") === "Timeline");
  if (player || timeline) specific.playback = { player: player ? rect(player) : null, timeline: timeline ? rect(timeline) : null, viewportH: vh, timelineBelowFold: timeline ? rect(timeline).bottom > vh : null };
  // fixed save bars (detection) and their overlap with the bottom nav
  const fixedBars = Array.from(document.querySelectorAll("div")).filter((el) => {
    const s = getComputedStyle(el);
    return s.position === "fixed" && rect(el).h > 20 && rect(el).w > vw * 0.8 && s.zIndex !== "auto";
  });
  if (fixedBars.length) {
    specific.fixedBars = fixedBars.map((el) => {
      const r = rect(el);
      const navRect = nav ? rect(nav) : null;
      const overlapH = navRect ? Math.max(0, Math.min(r.bottom, navRect.bottom) - Math.max(r.y, navRect.y)) : 0;
      return { ...r, z: getComputedStyle(el).zIndex, text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), overlapWithBottomNavPx: overlapH, coveredByNav: overlapH > 0 };
    });
  }
  // tabular data
  specific.tables = Array.from(document.querySelectorAll("table")).map((t) => ({ ...rect(t), rows: t.rows.length }));
  // horizontal scrollers
  specific.hScrollers = all
    .filter((el) => {
      const s = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth + 2 && (s.overflowX === "auto" || s.overflowX === "scroll");
    })
    .map((el) => ({ tag: el.tagName.toLowerCase(), ...rect(el), scrollW: el.scrollWidth, clientW: el.clientWidth }));

  out.specific = specific;
  return out;
}

const e = env();
const browser = await chromium.launch();
const probeCtx = await browser.newContext({ baseURL: BASE });
await probeCtx.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
let eventId = "evt_417d9dd35c747de1567a8a95";
try {
  const res = await probeCtx.request.get("/api/events/recent?limit=1");
  const body = await res.json();
  if (body?.events?.[0]?.id) eventId = body.events[0].id;
} catch {
  /* fallback */
}
await probeCtx.close();
console.log("event id:", eventId);

const results = [];
for (const size of Object.keys(SIZES)) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size] });
  await ctx.request.post("/api/auth/login", { data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" } });
  const page = await ctx.newPage();
  for (const [key, rawPath, settle] of ROUTES) {
    const path = rawPath === "__EVENT__" ? `/events/${eventId}` : rawPath;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      await page.waitForTimeout(1000);
      try {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch {
        console.log("skip", size, key);
        continue;
      }
    }
    await page.waitForTimeout(settle);
    let data;
    try {
      data = await page.evaluate(probe);
    } catch (err) {
      data = { error: String(err).slice(0, 200) };
    }
    results.push({ size, route: key, expectedPath: path, actualPath: new URL(page.url()).pathname, ...data });
    const h = data.header;
    console.log(
      `${size.padEnd(6)} ${key.padEnd(22)} docH=${String(data.scroll?.docScrollH).padStart(5)} mainScroll=${data.scroll?.mainScrollH}/${data.scroll?.mainClientH} ` +
        `header.w=${h?.w ?? "-"}/${h?.clientW ?? "-"} navItems=${data.bottomNav?.items.length ?? "-"} tap<44=${data.tapTargets?.under44.length ?? "-"} tinyText=${data.tinyText?.count ?? "-"}`,
    );
  }
  await ctx.close();
}
// Unauthenticated login screen (fresh context, no session cookie).
for (const size of Object.keys(SIZES)) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size] });
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(probe);
  results.push({ size, route: "login", expectedPath: "/login", actualPath: new URL(page.url()).pathname, unauthenticated: true, ...data });
  console.log(`login ${size}: tap<44=${data.tapTargets.under44.length} docH=${data.scroll.docScrollH}`);
  await ctx.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), eventId, sizes: SIZES, results }, null, 2));
console.log("wrote", OUT);
