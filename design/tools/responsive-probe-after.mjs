import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Responsive + diagnostics probe for the redesigned hub.
 * Visits every route at 1920/1440/834/390, records horizontal overflow,
 * console/page errors, HTTP >= 400 and failed requests, and writes JSON.
 * Read-only: navigates and measures, captures no screenshots.
 */
const ROOT = process.cwd();
const OUT = resolve(ROOT, "design/audit/responsive-after.json");

function env() {
  const out = {};
  for (const raw of readFileSync(resolve(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const ROUTES = [
  ["dashboard", "/"],
  ["cameras", "/cameras"],
  ["events", "/events"],
  ["events-stats", "/events/stats"],
  ["faces", "/faces"],
  ["playback", "/playback"],
  ["notifications", "/notifications"],
  ["device", "/device"],
  ["account", "/account"],
  ["settings", "/settings"],
  ["settings-users", "/settings/users"],
  ["settings-notifications", "/settings/notifications"],
  ["settings-detection", "/settings/detection"],
  ["settings-audit", "/settings/audit-log"],
  ["settings-system", "/settings/system"],
];
const SIZES = { desktop: 1920, laptop: 1440, tablet: 834, mobile: 390 };
const HEIGHTS = { desktop: 1080, laptop: 900, tablet: 1112, mobile: 844 };

const e = env();
const base = "http://localhost:3000";
const browser = await chromium.launch();
const results = [];

for (const [size, width] of Object.entries(SIZES)) {
  const context = await browser.newContext({ baseURL: base, viewport: { width, height: HEIGHTS[size] } });
  const login = await context.request.post("/api/auth/login", {
    data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
  });
  if (login.status() !== 200) throw new Error(`login ${login.status()}`);
  const page = await context.newPage();
  let current = "";
  const issues = [];
  page.on("console", (m) => { if (m.type() === "error") issues.push({ route: current, kind: "console", detail: m.text().slice(0, 200) }); });
  page.on("pageerror", (error) => issues.push({ route: current, kind: "pageerror", detail: String(error).slice(0, 200) }));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") issues.push({ route: current, kind: "requestfailed", detail: `${request.url()} ${request.failure()?.errorText}` });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/api/playback/thumbnail/")) {
      issues.push({ route: current, kind: "http", detail: `${response.status()} ${response.url()}` });
    }
  });

  for (const [name, path] of ROUTES) {
    current = name;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    } catch {
      await page.waitForTimeout(1500);
      try { await page.goto(path, { waitUntil: "domcontentloaded" }); } catch { results.push({ size, route: name, error: "navigation" }); continue; }
    }
    await page.waitForTimeout(name === "dashboard" ? 7000 : name === "events" || name === "faces" || name === "playback" ? 4500 : 3000);
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const main = document.querySelector("main");
      const smallTargets = Array.from(document.querySelectorAll("button, a, input, select")).filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && rect.height < 24;
      }).length;
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        scrollHeight: doc.scrollHeight,
        viewportHeight: window.innerHeight,
        mainHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
        h1: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent?.trim()).slice(0, 2),
        smallTargets,
      };
    });
    const routeIssues = issues.filter((issue) => issue.route === name);
    results.push({
      size,
      route: name,
      h1: metrics.h1,
      horizontalOverflow: metrics.scrollWidth > metrics.innerWidth + 1 ? metrics.scrollWidth - metrics.innerWidth : 0,
      scrollHeight: metrics.scrollHeight,
      viewportHeight: metrics.viewportHeight,
      smallTargetsUnder24: metrics.smallTargets,
      issues: routeIssues,
    });
    console.log(size, name, `overflow=${metrics.scrollWidth > metrics.innerWidth + 1 ? metrics.scrollWidth - metrics.innerWidth : 0}`, `small=${metrics.smallTargets}`, `issues=${routeIssues.length}`);
  }
  await context.close();
}

mkdirSync(resolve(ROOT, "design/audit"), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2));
await browser.close();
console.log("wrote", OUT);
