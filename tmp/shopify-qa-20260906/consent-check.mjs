import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../../storefront-sdk/src/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('function hasTrackingConsent(');
const end = source.indexOf('if (document.readyState', start);
if (start < 0 || end < 0) throw new Error('Consent functions not found');
const code = ts.transpileModule(source.slice(start,end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for (const allowed of [false, true]) {
  const dom = new JSDOM('', {url:'https://example.test',runScripts:'outside-only'});
  dom.window.Shopify = {customerPrivacy:{analyticsProcessingAllowed:()=>allowed}};
  vm.runInContext(code, dom.getInternalVMContext());
  const config = {settings:{trackingConsentRequired:true}};
  let resumed = false;
  const waiting = dom.window.waitForTrackingConsent(config).then(()=>{resumed=true});
  dom.window.dispatchEvent(new dom.window.CustomEvent('visitorConsentCollected',{detail:{analyticsAllowed:allowed}}));
  await Promise.resolve();
  console.log(JSON.stringify({analyticsConsent:allowed,hasTrackingConsent:dom.window.hasTrackingConsent(config),sdkResumed:resumed,expectedSdkResumed:allowed,pass:resumed===allowed}));
  if (resumed) await waiting;
  dom.window.close();
}
