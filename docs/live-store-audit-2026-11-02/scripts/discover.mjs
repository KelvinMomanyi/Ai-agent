import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const stores = [
  'teretret.myshopify.com',
  'newsliderapp.myshopify.com',
  'quickstart-f2795ad8.myshopify.com',
  'daniel-store-wh0b7w15.myshopify.com',
  'gilded-lily-jewelry.myshopify.com',
  'gloria-ck6dmnrc.myshopify.com',
  'willardltd.myshopify.com',
];
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
const local = await readFile('extensions/aovboost-storefront/assets/aovboost-sdk.js');
const localHash = createHash('sha256').update(local).digest('hex');
const results = [];
for (const store of stores) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const appRequests = [];
  const sdkAssets = [];
  const errors = [];
  const pending = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.includes('/apps/aovboost')) {
      appRequests.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
    if (/aovboost-sdk\.js/i.test(url.pathname)) {
      pending.push(response.body().then(buffer => sdkAssets.push({ url: url.origin + url.pathname, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), matchesLocal: createHash('sha256').update(buffer).digest('hex') === localHash })).catch(() => {}));
    }
  });
  page.on('pageerror', e => errors.push(e.message.slice(0, 300)));
  const started = Date.now();
  let result;
  try {
    const response = await page.goto('https://' + store, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(5000);
    const state = await page.evaluate(() => ({
      title: document.title,
      url: location.origin + location.pathname,
      bodySnippet: document.body.innerText.slice(0, 650),
      passwordForm: !!document.querySelector('form[action*="password"]'),
      shop: window.Shopify?.shop,
      aovConfig: window.AOVBoost ? {shop: window.AOVBoost.shop, apiBase: window.AOVBoost.apiBase, currencyCode: window.AOVBoost.currencyCode, settings: window.AOVBoost.settings} : null,
      sdkReady: !!window.AOVBoostSDK,
      productLinks: [...new Set([...document.querySelectorAll('a[href*="/products/"]')].map(a => new URL(a.href).origin + new URL(a.href).pathname))].slice(0, 4),
      collectionLinks: [...new Set([...document.querySelectorAll('a[href*="/collections/"]')].map(a => new URL(a.href).origin + new URL(a.href).pathname))].slice(0, 3),
    }));
    await Promise.allSettled(pending);
    result = { store, status: response?.status(), elapsedMs: Date.now()-started, ...state, appRequests, sdkAssets, errors };
  } catch (e) {
    result = { store, url: page.url(), elapsedMs: Date.now()-started, error: e.message.slice(0, 350), appRequests, sdkAssets, errors };
  }
  results.push(result);
  console.log(JSON.stringify(result));
  await context.close();
}
await browser.close();
await mkdir('tmp/live-store-audit/results', { recursive: true });
await writeFile('tmp/live-store-audit/results/discovery.json', JSON.stringify({ recordedAt: new Date().toISOString(), localSdkSha256: localHash, results }, null, 2));
