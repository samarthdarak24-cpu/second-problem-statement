/**
 * AUDIT PROBE 5 — §31 invariant, driving the REAL envelope control.
 * Expand the "Envelope" parameter group, find the insulation control, change it.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errs = [];
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) errs.push(String(e).slice(0, 200)); });

async function readThermal() {
  return page.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="thermal-condition"]');
    const t = s ? s.innerText : document.body.innerText;
    return {
      weak: (t.match(/[A-Za-z]+ is the weakest point in the fabric, conducting [\d.]+ kWh\/day/) || [])[0] || null,
      verdict: (t.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./) || [])[0] || null,
      raw: t.replace(/\s+/g, ' '),
    };
  });
}

await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(8000);
const A = await readThermal();
console.log('BASELINE:', A.weak, '||', A.verdict);

await page.goto(BASE + '/dashboard/design/', { waitUntil: 'load' });
await page.waitForTimeout(7000);

/* manual mode */
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /^Manual$/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
await page.waitForTimeout(5000);

/* expand the Envelope group */
const opened = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((x) => /Envelope/i.test(x.textContent || ''));
  if (!btn) return 'no Envelope button';
  const was = btn.getAttribute('aria-expanded');
  btn.click();
  return `clicked Envelope (aria-expanded was ${was})`;
});
console.log('GROUP    :', opened);
await page.waitForTimeout(2500);

/* inventory what is now visible with its row label */
const rows = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, select, button').forEach((el) => {
    const label =
      el.getAttribute('aria-label') ||
      el.closest('label')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ||
      '';
    if (!label) return;
    if (el.tagName === 'BUTTON' && !/Low|Med|High|Roof|Wall|Flat|Gable|Shed|Hip|Vaulted|None|Overhang|Deep|Side|Full|Light|Heavy|Medium|Insulated|Double|Triple|Single/i.test(label)) return;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      label,
      value: el.value ?? '',
      min: el.min, max: el.max,
    });
  });
  return out;
});
console.log('ENVELOPE ROWS:');
rows.forEach((r) => console.log('   ', JSON.stringify(r)));

/* change an envelope control — prefer a select or a segmented group */
const changed = await page.evaluate(() => {
  const sels = Array.from(document.querySelectorAll('select')).filter(
    (s) => s.getAttribute('aria-label') !== 'Country' && s.getAttribute('aria-label') !== 'City',
  );
  for (const s of sels) {
    if (s.options.length < 2) continue;
    const i = s.selectedIndex;
    const next = s.options[(i + 1) % s.options.length];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, next.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { kind: 'select', label: s.getAttribute('aria-label'), before: s.options[i].textContent, after: next.textContent };
  }
  /* segmented: find a group of sibling buttons under an Envelope heading */
  const texts = ['Low', 'Med', 'High'];
  const btns = Array.from(document.querySelectorAll('button')).filter((b) => texts.includes((b.textContent || '').trim()));
  if (btns.length >= 3) {
    const b = btns[btns.length - 1];
    b.click();
    return { kind: 'segmented', label: 'Insulation level', clicked: (b.textContent || '').trim() };
  }
  return null;
});
console.log('CHANGED  :', JSON.stringify(changed));
await page.waitForTimeout(8000);

/* read the live in-page parameter summary if present */
const pageNow = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 700));
console.log('STUDIO NOW:', pageNow.slice(0, 400));

/* re-run */
const gen = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /Generate design/i.test(x.textContent || ''));
  if (!b) return 'no button';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked Generate design';
});
console.log('RE-RUN   :', gen);
await page.waitForTimeout(12000);

await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(5000);
const B = await readThermal();
console.log('\nAFTER    :', B.weak, '||', B.verdict);

await page.goto(BASE + '/dashboard/materials/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(5000);
const C = await readThermal();
console.log('TRIP     :', C.weak);

console.log('\n=== VERDICT ===');
console.log('result changed after envelope change?', A.raw !== B.raw ? 'YES' : 'NO');
console.log('persisted across navigation?        ', B.raw === C.raw ? 'YES' : 'NO');
console.log('errors:', errs.slice(0, 3));
await browser.close();
