import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const b = await chromium.launch();
const ctx = await b.newContext({ baseURL: "http://localhost:3000" });
await ctx.request.post("/api/auth/login", { data: { username: env.APP_USERNAME, password: env.APP_PASSWORD, next: "/" } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
let frames = 0; let requests = 0;
cdp.on("Network.webSocketFrameReceived", (event) => {
  frames += 1;
  if (frames > 30) return;
  let text = event.response.payloadData;
  try { text = JSON.stringify(JSON.parse(text)).slice(0, 600); } catch { /* binary */ text = String(text).slice(0, 200); }
  console.log(`WS <- ${text}`);
});
cdp.on("Network.webSocketFrameSent", (event) => {
  if (frames > 30) return;
  let text = event.response.payloadData;
  try { text = JSON.stringify(JSON.parse(text)).slice(0, 300); } catch { text = String(text).slice(0, 200); }
  console.log(`WS -> ${text}`);
});
cdp.on("Network.requestWillBeSent", (event) => {
  if (event.type !== "Document") return;
  requests += 1;
  if (requests <= 5) console.log(`DOC ${requests} initiator=${event.initiator?.type} stack0=${event.initiator?.stack?.callFrames?.[0]?.functionName}`);
});
page.on("console", (message) => {
  const t = message.text();
  if (t.includes("Building") || t.includes("rebuild") || t.includes("restart")) console.log("CONSOLE:", t.slice(0, 200));
});
await page.goto("/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("total ws frames:", frames, "document requests:", requests);
await b.close();
