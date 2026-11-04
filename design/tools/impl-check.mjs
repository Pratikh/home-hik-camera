import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const ROOT=process.cwd(); const OUT=resolve(ROOT,"design/impl-check"); mkdirSync(OUT,{recursive:true});
const env=Object.fromEntries(readFileSync(resolve(ROOT,".env"),"utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v]}));
const b=await chromium.launch();
const sizes={desktop:{width:1920,height:1080},tablet:{width:834,height:1112},mobile:{width:390,height:844}};
for (const [name,vp] of Object.entries(sizes)) {
  const ctx=await b.newContext({baseURL:"http://localhost:3000",viewport:vp});
  const login=await ctx.request.post("/api/auth/login",{data:{username:env.APP_USERNAME,password:env.APP_PASSWORD,next:"/"}});
  if(login.status()!==200){console.log("login failed",login.status());process.exit(1);}
  const p=await ctx.newPage();
  const errors=[]; p.on("pageerror",e=>errors.push(String(e).slice(0,160))); p.on("console",m=>{if(m.type()==="error")errors.push(m.text().slice(0,160));});
  await p.goto("/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(9000);
  await p.screenshot({path:resolve(OUT,`dashboard-${name}.png`)});
  if(name==="desktop"){
    const expand=p.getByRole("button",{name:/Open .* full screen/}).first();
    if(await expand.count()){ await expand.click(); await p.waitForTimeout(1500); await p.screenshot({path:resolve(OUT,"dashboard-focus.png")}); }
    await p.keyboard.press("Escape"); await p.waitForTimeout(800);
  }
  console.log(name, "errors:", errors.slice(0,4));
  await ctx.close();
}
await b.close();
