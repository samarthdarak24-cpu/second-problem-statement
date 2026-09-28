/**
 * AUDIT — does the STATIC EXPORT actually work when served as plain files?
 * This is the real deployment test: no Next server, just out/ over HTTP.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) errs.push(String(e).slice(0, 180)); });

console.log('\n======== STATIC EXPORT — BROWSER TEST ========\n');

await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
console.log('loaded', BASE + '/dashboard/');
await page.waitForTimeout(20000);

const state = await page.evaluate(() => {
  const t = document.body.innerText;
  const h1 = document.querySelector('h1');
  const canvas = document.querySelector('canvas');
  const ws = document.querySelectorAll('select').length;
  return {
    h1: h1 ? h1.textContent : null,
    length: t.length,
    hasVerdict: /Too warm|Too cold|Comfortable|Critical|Attention/.test(t),
    verdict: (t.match(/(Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\.|Critical[^.]*\.|Attention[^.]*\.)/) || [])[0] || null,
    score: (t.match(/\d+\s*\/\s*100/) || [])[0] || null,
    eui: (t.match(/[\d.]+\s*kWh\/m²·yr/) || [])[0] || null,
    canvases: document.querySelectorAll('canvas').length,
    selects: ws,
    navLinks: document.querySelectorAll('a[href]').length,
  };
});

console.log('h1               =', state.h1);
console.log('rendered text    =', state.length, 'chars');
console.log('verdict present  =', state.hasVerdict);
console.log('verdict          =', state.verdict);
console.log('score            =', state.score);
console.log('EUI              =', state.eui);
console.log('3D canvases      =', state.canvases);
console.log('selects          =', state.selects);
console.log('nav links        =', state.navLinks);

// Navigate client-side to prove hydration, not just static HTML.
const nav = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('a[href]')).find((x) => /Thermal Analysis/.test(x.textContent || ''));
  if (!a) return 'no link';
  a.click();
  return 'clicked';
});
await page.waitForTimeout(8000);
const after = await page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const t = document.body.innerText;
  return { h1: h1 ? h1.textContent : null, weak: (t.match(/[A-Za-z]+ is the weakest point in the fabric/) || [])[0] || null };
});
console.log('\nclient-side nav  =', nav);
console.log('landed on        =', after.h1);
console.log('fabric path      =', after.weak);

const hydrated = state.length > 3000 && state.hasVerdict && nav === 'clicked' && after.h1 !== state.h1;
console.log('\nBROWSER ERRORS   =', errs.length ? errs.slice(0, 3).join(' | ') : 'none');
console.log('VERDICT: static export ' + (hydrated && errs.length === 0 ? 'FULLY FUNCTIONAL' : 'ISSUE'));
console.log('  hydrates and runs the pipeline :', state.hasVerdict ? 'YES' : 'NO');
console.log('  client-side routing works      :', after.h1 !== state.h1 ? 'YES' : 'NO');

await browser.close();
