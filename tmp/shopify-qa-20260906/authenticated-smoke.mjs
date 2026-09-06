import fs from 'node:fs';
import crypto from 'node:crypto';
import { JSDOM, CookieJar } from 'jsdom';

const origin = 'https://teretret.myshopify.com';
const jar = new CookieJar();
const password = process.env.AOVBOOST_QA_STORE_PASSWORD;
if (!password) throw new Error('Set AOVBOOST_QA_STORE_PASSWORD for this run.');

async function request(label, path, options = {}) {
  let url = new URL(path, origin);
  let method = options.method || 'GET';
  let body = options.body;
  const started = Date.now();
  for (let hop = 0; hop < 8; hop++) {
    const headers = new Headers(options.headers || {});
    headers.set('Cookie', await jar.getCookieString(url.href));
    const response = await fetch(url, { method, body, headers, redirect:'manual', signal:AbortSignal.timeout(55000) });
    for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url.href);
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      const target = new URL(location, url);
      if (target.origin !== origin) throw new Error(`${label}: unexpected redirect outside the store to ${target.origin}`);
      url = target;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
      continue;
    }
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { /* HTML or JS response. */ }
    console.log(JSON.stringify({label,status:response.status,path:url.pathname,ms:Date.now()-started,contentType:response.headers.get('content-type'),keys:data ? Object.keys(data) : undefined,error:data?.error,failureBody:response.status>=400 ? text.slice(0,800) : undefined}));
    return {response,text,data,url};
  }
  throw new Error(`${label}: too many redirects`);
}

const jsonPost = body => ({method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
const loginPage = await request('password-form','/password');
const loginDom = new JSDOM(loginPage.text);
const form = [...loginDom.window.document.querySelectorAll('form')].find(form=>form.querySelector('input[type=password]'));
if (!form) throw new Error('Store password form not found');
const action = new URL(form.getAttribute('action') || '/password',origin);
if (action.origin !== origin) throw new Error('Unexpected password form destination');
const formData = new URLSearchParams();
for (const input of form.querySelectorAll('input[name]')) {
  if (input.type === 'hidden') formData.set(input.name,input.value);
  if (input.type === 'password') formData.set(input.name,password);
}
const unlocked = await request('password-unlock',action.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:formData.toString()});
loginDom.window.close();
delete process.env.AOVBOOST_QA_STORE_PASSWORD;
if (unlocked.url.pathname === '/password') throw new Error('Store remained password protected after login');

const home = await request('unlocked-home','/');
const homeDom = new JSDOM(home.text);
const embed = [...homeDom.window.document.scripts].find(script=>/window\.AOVBoost\s*=/.test(script.textContent));
const sdk = [...homeDom.window.document.scripts].find(script=>/aovboost-sdk\.js/.test(script.src));
const productLinks = [...new Set([...homeDom.window.document.querySelectorAll('a[href*="/products/"]')].map(link=>link.getAttribute('href')))];
console.log(JSON.stringify({label:'theme-embed',present:!!embed,sdkPresent:!!sdk,productLinks:productLinks.slice(0,5),configuration:embed?.textContent.trim().replace(/cartToken:\s*[^\n]+/,'cartToken: [redacted],')}));
if (sdk) {
  const sdkUrl = new URL(sdk.getAttribute('src'),origin);
  if (!['cdn.shopify.com','teretret.myshopify.com'].includes(sdkUrl.hostname)) throw new Error('Unexpected SDK asset host');
  const deployed = await request('deployed-sdk',sdkUrl.href);
  const local = fs.readFileSync(new URL('../../extensions/aovboost-storefront/assets/aovboost-sdk.js',import.meta.url),'utf8');
  const hash = text=>crypto.createHash('sha256').update(text).digest('hex');
  console.log(JSON.stringify({label:'sdk-comparison',deployedBytes:Buffer.byteLength(deployed.text),localBytes:Buffer.byteLength(local),matchesLocal:hash(deployed.text)===hash(local),deployedSha256:hash(deployed.text),localSha256:hash(local)}));
}
homeDom.window.close();
const session = await request('session-bootstrap','/apps/aovboost/session',{headers:{Accept:'application/json'}});
const auth = session.data?.sessionToken ? {shop:session.data.shop,sessionId:session.data.sessionId,sessionToken:session.data.sessionToken} : null;
if (auth) {
  console.log(JSON.stringify({label:'session-valid',shop:auth.shop,tokenIssued:true,settings:session.data.settings}));
  const config = await request('authenticated-config','/apps/aovboost/config',jsonPost(auth));
  console.log(JSON.stringify({label:'configuration',settings:config.data?.settings}));
} else {
  await request('proxy-chat-health','/apps/aovboost/chat',{headers:{Accept:'application/json'}});
  await request('proxy-offer-health','/apps/aovboost/offer',{headers:{Accept:'application/json'}});
  await request('proxy-config','/apps/aovboost/config',jsonPost({shop:'teretret.myshopify.com'}));
  console.log(JSON.stringify({label:'chat-offer-blocked',reason:'Shopify storefront session bootstrap failed; no signed session can be obtained.'}));
}
const cart = await request('initial-cart','/cart.js',{headers:{Accept:'application/json'}});
console.log(JSON.stringify({label:'cart-state',itemCount:cart.data?.item_count,currency:cart.data?.currency,total:cart.data?.total_price}));
const productPath = productLinks[0];
if (productPath) {
  const product = await request('product-page',productPath);
  const productDom = new JSDOM(product.text);
  console.log(JSON.stringify({label:'product-embed',title:productDom.window.document.title,hasAovBoost:[...productDom.window.document.scripts].some(script=>/window\.AOVBoost\s*=/.test(script.textContent))}));
  productDom.window.close();
}

if (process.argv.includes('--exercise')) {
  const product = await request('cart-test-product','/products/the-complete-snowboard.js',{headers:{Accept:'application/json'}});
  const variant = product.data?.variants?.find(variant=>variant.available);
  if (cart.data?.item_count !== 0 || !variant) throw new Error('Cart smoke test requires a fresh empty test cart and an available variant');
  let added = false;
  try {
    const addition = await request('cart-add-variant','/cart/add.js',jsonPost({items:[{id:variant.id,quantity:1}]}));
    added = addition.response.ok;
    if (!added) throw new Error('Cart addition failed');
    const afterAdd = await request('cart-after-add','/cart.js',{headers:{Accept:'application/json'}});
    console.log(JSON.stringify({label:'cart-add-verified',pass:afterAdd.data?.item_count===1 && afterAdd.data?.items?.[0]?.variant_id===variant.id,currency:afterAdd.data?.currency,total:afterAdd.data?.total_price,title:afterAdd.data?.items?.[0]?.product_title,variant:afterAdd.data?.items?.[0]?.variant_title}));
    const change = await request('cart-change-quantity','/cart/change.js',jsonPost({id:String(variant.id),quantity:2}));
    console.log(JSON.stringify({label:'cart-quantity-verified',pass:change.data?.item_count===2 && change.data?.total_price===variant.price*2,itemCount:change.data?.item_count,total:change.data?.total_price}));
  } finally {
    if (added) {
      const removed = await request('cart-remove-test-item','/cart/change.js',jsonPost({id:String(variant.id),quantity:0}));
      console.log(JSON.stringify({label:'cart-restored-empty',pass:removed.data?.item_count===0,itemCount:removed.data?.item_count}));
    }
  }
}

if (!auth) process.exitCode = 1;
