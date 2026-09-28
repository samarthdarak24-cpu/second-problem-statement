/**
 * AUDIT PROBE 2 — site change flow, with and without live lookups.
 * Observation only.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const net = [];
page.on('response', (r) => {
  const u = r.url();
  if (/open-meteo|archive-api/i.test(u)) net.push(`${r.status()} ${u.slice(0, 120)}`);
});
page.on('requestfailed', (r) => {
  if (/open-meteo|archive-api/i.test(r.url())) net.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(0, 110)}`);
});
page.on('pageerror', (e) => {
  console.log('[pageerror]', String(e).slice(0, 300));
});

async function pickCity(city) {
  return page.evaluate((c) => {
    const s = Array.from(document.querySelectorAll('select')).find(
      (x) => x.getAttribute('aria-label') === 'City',
    );
    if (!s) return 'NO SELECT';
    const opt = Array.from(s.options).find((o) => new RegExp(c, 'i').test(o.textContent || ''));
    if (!opt) return 'NO OPTION';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, opt.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.textContent;
  }, city);
}

async function readOut() {
  return page.evaluate(() => {
    const t = document.body.innerText;
    return {
      status: (t.match(/Site set to [^\n]*|Running the design pipeline…|[A-Za-z]+…\n/) || [])[0] || null,
      pip: t.match(/\d+\s*\/\s*100/)?.[0] || null,
      comfort: t.match(/\d+%\s*of the year/)?.[0] || null,
      verdict: (t.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./) || [])[0] || null,
      generating: /Generating/.test(t),
      idle: /Idle/.test(t),
      emptyHint: /Generate to analyse|No site|not yet/i.test(t),
    };
  });
}

/* ================= PASS 1: preferLive ON (default) ================= */
console.log('\n=========== PREFER LIVE: ON (default) ===========');
await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
await page.waitForTimeout(12000);
console.log('baseline', JSON.stringify(await readOut()));

console.log('switching to Leh →', await pickCity('Leh'));
for (const t of [3000, 6000, 12000, 20000, 30000, 45000]) {
  await page.waitForTimeout(t === 3000 ? 3000 : 3000);
  console.log(`  t+${t}ms`, JSON.stringify(await readOut()));
}
console.log('net:', net.slice(0, 8).join('\n       ') || '(none)');

/* ================= PASS 2: preferLive OFF ================= */
console.log('\n=========== PREFER LIVE: OFF ===========');
net.length = 0;
await page.goto(BASE + '/dashboard/settings/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const toggled = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
  const found = inputs.map((i) => ({
    label: (i.closest('label')?.innerText || i.getAttribute('aria-label') || '').slice(0, 60),
    checked: i.checked,
  }));
  return found;
});
console.log('checkboxes on settings:', JSON.stringify(toggled));

await browser.close();
