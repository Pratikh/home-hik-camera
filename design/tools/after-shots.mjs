import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Capture AFTER screenshots of the redesigned hub at the responsive matrix.
 * Usage: node design/tools/after-shots.mjs [outDir] [onlyPrefixes,comma]
 * The hub must already be running. Read-only: navigates and screenshots only.
 */
const ROOT = process.cwd();
const OUT = resolve(ROOT, process.argv[2] ?? "design/audit/after");
const ONLY = process.env.ROUTES ? process.env.ROUTES.split(",") : null;

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
  ["dashboard", "/", 9000],
  ["cameras", "/cameras", 5000],
  ["events", "/events", 7000],
  ["events-stats", "/events/stats", 5000],
  ["faces", "/faces", 6000],
  ["playback", "/playback", 7000],
  ["notifications", "/notifications", 5000],
  ["device", "/device", 5000],
  ["account", "/account", 5000],
  ["settings", "/settings", 5000],
  ["settings-users", "/settings/users", 5000],
  ["settings-notifications", "/settings/notifications", 6000],
  ["settings-detection", "/settings/detection", 6000],
  ["settings-audit", "/settings/audit-log", 5000],
  ["settings-system", "/settings/system", 6000],
];

const SIZES = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

const e = env();
mkdirSync(OUT, { recursive: true });
const base = process.env.QA_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();

for (const [size, viewport] of Object.entries(SIZES)) {
  const context = await browser.newContext({ baseURL: base, viewport });
  const login = await context.request.post("/api/auth/login", {
    data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
  });
  if (login.status() !== 200) throw new Error(`login failed: ${login.status()}`);
  const page = await context.newPage();
  let eventDetailId = null;
  try {
    const recent = await context.request.get("/api/events/recent?limit=1");
    if (recent.ok()) {
      const body = await recent.json();
      eventDetailId = body.events?.[0]?.id ?? null;
    }
  } catch { /* optional */ }
  const routes = [...ROUTES];
  if (eventDetailId) routes.splice(3, 0, ["event-detail", `/events/${eventDetailId}`, 5000]);
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 120)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${String(error).slice(0, 120)}`));

  for (const [name, path, wait] of routes) {
    if (ONLY && !ONLY.includes(name)) continue;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    } catch {
      await page.waitForTimeout(1200);
      try {
        await page.goto(path, { waitUntil: "domcontentloaded" });
      } catch {
        console.log("goto failed", name);
        continue;
      }
    }
    await page.waitForTimeout(wait);
    await page.screenshot({ path: resolve(OUT, `${name}-${size}.png`) });
    await page.screenshot({ path: resolve(OUT, `${name}-${size}-full.png`), fullPage: true });
    console.log("shot", name, size);
    if (size === "desktop" && name === "dashboard") {
      const expand = page.getByRole("button", { name: /Open .* full screen/ }).first();
      if (await expand.count()) {
        await expand.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(OUT, "dashboard-focus-desktop.png") });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      }
    }
    if (size === "mobile" && name === "events") {
      const row = page.locator("li button").first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: resolve(OUT, "events-sheet-mobile.png") });
      }
    }
  }
  if (problems.length) console.log("problems", size, problems.slice(0, 8));
  await context.close();
}

// Unauthenticated login, chrome-free.
for (const [size, viewport] of Object.entries(SIZES)) {
  const context = await browser.newContext({ baseURL: base, viewport });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `login-${size}.png`) });
  await page.screenshot({ path: resolve(OUT, `login-${size}-full.png`), fullPage: true });
  console.log("shot login", size);
  await context.close();
}

await browser.close();
console.log("done ->", OUT);
