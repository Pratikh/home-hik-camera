/**
 * Baseline (BEFORE) responsive screenshot capture for Home CCTV Hub.
 *
 * Usage:
 *   node design/tools/responsive-shots.mjs [--size tablet|mobile|laptop|all] [--routes a,b]
 *
 * Produces, in design/audit/before/:
 *   <route>-<size>.png        viewport screenshot
 *   <route>-<size>-full.png   full-page screenshot
 *   login-<size>.png / login-<size>-full.png  from an UNAUTHENTICATED fresh context
 *
 * Also writes design/tools/responsive-metrics.json with DOM measurements used by
 * RESPONSIVE-FINDINGS.md (overflow, tap targets, truncation, header/nav geometry).
 *
 * Rules honoured: never starts/stops servers, never changes app code. Login uses
 * APP_USERNAME/APP_PASSWORD from .env through the app's own /api/auth/login.
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = resolve(ROOT, "design/audit/before");
const METRICS = resolve(ROOT, "design/tools/responsive-metrics.json");
const BASE = "http://localhost:3000";

/* Real event id, resolved at runtime from the page context (never hardcoded). */
const EVENT_ID_FALLBACK = "evt_417d9dd35c747de1567a8a95";

const SIZES = {
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
  laptop: { width: 1440, height: 900 },
};

/** route key -> [path, settleMs, label] */
const ROUTES = [
  ["dashboard", "/", 7000],
  ["cameras", "/cameras", 5000],
  ["events", "/events", 8000],
  ["event-detail", "__EVENT__", 6000],
  ["event-stats", "/events/stats", 5000],
  ["faces", "/faces", 5000],
  ["playback", "/playback", 6000],
  ["notifications", "/notifications", 5000],
  ["device", "/device", 5000],
  ["account", "/account", 5000],
  ["settings", "/settings", 5000],
  ["settings-notifications", "/settings/notifications", 5000],
  ["settings-users", "/settings/users", 5000],
  ["settings-detection", "/settings/detection", 5000],
  ["settings-audit", "/settings/audit-log", 5000],
  ["settings-system", "/settings/system", 5000],
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

/** PNG pixel dimensions straight from the IHDR chunk. */
function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

const args = process.argv.slice(2);

const sizeArg = args.includes("--size") ? args[args.indexOf("--size") + 1] : "all";
const routeArg = args.includes("--routes") ? args[args.indexOf("--routes") + 1].split(",") : null;
const sizes = sizeArg === "all" ? Object.keys(SIZES) : [sizeArg];
const routes = routeArg ? ROUTES.filter(([k]) => routeArg.includes(k)) : ROUTES;

/* Runs inside the page: DOM measurements for the findings document. */
function collectMetrics({ size, routeKey, path }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cls = (el.className && typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 6).join(".");
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      cls,
      text,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const all = Array.from(document.querySelectorAll("body *")).filter(visible);

  // 1. Document horizontal overflow.
  const docOverflow =
    Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0,
    ) - vw;

  // 2. Elements whose box crosses the right edge of the viewport.
  const pastRight = all
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw + 1;
    })
    .map(describe)
    .slice(0, 15);

  // 3. Elements that clip their own content horizontally (truncation / scroll).
  const clipped = all
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
    .map((el) => ({
      ...describe(el),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
    }))
    .slice(0, 20);

  // 4. Horizontal scroll containers.
  const hScrollers = all
    .filter((el) => {
      const s = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth + 2 && (s.overflowX === "auto" || s.overflowX === "scroll");
    })
    .map(describe)
    .slice(0, 10);

  // 5. Tap targets below the 44x44 comfortable minimum (Apple HIG / WCAG 2.5.8 24px).
  const interactive = Array.from(
    document.querySelectorAll("a[href], button, input, select, textarea, [role='button'], summary"),
  ).filter(visible);
  const smallTargets = interactive
    .map(describe)
    .filter((d) => d.w < 44 || d.h < 44);
  const tinyTargets = interactive.map(describe).filter((d) => d.w < 24 || d.h < 24);

  // 6. Small text.
  const tinyText = all
    .filter((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.fontSize) < 12 && (el.textContent || "").trim().length > 0 && el.children.length === 0;
    })
    .map(describe)
    .slice(0, 15);

  // 7. Header geometry and whether its children overlap.
  const header = document.querySelector("header");
  let headerInfo = null;
  if (header && visible(header)) {
    const hr = header.getBoundingClientRect();
    const kids = Array.from(header.querySelectorAll("*")).filter(visible).map(describe);
    const overlaps = [];
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i];
        const b = kids[j];
        if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) {
          const ta = a.tag + ":" + a.text;
          const tb = b.tag + ":" + b.text;
          if (a.w * a.h > 20 && b.w * b.h > 20) overlaps.push([ta, tb]);
        }
      }
    }
    headerInfo = { ...describe(header), scrollW: header.scrollWidth, clientW: header.clientWidth, overlaps: overlaps.slice(0, 6), childCount: kids.length };
  }

  // 8. Bottom nav (mobile).
  const bottomNav = Array.from(document.querySelectorAll("nav")).find(
    (n) => getComputedStyle(n).position === "fixed" && visible(n),
  );
  let bottomNavInfo = null;
  if (bottomNav) {
    const items = Array.from(bottomNav.querySelectorAll("a")).filter(visible).map((a) => ({
      ...describe(a),
      trunc: a.scrollWidth > a.clientWidth + 2,
    }));
    bottomNavInfo = {
      ...describe(bottomNav),
      padBottom: getComputedStyle(bottomNav).paddingBottom,
      items,
    };
  }

  // 9. Sidebar (desktop/tablet).
  const aside = document.querySelector("aside");
  const asideInfo = aside && visible(aside) ? { ...describe(aside), scrollH: aside.scrollHeight, clientH: aside.clientHeight } : null;

  // 10. Main scroll region.
  const main = document.querySelector("main");
  const mainInfo = main
    ? {
        ...describe(main),
        scrollW: main.scrollWidth,
        clientW: main.clientWidth,
        overflowX: getComputedStyle(main).overflowX,
        overflowY: getComputedStyle(main).overflowY,
        csOverflowY: getComputedStyle(main).overflowY,
      }
    : null;

  // 11. Sticky / fixed chrome.
  const fixedEls = all
    .filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position))
    .map((el) => ({ ...describe(el), position: getComputedStyle(el).position }))
    .slice(0, 12);

  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const flags = {
    videoGatewayUnavailable: /video gateway unavailable/i.test(text),
    errorPage: /application error|unhandled runtime error|500\b|something went wrong/i.test(text),
    loginPage: /sign in|log in|password/i.test(text) && location.pathname === "/login",
    textLength: text.length,
    hasTables: document.querySelectorAll("table").length,
    hasCards: document.querySelectorAll("[class*='rounded']").length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    fontsLoaded: document.fonts ? document.fonts.status : "unknown",
    devicePixelRatio: window.devicePixelRatio,
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  return {
    path: location.pathname,
    url: location.href,
    vw,
    vh,
    docOverflow,
    docScrollH: document.documentElement.scrollHeight,
    pastRight,
    clipped,
    hScrollers,
    interactiveCount: interactive.length,
    smallTargets: { count: smallTargets.length, samples: smallTargets.slice(0, 12) },
    tinyTargets: { count: tinyTargets.length, samples: tinyTargets.slice(0, 8) },
    tinyText: { count: tinyText.length, samples: tinyText },
    header: headerInfo,
    bottomNav: bottomNavInfo,
    aside: asideInfo,
    main: mainInfo,
    fixed: fixedEls,
    flags,
    sectionHeadings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(visible)
      .map((h) => ({ tag: h.tagName.toLowerCase(), text: (h.textContent || "").trim().slice(0, 50), w: Math.round(h.getBoundingClientRect().width) }))
      .slice(0, 12),
  };
}

async function gotoWithRetry(page, path, attempt = 0) {
  try {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
    return true;
  } catch (err) {
    const msg = String(err).split("\n")[0].slice(0, 140);
    if (attempt === 0 && /ERR_ABORTED|interrupted|Navigation/.test(msg)) {
      log(`  goto interrupted (${msg}); retrying once`);
      await page.waitForTimeout(1200);
      return gotoWithRetry(page, path, 1);
    }
    log(`  goto FAILED: ${msg}`);
    return false;
  }
}

async function waitForRendered(page) {
  // Content present + no skeleton-only state, capped.
  try {
    await page.waitForFunction(
      () => (document.body.innerText || "").replace(/\s+/g, " ").trim().length > 40,
      undefined,
      { timeout: 15000 },
    );
  } catch {
    log("  content wait timed out (capturing anyway)");
  }
}

const e = env();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

// ---------------------------------------------------------------- event id + login
const authCtx = await browser.newContext({ baseURL: BASE, viewport: SIZES.laptop });
const loginRes = await authCtx.request.post("/api/auth/login", {
  data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
});
log("login status:", loginRes.status());
if (loginRes.status() !== 200) {
  log("FATAL: could not authenticate; aborting");
  await browser.close();
  process.exit(1);
}

let eventId = EVENT_ID_FALLBACK;
try {
  const res = await authCtx.request.get("/api/events/recent?limit=1");
  const body = await res.json();
  if (body?.events?.[0]?.id) eventId = body.events[0].id;
} catch (err) {
  log("event id lookup failed:", String(err).slice(0, 120));
}
log("event id:", eventId, "| event detail path: /events/" + eventId);

// ------------------------------------------------------------- login screens
for (const size of sizes) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const okNav = await gotoWithRetry(page, "/login");
  await waitForRendered(page);
  await page.waitForTimeout(1500);
  const out1 = resolve(OUT, `login-${size}.png`);
  const out2 = resolve(OUT, `login-${size}-full.png`);
  await page.screenshot({ path: out1 });
  await page.screenshot({ path: out2, fullPage: true });
  const m = await page.evaluate(collectMetrics, { size, routeKey: "login", path: "/login" });
  results.push({
    size,
    route: "login",
    path: "/login",
    status: okNav ? "captured" : "nav-failed",
    finalUrl: page.url(),
    files: [out1, out2].map((f) => ({ file: f.split("/").pop(), ...pngSize(f) })),
    metrics: m,
    unauthenticated: true,
  });
  log(`login-${size} -> ${page.url()} | ${pngSize(out1).width}x${pngSize(out1).height}`);
  await ctx.close();
}

// ------------------------------------------------------------- app screens
for (const size of sizes) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: SIZES[size], deviceScaleFactor: 1 });
  const auth = await ctx.request.post("/api/auth/login", {
    data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
  });
  if (auth.status() !== 200) throw new Error(`re-login failed for ${size}`);

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().replace(BASE, "").slice(0, 180));
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + String(err).slice(0, 180)));

  for (const [key, rawPath, settle] of routes) {
    const path = rawPath === "__EVENT__" ? `/events/${eventId}` : rawPath;
    const before = consoleErrors.length;
    const okNav = await gotoWithRetry(page, path);
    await waitForRendered(page);
    await page.waitForTimeout(settle);

    const finalUrl = new URL(page.url());
    const viewportFile = resolve(OUT, `${key}-${size}.png`);
    const fullFile = resolve(OUT, `${key}-${size}-full.png`);
    await page.screenshot({ path: viewportFile });
    await page.screenshot({ path: fullFile, fullPage: true });
    const vp = pngSize(viewportFile);
    const fp = pngSize(fullFile);

    let metrics;
    try {
      metrics = await page.evaluate(collectMetrics, { size, routeKey: key, path });
    } catch (err) {
      metrics = { error: String(err).slice(0, 200) };
    }

    results.push({
      size,
      route: key,
      path,
      expectedPath: path,
      status: okNav ? "captured" : "nav-failed",
      finalPath: finalUrl.pathname,
      viewportFile: viewportFile.split("/").pop(),
      fullFile: fullFile.split("/").pop(),
      vp,
      fp,
      redirected: finalUrl.pathname !== path,
      consoleErrors: consoleErrors.slice(before),
      metrics,
    });
    log(
      `${key}-${size}: ${finalUrl.pathname} vp=${vp.width}x${vp.height}/${vp.bytes}B full=${fp.width}x${fp.height}/${fp.bytes}B` +
        (finalUrl.pathname !== path ? " (REDIRECTED)" : ""),
    );
  }

  // extra: mobile-only focused-camera state is intentionally NOT captured (not a route)
  await ctx.close();
}

await browser.close();
writeFileSync(
  METRICS,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      base: BASE,
      eventId,
      sizes: SIZES,
      results,
    },
    null,
    2,
  ),
);

const captured = results.filter((r) => r.status === "captured");
const pngs = captured.reduce((n, r) => n + (r.files ? r.files.length : 2), 0);
const suspicious = results.filter(
  (r) =>
    r.status !== "captured" ||
    (r.files || []).some((f) => f.bytes < 12000) ||
    (r.vp && r.vp.bytes < 12000) ||
    r.metrics?.flags?.errorPage ||
    r.redirected ||
    (r.metrics?.flags?.textLength ?? 0) < 80,
);
console.log("\n==== SUMMARY ====");
console.log("screens captured:", captured.length, "| png files:", pngs);
console.log("metrics:", METRICS);
if (suspicious.length) {
  console.log("SUSPICIOUS:");
  for (const s of suspicious) {
    console.log(" -", s.size, s.route, s.status, s.finalPath || "", s.redirected ? "redirected" : "", JSON.stringify(s.metrics?.flags ?? {}).slice(0, 120));
  }
} else {
  console.log("all screens look rendered (no tiny files / error pages / unexpected redirects)");
}
