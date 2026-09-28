import { chromium } from 'playwright';

const BASE = 'http://localhost:4123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const cases = [
  ['/dashboard/fingerprint/', '/dashboard/climate/'],
  ['/dashboard/model/', '/dashboard/method/'],
];

for (const [from, expect] of cases) {
  await page.goto(BASE + from, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const url = page.url().replace(BASE, '');
  const ok = url.indexOf(expect) === 0;
  const h1 = await page.locator('h1').first().innerText().catch(() => '(none)');
  console.log(from, '->', url, ok ? 'OK' : 'MISMATCH', '| h1:', h1.trim());
}

await browser.close();
