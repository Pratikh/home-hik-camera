import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/guruswamihiremath/Desktop/projects/home-hik-camera";
const OUT = process.argv[2] ?? resolve(ROOT, "design/audit/before");
const SIZE = process.argv[3] ?? "desktop";

const sizes = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
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

const ROUTES = [
  ["dashboard", "/"],
  ["cameras", "/cameras"],
  ["events", "/events"],
  ["event-stats", "/events/stats"],
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
  ["login", "/login"],
];

const e = env();
mkdirSync(OUT, { recursive: true });
const base = "http://localhost:3000";
const browser = await chromium.launch();
const viewport = sizes[SIZE];
const ctx = await browser.newContext({ baseURL: base, viewport });

const login = await ctx.request.post("/api/auth/login", {
  data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
});
console.log("login", login.status());
if (login.status() !== 200) process.exit(1);

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

for (const [name, path] of ROUTES) {
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  } catch (err) {
    console.log("goto retry", name, String(err).split("\n")[0].slice(0, 120));
    await page.waitForTimeout(1500);
    try { await page.goto(path, { waitUntil: "domcontentloaded" }); } catch (e2) { console.log("goto failed", name); }
  }
  console.log("  url:", page.url());
  await page.waitForTimeout(name === "playback" || name === "events" ? 4500 : 2500);
  await page.screenshot({ path: resolve(OUT, `${name}-${SIZE}.png`), fullPage: false });
  await page.screenshot({ path: resolve(OUT, `${name}-${SIZE}-full.png`), fullPage: true });
  console.log("shot", name);
}

await browser.close();
console.log("console errors:", errors.slice(0, 12));
