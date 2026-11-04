import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const b = await chromium.launch();
const ctx = await b.newContext({ baseURL: "http://localhost:3000" });
await ctx.request.post("/api/auth/login", { data: { username: env.APP_USERNAME, password: env.APP_PASSWORD, next: "/" } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Page.enable");
let docs = 0;
cdp.on("Network.requestWillBeSent", (event) => {
  if (event.type !== "Document") return;
  docs += 1;
  if (docs > 6) return;
  const initiator = event.initiator;
  console.log(`\n=== DOC ${docs} ${event.request.url} ===`);
  console.log("initiator.type:", initiator?.type, "url:", initiator?.url ?? "");
  const stack = initiator?.stack;
  if (stack?.callFrames?.length) {
    for (const frame of stack.callFrames.slice(0, 12)) {
      console.log(`  at ${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`);
    }
  }
});
// Also record reload/assign calls from script before navigation happens.
await page.addInitScript(() => {
  const wrap = (name) => {
    const original = window.location[name].bind(window.location);
    try {
      Object.defineProperty(window.location, name, {
        configurable: true,
        value: (...args) => {
          console.log(`[loc] ${name} called`, new Error().stack);
          return original(...args);
        },
      });
    } catch (error) {
      console.log(`[loc] cannot wrap ${name}: ${String(error)}`);
    }
  };
  wrap("reload");
  wrap("assign");
  wrap("replace");
  window.addEventListener("beforeunload", () => {
    console.log("[loc] beforeunload", new Error().stack);
  });
});
page.on("console", (message) => {
  const text = message.text();
  if (text.includes("[loc]")) console.log("CONSOLE:", text.slice(0, 1500));
});
await page.goto("/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await b.close();
