/**
 * QA: Thermal Analysis must read as
 *   verdict -> dominant heat path -> one visualisation -> tabs -> interpretation -> next action
 *
 * The page is client-hydrated, so a fetch of the HTML would show the empty
 * shell. This drives a real browser and waits for the derived reading band.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:3313';
const ROUTE = '/dashboard/analysis/';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', (e) => {
  const t = String(e);
  // Recharts 2.x emits defaultProps deprecation warnings through React;
  // they are library-owned, not page defects.
  if (/defaultProps will be removed/i.test(t)) return;
  errors.push(t);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Ignore network noise (map tiles, favicons, dev-server HMR probes) —
  // this check is about the page's own JavaScript, not resource loading.
  if (/Failed to load resource|ERR_CONNECTION_REFUSED|net::/i.test(t)) return;
  if (/429|Too Many Requests/i.test(t)) return;
  // React logs recharts' defaultProps warning as a console error too.
  if (/defaultProps will be removed/i.test(t)) return;
  errors.push(t);
});

await page.goto(BASE + ROUTE, { waitUntil: 'load' });
// Wait for hydration: the verdict band only exists once the store has data.
await page
  .locator('text=Thermal condition')
  .first()
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1200);

/* 1. The interpretation band exists and carries a real verdict.
   It is a labelled <section>, NOT a role="status" live region — a live
   region would re-announce the whole paragraph on every re-render. */
const band = page.locator('section[aria-labelledby="thermal-condition"]').first();
const bandVisible = await band.isVisible().catch(() => false);
check('Thermal condition band renders', bandVisible);

let verdict = '';
if (bandVisible) {
  const t = await band.locator('p.font-display').first().innerText().catch(() => '');
  verdict = t.trim();
}
check(
  'Verdict is a full sentence, not a placeholder',
  verdict.length > 20 && /[.!]$/.test(verdict),
  verdict,
);

/* 1b. The verdict is encoded with a word + icon, not colour alone. */
const chipText = bandVisible
  ? await band.locator('.chip').first().innerText().catch(() => '')
  : '';
const chipHasIcon = bandVisible
  ? (await band.locator('.chip svg').count()) > 0
  : false;
check(
  'Verdict status is non-colour encoded (word + icon)',
  /within band|attention|critical/i.test(chipText) && chipHasIcon,
  `${chipText.trim()} · icon:${chipHasIcon}`,
);

/* 2. The dominant heat path is named, with a number beside it. */
const body = bandVisible ? await band.innerText() : '';
const namesFamily = /(roof|wall|floor|window|door)\b/i.test(body) && /fabric/i.test(body);
const hasFigure = /\d+(\.\d+)?\s*kWh\/day/i.test(body);
check(
  'Dominant path is named',
  namesFamily,
  (body.match(/(roof|wall|floor|window|door)\b/i) || [])[0] || 'none',
);
check('Dominant path carries a kWh/day figure', hasFigure);

/* 3. The four supporting metrics are inline metrics, not cards. */
const dlCount = bandVisible ? await band.locator('dl dd').count() : 0;
check('Four supporting inline metrics', dlCount === 4, `found ${dlCount}`);

/* 4. Order on the page: verdict band comes BEFORE the heat-balance bars. */
const order = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('p, h2, h3'));
  const idx = (re) => all.findIndex((el) => re.test(el.textContent || ''));
  return {
    condition: idx(/Thermal condition/i),
    balance: idx(/Where the heat comes from/i),
    monthly: idx(/The year, month by month/i),
    readout: idx(/Comfort, energy, cost and how/i),
  };
});
check(
  'Hierarchy order: condition -> heat balance -> monthly -> read-out',
  order.condition > -1 &&
    order.condition < order.balance &&
    order.balance < order.monthly &&
    order.monthly < order.readout,
  JSON.stringify(order),
);

/* 5. Exactly one <h1> on the page (the shell owns it). */
const h1s = await page.locator('h1').count();
check('Exactly one <h1>', h1s === 1, `found ${h1s}`);

/* 6. The one clear visualization: monthly chart region has real height. */
const chartBox = await page
  .locator('div.h-\\[620px\\]')
  .first()
  .boundingBox()
  .catch(() => null);
check(
  'Monthly visualisation occupies a large plot area',
  !!chartBox && chartBox.height >= 600,
  chartBox ? `${Math.round(chartBox.width)}x${Math.round(chartBox.height)}` : 'missing',
);

/* 7. A next action is reachable from the header.
   NOTE: `trailingSlash: true` in next.config means the rendered hrefs end
   in "/", so match on the path prefix rather than an exact string. */
const nextAction = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href]')).filter((a) => {
    const h = a.getAttribute('href') || '';
    return h.startsWith('/dashboard/design') || h.startsWith('/dashboard/optimization');
  }).length,
);
check('Next action links present in header', nextAction >= 2, `${nextAction} links`);

/* 8. No horizontal overflow at 1440. */
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check('No horizontal overflow at 1440', overflow <= 0, `${overflow}px`);

/* 9. No runtime errors. */
check('No console/page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: '.shots/analysis-hierarchy.png', fullPage: false });
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
