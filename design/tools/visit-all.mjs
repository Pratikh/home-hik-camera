import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const routes=["/","/cameras","/events","/events/stats","/faces","/playback","/notifications","/device","/account","/settings","/settings/users","/settings/notifications","/settings/detection","/settings/audit-log","/settings/system"];
const b=await chromium.launch(); const ctx=await b.newContext({baseURL:"http://localhost:3000",viewport:{width:1280,height:900}});
await ctx.request.post("/api/auth/login",{data:{username:env.APP_USERNAME,password:env.APP_PASSWORD,next:"/"}});
const p=await ctx.newPage();
for(const r of routes){ try{ await p.goto(r,{waitUntil:"domcontentloaded",timeout:30000}); }catch(e){ console.log("nav fail",r,String(e).slice(0,80)); } await p.waitForTimeout(1200); console.log("visited",r); }
await b.close();
