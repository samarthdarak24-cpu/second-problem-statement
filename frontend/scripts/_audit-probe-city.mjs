/**
 * AUDIT PROBE — what actually happens when the city selector changes?
 * Pure observation. Changes nothing in the repo.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('response', (r) => {
  const u = r.url();
  if (/open-meteo|api\//i.test(u)) logs.push(`[net ${r.status()}] ${u.slice(0, 160)}`);
});

await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const before = await page.evaluate(() => {
  const sels = Array.from(document.querySelectorAll('select'));
  return {
    selectCount: sels.length,
    labels: sels.map((s) => s.getAttribute('aria-label') || '(none)'),
    cityValue: (sels.find((s) => s.getAttribute('aria-label') === 'City') || {}).value,
    cityOptionCount: (sels.find((s) => s.getAttribute('aria-label') === 'City') || { options: [] }).options.length,
    bodyHead: document.body.innerText.slice(0, 400),
  };
});
console.log('--- BEFORE ---');
console.log(JSON.stringify(before, null, 2));

/* Now switch to Leh the same way the audit did, and watch. */
const sel = await page.evaluate(() => {
  const s = Array.from(document.querySelectorAll('select')).find(
    (x) => x.getAttribute('aria-label') === 'City',
  );
  if (!s) return 'NO CITY SELECT';
  const opt = Array.from(s.options).find((o) => /Leh/i.test(o.textContent || ''));
  if (!opt) return 'NO LEH OPTION';
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  ).set;
  setter.call(s, opt.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return `set to ${opt.textContent} (value=${opt.value})`;
});
console.log('--- SWITCH ---');
console.log(sel);

for (const t of [2000, 5000, 10000, 15000]) {
  await page.waitForTimeout(t === 2000 ? 2000 : t - (t === 5000 ? 2000 : t === 10000 ? 5000 : 10000));
  const snap = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      pip: txt.match(/\d+\s*\/\s*100/)?.[0] || null,
      comfort: txt.match(/\d+%\s*of the year/)?.[0] || null,
      verdict: (txt.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\.|Both seasons[^.]*\.|Partially[^.]*\./) || [])[0] || null,
      generating: /Generating|Running|\bWorking\b/i.test(txt),
      firstLine: txt.split('\n').slice(0, 6).join(' | '),
    };
  });
  console.log(`t=${t}ms`, JSON.stringify(snap));
}

console.log('--- CONSOLE / NET ---');
console.log(logs.slice(0, 40).join('\n') || '(none)');

await browser.close();
