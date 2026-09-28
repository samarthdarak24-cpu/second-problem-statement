/**
 * AUDIT PROBE 4 — §31 invariant, manually driving a REAL parameter.
 *
 * IMPORTANT LESSON FROM PROBE 3: moving "Budget" changing nothing is NOT a
 * state bug — a budget is analysed, not built. This probe moves Insulation
 * (an envelope sweep that genuinely changes U-value) and clicks Apply/Generate.
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
    return {
      weak: (t.match(/[A-Za-z]+ is the weakest point in the fabric, conducting [\d.]+ kWh\/day/) || [])[0] || null,
      verdict: (t.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./) || [])[0] || null,
      u: (t.match(/U-value[^\n]{0,40}/) || [])[0] || null,
      raw: t.replace(/\s+/g, ' ').slice(0, 1200),
    };
  });
}

await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(7000);
const A = await readThermal();
console.log('BASELINE weak  :', A.weak);
console.log('BASELINE u     :', A.u);

await page.goto(BASE + '/dashboard/design/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

/* switch to manual */
await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll('[role="tab"], button')).find(
    (b) => /^Manual$/i.test((b.textContent || '').trim()),
  );
  if (tab) tab.click();
});
await page.waitForTimeout(5000);

/* list every CONTROL (button + select + slider) so we know what "Insulation" is */
const controls = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, select, input').forEach((el) => {
    const label =
      el.getAttribute('aria-label') ||
      el.closest('[data-field], .field-row, label')?.innerText?.split('\n')[0] ||
      (el.textContent || '').trim().slice(0, 40);
    const t = el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : '');
    if (!label) return;
    out.push(`${t} :: ${label.replace(/\s+/g, ' ').slice(0, 70)}`);
  });
  return [...new Set(out)];
});
console.log('\nCONTROLS IN STUDIO:');
controls.forEach((c) => console.log('  ', c));

/* Find the insulation control and change it */
const insul = await page.evaluate(() => {
  // a select or a segmented button group whose accessible name mentions insulation
  const sels = Array.from(document.querySelectorAll('select'));
  for (const s of sels) {
    const name = (s.getAttribute('aria-label') || s.closest('div')?.previousElementSibling?.textContent || '');
    if (/insulation/i.test(name)) {
      const before = s.value;
      const idx = Math.min(s.options.length - 1, Array.from(s.options).findIndex((o) => o.value === before) + 1);
      const opt = s.options[idx < 0 ? s.options.length - 1 : idx];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(s, opt.value);
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return { kind: 'select', name, before, after: opt.value, text: opt.textContent };
    }
  }
  // segmented control: buttons inside a group labelled Insulation
  const groups = Array.from(document.querySelectorAll('[role="radiogroup"], fieldset, div'));
  for (const g of groups) {
    const head = (g.querySelector('legend, p, span, h3, h4')?.textContent || '');
    if (!/insulation/i.test(head)) continue;
    const btns = Array.from(g.querySelectorAll('button'));
    if (btns.length < 2) continue;
    const target = btns[btns.length - 1];
    target.click();
    return { kind: 'segmented', name: head.slice(0, 60), clicked: (target.textContent || '').trim() };
  }
  return null;
});
console.log('\nINSULATION CONTROL:', JSON.stringify(insul));
await page.waitForTimeout(7000);

/* Explicitly re-run if a Generate button exists and is enabled */
const gen = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /Generate|Apply|Re-run/i.test(x.textContent || ''));
  if (!b) return 'no button';
  if (b.disabled) return 'disabled';
  b.click();
  return `clicked "${(b.textContent || '').trim()}"`;
});
console.log('RE-RUN        :', gen);
await page.waitForTimeout(9000);

await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(5000);
const B = await readThermal();
console.log('\nAFTER weak     :', B.weak);
console.log('AFTER u        :', B.u);

await page.goto(BASE + '/dashboard/materials/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="thermal-condition"]').first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(5000);
const C = await readThermal();
console.log('TRIP  weak     :', C.weak);

console.log('\n=== VERDICT ===');
console.log('changed after insulation change? ', A.raw !== B.raw ? 'YES' : 'NO');
console.log('persisted across nav?            ', B.raw === C.raw ? 'YES' : 'NO');
console.log('errors:', errs.slice(0, 3));
await browser.close();
