/**
 * AUDIT PROBE 3 — §31 invariant on the MANUAL path (reevaluateManual),
 * which is the path the invariant actually governs.
 * Observation only.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });

const errs = [];
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) errs.push(String(e).slice(0, 200)); });

async function readThermal() {
  return page.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="thermal-condition"]');
    const t = s ? s.innerText : document.body.innerText;
    const num = (re) => (t.match(re) || [])[0] || null;
    return {
      weak: num(/[A-Za-z]+ is the weakest point in the fabric, conducting [\d.]+ kWh\/day/),
      verdict: num(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./),
      full: t.replace(/\s+/g, ' ').slice(0, 300),
    };
  });
}

/* --- baseline: load and let it settle --- */
await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(7000);
const A = await readThermal();
console.log('BASELINE   :', A.weak, '||', A.verdict);

/* --- go to the studio, switch to MANUAL, move a real envelope slider --- */
await page.goto(BASE + '/dashboard/design/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const mode = await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll('[role="tab"], button')).find(
    (b) => /^Manual$/i.test((b.textContent || '').trim()),
  );
  if (tab) { tab.click(); return 'clicked Manual'; }
  return 'Manual control not found';
});
console.log('MODE       :', mode);
await page.waitForTimeout(4000);

const moved = await page.evaluate(() => {
  const ranges = Array.from(document.querySelectorAll('input[type="range"]'));
  const info = ranges.map((r) => ({
    label: r.getAttribute('aria-label') || r.id || 'unnamed',
    min: r.min, max: r.max, value: r.value, step: r.step,
  }));
  // pick the widest-span slider that is not hour/month/day
  const bad = /hour|month|day/i;
  const cands = ranges
    .map((r) => ({ r, span: parseFloat(r.max) - parseFloat(r.min) }))
    .filter(({ r, span }) => span > 0 && !bad.test(r.getAttribute('aria-label') || ''));
  if (!cands.length) return { ok: false, all: info };
  cands.sort((a, b) => b.span - a.span);
  const { r } = cands[0];
  const label = r.getAttribute('aria-label') || 'unnamed';
  const before = r.value;
  const min = parseFloat(r.min), max = parseFloat(r.max), step = parseFloat(r.step) || 0.1;
  const next = Math.min(max, parseFloat(before) + (max - min) * 0.35);
  const snapped = Math.round(next / step) * step;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(r, String(snapped));
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, label, before, after: String(snapped), all: info };
});
console.log('MOVED      :', JSON.stringify(moved));

await page.waitForTimeout(6000);

/* --- back to analysis, read again --- */
await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(4000);
const B = await readThermal();
console.log('AFTER MOVE :', B.weak, '||', B.verdict);

/* --- round trip --- */
await page.goto(BASE + '/dashboard/materials/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(4000);
const C = await readThermal();
console.log('ROUND TRIP :', C.weak, '||', C.verdict);

console.log('\n--- VERDICT ---');
console.log('changed after slider? ', A.full !== B.full, A.full !== B.full ? 'YES' : 'NO');
console.log('persisted across nav? ', B.full === C.full, B.full === C.full ? 'YES' : 'NO');
console.log('errors:', errs.slice(0, 3));

await browser.close();
