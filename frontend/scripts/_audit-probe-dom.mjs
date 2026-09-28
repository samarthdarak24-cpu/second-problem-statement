/**
 * AUDIT PROBE 6 — why did the case-A probe see no verdict and no Programme button?
 * Dumps the real DOM structure of the studio and the analysis page.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) console.log('[pageerror]', String(e).slice(0, 300)); });

await page.goto(BASE + '/dashboard/design/', { waitUntil: 'load' });
await page.waitForTimeout(14000);

console.log('=== h1:', await page.evaluate(() => (document.querySelector('h1') || {}).textContent));

console.log('\n=== ALL BUTTONS (text, up to 46) ===');
const btns = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => ({
    text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 52),
    aria: b.getAttribute('aria-label'),
    expanded: b.getAttribute('aria-expanded'),
    pressed: b.getAttribute('aria-pressed'),
  })),
);
btns.forEach((b, i) => console.log(`  [${String(i).padStart(2)}] "${b.text}"${b.aria ? ` aria="${b.aria}"` : ''}${b.expanded !== null ? ` expanded=${b.expanded}` : ''}${b.pressed !== null ? ` pressed=${b.pressed}` : ''}`));

console.log('\n=== ALL SELECTS ===');
const sels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('select')).map((s) => ({
    aria: s.getAttribute('aria-label'),
    value: s.value,
    options: Array.from(s.options).map((o) => o.textContent.slice(0, 30)),
  })),
);
sels.forEach((s) => console.log(`  aria="${s.aria}" value="${s.value}" opts=[${s.options.slice(0, 8).join(' | ')}]`));

console.log('\n=== TEXT AROUND "Programme" / "Mission" / "Shelter" ===');
const ctx = await page.evaluate(() => {
  const t = document.body.innerText;
  const idx = [];
  for (const word of ['Programme', 'Mission', 'Shelter type', 'Envelope']) {
    const i = t.indexOf(word);
    if (i >= 0) idx.push(`${word} @ ${i}: ...${t.slice(Math.max(0, i - 60), i + 120).replace(/\n/g, ' / ')}`);
  }
  return idx;
});
ctx.forEach((c) => console.log('  ' + c));

/* Navigate client-side to analysis and dump the verdict band */
console.log('\n=== ANALYSIS PAGE (client-side nav) ===');
await page.evaluate(() => {
  const l = Array.from(document.querySelectorAll('a[href]')).find((a) => /Thermal Analysis/i.test(a.textContent || ''));
  if (l) l.click();
});
await page.waitForTimeout(9000);
const an = await page.evaluate(() => {
  const h1 = (document.querySelector('h1') || {}).textContent;
  const bands = Array.from(document.querySelectorAll('section[aria-labelledby]')).map((s) => ({
    id: s.getAttribute('aria-labelledby'),
    head: (s.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
  }));
  return { h1, bands, bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500) };
});
console.log('h1:', an.h1);
an.bands.forEach((b) => console.log(`  <section aria-labelledby="${b.id}">\n     ${b.head}\n`));
console.log('body head:', an.bodyHead);

await browser.close();
