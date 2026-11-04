import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const dir='docs/live-store-audit-2026-11-02';
await mkdir(dir,{recursive:true});
const source=await readFile('app/models/catalogCache.server.ts','utf8');
const template=source.match(/>\(Prisma\.sql`([\s\S]*?)`\);/)[1];
const buildQuery=new Function('Prisma','shop','return Prisma.sql`'+template+'`;');
const db=new PrismaClient({log:[]});
try {
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
  const rows=[];
  for (const shop of ['newsliderapp.myshopify.com','teretret.myshopify.com','app-review-76f8b2af-r91212-a0-primary.myshopify.com']) {
   const counts=await tx.$queryRaw(buildQuery(Prisma,shop));
   const [metadata]=await tx.$queryRaw(Prisma.sql`SELECT count(*)::int total, count(*) FILTER (WHERE jsonb_typeof(metafields->'aovboost.variants')='array')::int "withVariantArrays", count(*) FILTER (WHERE COALESCE(metafields#>>'{aovboost.onlineStorePublished,value}',metafields->>'aovboost.onlineStorePublished')='false')::int "unpublishedFlag", count(*) FILTER (WHERE COALESCE(metafields#>>'{aovboost.variantsTruncated,value}',metafields->>'aovboost.variantsTruncated')='true')::int "truncatedVariants" FROM "Product" WHERE shop=${shop}`);
   rows.push({shop,counts,metadata});
  }
  return {recordedAt:new Date().toISOString(),rows};
 },{timeout:25000});
 await writeFile(dir+'/catalog-readiness.json',JSON.stringify(result,null,2));
 console.log('CATALOG_READINESS '+JSON.stringify(result));
} finally {await db.$disconnect();}
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const checks=[];
for (const item of [{url:'https://newsliderapp.myshopify.com/',name:'storefront-access-gate'},{url:'https://ai-agent-dusky-nine.vercel.app/',name:'app-public-entry'}]) {
 try {
  const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(2000);
  const state=await page.evaluate(()=>({url:location.origin+location.pathname,title:document.title,bodyText:document.body.innerText.slice(0,1800),sdkReady:!!window.AOVBoostSDK}));
  await page.screenshot({path:dir+'/'+item.name+'.png',fullPage:true});
  checks.push({...item,status:response?.status(),...state});
 } catch(e) {checks.push({...item,error:e.message.slice(0,300)});}
}
const session=await context.request.get('https://ai-agent-dusky-nine.vercel.app/api/session');
checks.push({name:'unsigned-session-denied',status:session.status(),body:(await session.text()).slice(0,200)});
await writeFile(dir+'/public-browser-checks.json',JSON.stringify({recordedAt:new Date().toISOString(),checks},null,2));
console.log('PUBLIC_BROWSER_CHECKS '+JSON.stringify(checks));
await browser.close();