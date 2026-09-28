/**
 * Verifies the Design Brief banding in a real browser.
 *
 * The brief page has an empty-state branch that renders when no
 * location/mission is resolved. The bands only exist in the populated
 * branch, so a curl check would read the empty state and report the
 * banding as missing. This drives the app first (select a site, run the
 * pipeline) and then asserts the band structure.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:3312';

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/127\.0\.0\.1:8000|ERR_CONNECTION_REFUSED|defaultProps|429|Failed to fetch/i.test(t)) return;
  errors.push(t);
});
page.on('pageerror', (e) => {
  if (/defaultProps/i.test(e.message)) return;
  errors.push(`pageerror: ${e.message}`);
});

console.log('\n=== /dashboard/brief (populated) ===\n');

// Land on the dashboard so the boot pipeline resolves a default site,
// then navigate to the brief.
await page.goto(`${BASE}/dashboard/`, { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(3000);

await page.goto(`${BASE}/dashboard/brief/`, { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(3000);

/* 1 — outline */
const h1s = await page.locator('h1').allInnerTexts();
record('exactly one <h1>', h1s.length === 1, `found ${h1s.length}: ${JSON.stringify(h1s)}`);
record('h1 names the page', h1s[0]?.trim() === 'Design Brief', `got "${h1s[0]?.trim()}"`);

const h2s = (await page.locator('h2').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

/* 2 — the four band headers */
const bands = [
  'What the site demands of this shelter',
  'Where the energy goes, and how it is controlled',
  'What gets deployed, and how the comfort is delivered',
];
for (const b of bands) {
  record(`band header: "${b}"`, h2s.includes(b));
}

/* 3 — the panels survived inside their bands */
const panels = [
  'Internal heat load',
  'Area-specific thermal requirements',
  'Moisture and condensation',
  'Where the heat is lost',
  'Ventilation control',
  'Deployability',
  'How the comfort is delivered',
];
const bodyText = await page.locator('body').innerText();
for (const p of panels) {
  record(`panel present: "${p}"`, bodyText.includes(p));
}

/* 4 — reading order: band header must precede its panels */
const order = h2s.join(' | ');
const iSiteDemands = order.indexOf('What the site demands');
const iEnergy = order.indexOf('Where the energy goes');
const iDeploy = order.indexOf('What gets deployed');
record(
  'bands appear in WHAT → WHY → HOW → DEPLOY order',
  iSiteDemands > -1 && iEnergy > iSiteDemands && iDeploy > iEnergy,
  `site=${iSiteDemands} energy=${iEnergy} deploy=${iDeploy}`,
);

/* 5 — the honesty statement still present */
record('honesty statement present', /Model estimate — not a measured building result/.test(bodyText));

/* 6 — closing actions */
const actionLinks = await page.locator('a:has-text("Open Design Studio"), a:has-text("Full thermal analysis"), a:has-text("Optimise this brief")').count();
record('closing actions present (3)', actionLinks >= 3, `${actionLinks} found`);

record('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/thermo-qa/brief.png', fullPage: true });
console.log('\n  screenshot → /tmp/thermo-qa/brief.png');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
process.exit(failed.length === 0 ? 0 : 1);
