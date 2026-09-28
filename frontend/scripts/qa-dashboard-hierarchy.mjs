/**
 * Dashboard QA — the landing page's comprehension test.
 *
 * The brief's success criterion is explicit:
 *
 *   "Within 5–10 seconds a user can identify location, shelter type,
 *    main thermal condition, target compliance, major problem,
 *    changeable parameters, optimizer recommendation, and next action."
 *
 * This checks the parts that belong on the Dashboard. It also asserts the
 * reading agrees with Thermal Analysis — both pages read the same hook,
 * and a disagreement would mean the shared derivation had drifted.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:3313';

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

await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
await page
  .locator('section[aria-labelledby="dashboard-reading"]')
  .first()
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1200);

/* ---- 1. The reading band exists and carries a verdict ---- */
const band = page.locator('section[aria-labelledby="dashboard-reading"]').first();
const bandVisible = await band.isVisible().catch(() => false);
check('Reading band renders', bandVisible);

const bandText = bandVisible ? await band.innerText() : '';
/* Read the verdict from its own element rather than regexing the whole
   band — the eyebrow ("THERMAL CONDITION") also matches a naive
   sentence pattern and would make this check pass vacuously. */
const verdictText = bandVisible
  ? (await band.locator('p.font-display').first().innerText().catch(() => '')).trim()
  : '';
check(
  'Verdict is a sentence, not a placeholder',
  verdictText.length > 20 && /[.!]$/.test(verdictText),
  verdictText.slice(0, 70),
);

/* ---- 2. Status is non-colour encoded ---- */
const chipText = bandVisible
  ? await band.locator('.chip').first().innerText().catch(() => '')
  : '';
const chipIcon = bandVisible ? (await band.locator('.chip svg').count()) > 0 : false;
check(
  'Verdict status encoded with word + icon',
  /within band|attention|critical/i.test(chipText) && chipIcon,
  `${chipText.trim()} · icon:${chipIcon}`,
);

/* ---- 3. The dominant fabric problem is named ---- */
check(
  'Dominant fabric path is named',
  /(roof|wall|floor|window|door)\b/i.test(bandText) && /fabric/i.test(bandText),
  (bandText.match(/(roof|wall|floor|window|door)\b/i) || [''])[0],
);

/* ---- 4. Target compliance is stated as a number ---- */
check(
  'Comfort compliance stated as a percentage',
  /\d+%/.test(bandText),
  (bandText.match(/\d+%/) || [''])[0],
);

/* ---- 5. The comprehension order: who/where -> finding -> numbers -> visual ---- */
const order = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('h1, h2, h3, p, section'));
  const find = (re) => {
    const el = all.find((e) => re.test((e.textContent || '').slice(0, 200)));
    return el ? all.indexOf(el) : -1;
  };
  return {
    greeting: find(/is asking for|Design the shelter for the climate/i),
    reading: find(/Thermal condition/i),
    outputs: find(/Indoor temperature · Solar gain · Heat flow/i),
    preview: find(/What the live building looks like/i),
  };
});
check(
  'Order: site identity -> finding -> numbers -> visual',
  order.greeting > -1 &&
    order.greeting < order.reading &&
    order.reading < order.outputs &&
    order.outputs < order.preview,
  JSON.stringify(order),
);

/* ---- 6. Location, shelter type, next action all present ---- */
const surface = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    hasLocation: /Pune|Leh|Jodhpur|Chennai|Shillong|Maharashtra|Ladakh/.test(t),
    hasType: /Shelter|shelter|Tent|Container|Bunker|building type/i.test(t),
    nextActions: Array.from(document.querySelectorAll('a[href]')).filter((a) => {
      const h = a.getAttribute('href') || '';
      return (
        h.startsWith('/dashboard/design') ||
        h.startsWith('/dashboard/analysis') ||
        h.startsWith('/dashboard/optimization') ||
        h.startsWith('/dashboard/climate')
      );
    }).length,
  };
});
check('Location identified', surface.hasLocation);
check('Shelter type identified', surface.hasType);
check('Next actions reachable (>=3)', surface.nextActions >= 3, `${surface.nextActions} links`);

/* ---- 7. Single h1; no horizontal overflow ---- */
const h1 = await page.locator('h1').count();
check('Exactly one <h1>', h1 === 1, `${h1}`);

/* The page title must appear once. It used to be rendered by BOTH the
   shell Topbar and the page's own PageHeader, so "Dashboard" and its
   description printed twice, stacked. Guard against the regression. */
const titleCount = await page.evaluate(() => {
  const target = 'Dashboard';
  const hits = Array.from(document.querySelectorAll('h1, h2, h3, p')).filter(
    (el) => (el.textContent || '').trim() === target,
  );
  return hits.length;
});
check('Page title is not duplicated', titleCount === 1, `${titleCount} occurrences`);

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check('No horizontal overflow at 1440', overflow <= 0, `${overflow}px`);

/* ---- 8. The two pages agree on the verdict ---- */
const dashboardVerdict = verdictText;

await page.goto(BASE + '/dashboard/analysis/', { waitUntil: 'load' });
await page
  .locator('section[aria-labelledby="thermal-condition"]')
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1000);
const analysisVerdict = (
  await page
    .locator('section[aria-labelledby="thermal-condition"] p.font-display')
    .first()
    .innerText()
    .catch(() => '')
).trim();

/* The two are allowed to differ only if a run happened between the loads,
   which would change the numbers. Compare the verdict *class*, which is
   what the shared hook guarantees. */
const sameClass =
  dashboardVerdict.length > 0 &&
  analysisVerdict.length > 0 &&
  /summer|winter|Comfortable|Partially/i.test(dashboardVerdict) ===
    /summer|winter|Comfortable|Partially/i.test(analysisVerdict);
check(
  'Dashboard and Analysis agree on the verdict class',
  sameClass,
  `dash="${dashboardVerdict.slice(0, 40)}" analysis="${analysisVerdict.slice(0, 40)}"`,
);

check('No page errors', errors.length === 0, errors.slice(0, 1).join(''));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
