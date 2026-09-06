const store = 'https://teretret.myshopify.com';
const app = 'https://ai-agent-plum-eight.vercel.app';
const profile = 'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';

async function request(label, url, options = {}) {
  const start = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch {}
    const summary = {
      label, status: response.status, url: response.url,
      contentType: response.headers.get('content-type'), durationMs: Date.now() - start,
      cacheControl: response.headers.get('cache-control'),
    };
    if (data) {
      summary.keys = Object.keys(data);
      if (data.error) summary.error = data.error;
      if (data.result?.tools) summary.tools = data.result.tools.map(tool => tool.name);
      if (data.sessionToken) summary.session = { shop: data.shop, tokenIssued: true, expiresAt: data.expiresAt, settings: data.settings };
    } else {
      summary.title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
      summary.passwordPage = new URL(response.url).pathname === '/password' || /id="login_form"|password-page|storefront_password|shopify-section-main-password/i.test(body);
      summary.hasAovBoostConfig = /window\.AOVBoost\s*=/.test(body);
      summary.sdkUrls = [...body.matchAll(/<script[^>]*src="([^"]*aovboost[^\"]*)"/gi)].map(match => match[1]);
    }
    console.log(JSON.stringify(summary));
    return { response, data, body };
  } catch (error) {
    console.log(JSON.stringify({label, error: error.message, cause: error.cause?.message, durationMs: Date.now()-start}));
    return {};
  }
}

const rpc = (method, params = {}) => ({method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});

const checks = await Promise.allSettled([
  request('storefront-live', store),
  request('storefront-dawn-preview', `${store}/?preview_theme_id=135840858177`),
  request('storefront-mcp', `${store}/api/mcp`, rpc('tools/list')),
  request('catalog-mcp', `${store}/api/ucp/mcp`, rpc('tools/list')),
  request('session-bootstrap', `${store}/apps/aovboost/session`, {headers:{Accept:'application/json'}}),
  request('app-health', `${app}/api/chat`),
  request('unsigned-direct-session-rejected', `${app}/api/session`),
]);
const session = checks[4].status === 'fulfilled' ? checks[4].value.data : undefined;
if (session?.sessionToken) {
  const body = JSON.stringify({shop:session.shop,sessionId:session.sessionId,sessionToken:session.sessionToken});
  const config = await request('signed-proxy-config', `${store}/apps/aovboost/config`, {method:'POST',headers:{'Content-Type':'application/json'},body});
  if (config.data?.settings) console.log(JSON.stringify({label:'public-settings', settings:config.data.settings}));
}
const catalogTools = checks[3].status === 'fulfilled' ? checks[3].value.data?.result?.tools : [];
const search = catalogTools?.find(tool => tool.name === 'search_catalog');
if (search) {
  const result = await request('catalog-search', `${store}/api/ucp/mcp`, rpc('tools/call',{name:search.name,arguments:{meta:{'ucp-agent':{profile}},catalog:{query:'snowboard',pagination:{limit:3}}}}));
  for (const content of result.data?.result?.content || []) {
    if (content.type !== 'text') continue;
    try {
      const data = JSON.parse(content.text);
      console.log(JSON.stringify({label:'catalog-search-result',status:data.ucp?.status,error:result.data?.result?.isError,products:data.products?.map(product=>({id:product.id,title:product.title,price:product.price_range,variants:product.variants?.length})),messages:data.messages}));
    } catch { console.log(JSON.stringify({label:'catalog-search-message',message:content.text.slice(0,1000)})); }
  }
}

const cookies = new Map();
let next = `${store}/apps/aovboost/session`;
for (let hop = 0; hop < 5; hop++) {
  const response = await fetch(next, {redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')}});
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const equals = pair.indexOf('=');
    cookies.set(pair.slice(0,equals),pair.slice(equals+1));
  }
  const location = response.headers.get('location');
  const target = location ? new URL(location,next) : undefined;
  console.log(JSON.stringify({label:'session-redirect-trace',hop,status:response.status,path:new URL(next).pathname,location:target ? `${target.origin}${target.pathname}` : null,contentType:response.headers.get('content-type')}));
  if (!target || target.origin !== store) break;
  next = target.href;
}
