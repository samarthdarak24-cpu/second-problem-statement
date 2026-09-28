/**
 * UI baseline / after capture for the "make UI better and visual" pass.
 *
 * Read-only: it loads each route, waits for the pipeline to settle, captures
 * a viewport screenshot and reports console/page errors plus overflow.
 *
 *   node scripts/_ui-baseline.mjs before
 *   node scripts/_ui-baseline.mjs after
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://localhost:3000';
const TAG = process.argv[2] || 'shot';
const DIR = `.shots/ui-${TAG}`;
mkdirSync(DIR, { recursive: true });

const ROUTES = [
  ['dashboard', '/dashboard/'],
  ['analysis', '/dashboard/analysis/'],
  ['design', '/dashboard/design/'],
  ['climate', '/dashboard/climate/'],
  ['optimization', '/dashboard/optimization/'],
  ['scenarios', '/dashboard/scenarios/'],
  ['materials', '/dashboard/materials/'],
  ['brief', '/dashboard/brief/'],
  ['method', '/dashboard/method/'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 2,
});

const errors = [];
page.on('pageerror', (e) => {
  const t = String(e);
  if (/defaultProps will be removed/i.test(t)) return;
  errors.push(t);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|ERR_CONNECTION_REFUSED|net::|429/i.test(t)) return;
  if (/defaultProps will be removed/i.test(t)) return;
  errors.push(t);
});

for (const [name, path] of ROUTES) {
  errors.length = 0;
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90000 });
  // The pipeline boots in the shell; give it room to finish.
  await page.waitForTimeout(4500);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const height = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log(
    `${name.padEnd(14)} ${String(Date.now() - t0).padStart(6)}ms  overflow=${overflow}px  height=${height}px  errors=${errors.length}${
      errors.length ? ` :: ${errors[0].slice(0, 120)}` : ''
    }`,
  );
}

await browser.close();
console.log(`\nshots -> ${DIR}`);
