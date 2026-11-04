import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

/** Read-only reload reproduction harness. Navigates, observes, prints evidence. */
const ROOT = process.cwd();
const base = process.env.QA_BASE_URL ?? "http://localhost:3000";

function env() {
  const out = {};
  for (const raw of readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/)) {
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

const target = process.argv[2] ?? "/";
const seconds = Number(process.argv[3] ?? 20);
const authenticated = process.argv[4] !== "anon";
const e = env();

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
if (authenticated) {
  const login = await context.request.post("/api/auth/login", {
    data: { username: e.APP_USERNAME, password: e.APP_PASSWORD, next: "/" },
  });
  console.log("[auth] login status:", login.status(), "cookies:", (await context.cookies()).map((c) => `${c.name} path=${c.path} secure=${c.secure} sameSite=${c.sameSite} httpOnly=${c.httpOnly} expires=${c.expires}`).join(" | "));
}

const page = await context.newPage();
const navigations = [];
const documents = [];
const consoles = [];
const pageErrors = [];
const responses = [];
const start = Date.now();

page.on("framenavigated", (frame) => {
  if (frame !== page.mainFrame()) return;
  navigations.push({ ms: Date.now() - start, url: frame.url() });
});
page.on("request", (request) => {
  if (request.resourceType() === "document") documents.push({ ms: Date.now() - start, method: request.method(), url: request.url(), headers: request.headers() });
});
page.on("console", (message) => consoles.push({ ms: Date.now() - start, type: message.type(), text: message.text().slice(0, 300) }));
page.on("pageerror", (error) => pageErrors.push({ ms: Date.now() - start, text: String(error).slice(0, 400) }));
page.on("response", (response) => {
  const req = response.request();
  if (req.resourceType() === "document" || response.status() >= 300) {
    responses.push({ ms: Date.now() - start, status: response.status(), url: response.url(), type: req.resourceType(), location: response.headers()["location"] ?? null, csp: (response.headers()["content-security-policy"] ?? "").slice(0, 120) });
  }
});

console.log(`[run] loading ${base}${target} (authenticated=${authenticated}) for ${seconds}s`);
let gotoError = null;
try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
} catch (error) {
  gotoError = String(error).slice(0, 300);
  console.log("[run] goto error:", gotoError);
}
// Observe for the whole window without interacting.
await page.waitForTimeout(seconds * 1000);
const finalUrl = page.url();
const html = await page.content().catch(() => "");
const bodyText = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);

console.log("\n=== DOCUMENT REQUESTS (" + documents.length + ") ===");
for (const doc of documents.slice(0, 40)) console.log(`+${doc.ms}ms ${doc.method} ${doc.url}`);

console.log("\n=== NAVIGATIONS (" + navigations.length + ") ===");
for (const nav of navigations.slice(0, 40)) console.log(`+${nav.ms}ms ${nav.url}`);

console.log("\n=== DOCUMENT/3xx RESPONSES (" + responses.length + ") ===");
for (const res of responses.slice(0, 60)) console.log(`+${res.ms}ms ${res.status} ${res.type} ${res.url}${res.location ? " -> " + res.location : ""}`);

console.log("\n=== CONSOLE (" + consoles.length + ") ===");
for (const entry of consoles.slice(0, 60)) console.log(`+${entry.ms}ms [${entry.type}] ${entry.text}`);

console.log("\n=== PAGE ERRORS (" + pageErrors.length + ") ===");
for (const entry of pageErrors.slice(0, 20)) console.log(`+${entry.ms}ms ${entry.text}`);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify({
  target,
  authenticated,
  seconds,
  gotoError,
  finalUrl,
  documentRequests: documents.length,
  navigations: navigations.length,
  consoleErrors: consoles.filter((c) => c.type === "error").length,
  pageErrors: pageErrors.length,
  bodyStart: bodyText.slice(0, 160),
  reloadDetected: documents.length > 1 || navigations.length > 1,
}, null, 2));

await browser.close();
