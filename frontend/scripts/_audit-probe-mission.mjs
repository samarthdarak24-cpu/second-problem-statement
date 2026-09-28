/**
 * AUDIT PROBE 7 — locate the real mission control DOM and the sidebar links.
 */
import { chromium } from 'playwright';
const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.goto(BASE + '/dashboard/design/', { waitUntil: 'load' });
await page.waitForTimeout(14000);

/* open Mission group */
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /^Mission\d*$/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
await page.waitForTimeout(2500);

console.log('=== BUTTONS AFTER OPENING Mission GROUP ===');
const b2 = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => ({
    t: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    aria: b.getAttribute('aria-label'),
    role: b.getAttribute('role'),
  })),
);
b2.forEach((b, i) => console.log(`  [${String(i).padStart(2)}] "${b.t}"${b.aria ? ` aria="${b.aria}"` : ''}${b.role ? ` role=${b.role}` : ''}`));

console.log('\n=== SELECTS AFTER OPENING Mission ===');
const s2 = await page.evaluate(() =>
  Array.from(document.querySelectorAll('select')).map((s) => ({ aria: s.getAttribute('aria-label'), value: s.value })),
);
s2.forEach((s) => console.log(`  aria="${s.aria}" value="${s.value}"`));

console.log('\n=== ROLE=RADIO / TABLIST / OPTION ELEMENTS ===');
const r = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[role="radio"], [role="tab"], [role="option"], [role="listbox"]').forEach((el) => {
    out.push(`${el.getAttribute('role')} :: "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)}"`);
  });
  return out.slice(0, 40);
});
r.forEach((x) => console.log('  ' + x));

console.log('\n=== SIDEBAR LINKS (exact) ===');
const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href]')).map((a) => ({
    href: a.getAttribute('href'),
    text: (a.textContent || '').trim().replace(/\s+/g, ' '),
  })),
);
links.forEach((l) => console.log(`  ${l.href?.padEnd(26)} "${l.text.slice(0, 40)}"`));

await browser.close();
