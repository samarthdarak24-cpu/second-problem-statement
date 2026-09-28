/**
 * Capture the CURRENT UI of every route, at desktop width, into
 * .shots/ui-current/. Full-page plus a viewport-height "fold" shot, because
 * the fold is what a user actually sees first.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE ?? 'http://localhost:4173';
const OUT = path.resolve('.shots/ui-current');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['/', 'landing'],
  ['/login/', 'login'],
  ['/dashboard/', 'dashboard'],
  ['/dashboard/design/', 'design'],
  ['/dashboard/analysis/', 'analysis'],
  ['/dashboard/climate/', 'climate'],
  ['/dashboard/brief/', 'brief'],
  ['/dashboard/materials/', 'materials'],
  ['/dashboard/scenarios/', 'scenarios'],
  ['/dashboard/optimization/', 'optimization'],
  ['/dashboard/method/', 'method'],
  ['/dashboard/settings/', 'settings'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

for (const [route, label] of ROUTES) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${label}-fold.png`) });
    await page.screenshot({ path: path.join(OUT, `${label}-full.png`), fullPage: true });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`✓ ${label.padEnd(14)} h=${h}px`);
  } catch (e) {
    console.log(`✗ ${label.padEnd(14)} ${String(e).slice(0, 120)}`);
  }
}

if (errors.length) {
  console.log('\n--- console errors ---');
  console.log([...new Set(errors)].slice(0, 20).join('\n'));
} else {
  console.log('\nno console errors');
}

await browser.close();
