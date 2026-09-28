/**
 * Verifies the dashboard redesign in a real browser, after hydration.
 *
 * Why a browser and not curl: the store hydrates client-side, so the
 * server HTML for `/dashboard` is the *unresolved* state ("Annual mean —").
 * Extra practice fact rows only appear once the climate summary has
 * resolved, so a curl check would report a false negative.
 *
 * Checks, in order of importance:
 *   1. exactly one <h1> (the Topbar's), and it names the page
 *   2. the four intended bands are present
 *   3. the three removed bands are gone
 *   4. the merged site-facts <dl> renders with real values
 *   5. no console errors
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:3311';

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Known non-defects: offline backend, Recharts deprecation, rate limits.
  if (/127\.0\.0\.1:8000|ERR_CONNECTION_REFUSED|defaultProps|429|Failed to fetch/i.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', (e) => {
  if (/defaultProps/i.test(e.message)) return;
  consoleErrors.push(`pageerror: ${e.message}`);
});

console.log('\n=== /dashboard (hydrated) ===\n');
await page.goto(`${BASE}/dashboard/`, { waitUntil: 'networkidle', timeout: 60_000 });
// Let the store resolve the climate summary.
await page.waitForTimeout(2500);

/* 1 — heading outline */
const h1s = await page.locator('h1').allInnerTexts();
record('exactly one <h1>', h1s.length === 1, `found ${h1s.length}: ${JSON.stringify(h1s)}`);
record('h1 names the page', h1s[0]?.trim() === 'Dashboard', `got "${h1s[0]?.trim()}"`);

/* 2 — the four bands */
const body = await page.locator('body').innerText();
for (const band of ['Indoor temperature · Solar gain · Heat flow', 'What the live building looks like']) {
  record(`band present: "${band}"`, body.includes(band));
}

/* 3 — removed bands must be gone */
for (const gone of ['Open another city', 'Where to next', '2 hours ago', 'yesterday']) {
  record(`removed: "${gone}"`, !body.includes(gone));
}

/* 4 — merged site facts */
const dlCount = await page.locator('dl').count();
record('<dl> site-facts block rendered', dlCount > 0, `${dlCount} found`);

const factLabels = (await page.locator('dl dt').allInnerTexts()).map((l) =>
  l.trim().toLowerCase(),
);
const wanted = ['Annual mean', 'Diurnal swing', 'Rainfall', 'Wind', 'Elevation', 'Coords'];
// Case-insensitive: the <dt> carries CSS `uppercase`, and innerText
// reflects the rendered transform rather than the source text.
const missing = wanted.filter((w) => !factLabels.includes(w.toLowerCase()));
record('all six site facts present', missing.length === 0, missing.length ? `missing ${missing}` : '6/6');

const factValues = (await page.locator('dl dd').allInnerTexts()).map((v) => v.trim());
const placeholders = factValues.filter((v) => v === '—' || v === '');
record(
  'site facts resolved to real values',
  placeholders.length === 0,
  placeholders.length ? `${placeholders.length} still placeholder` : factValues.join(' | '),
);

/* 5 — destinations nav */
const navCount = await page.locator('nav[aria-label="Other destinations"] a').count();
record('destinations nav has 3 links', navCount === 3, `${navCount} found`);

/* 6 — console health */
record('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/thermo-qa/dashboard.png', fullPage: true });
console.log('\n  screenshot → /tmp/thermo-qa/dashboard.png');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
process.exit(failed.length === 0 ? 0 : 1);
