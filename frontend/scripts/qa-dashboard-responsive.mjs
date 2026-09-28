/**
 * Dashboard responsive check across the brief's five widths.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:3313';
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'laptop-1280', width: 1280, height: 860 },
  { name: 'small-laptop-1024', width: 1024, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
];

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
}

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.width < 768,
    isMobile: vp.width < 768,
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

  await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
  await page
    .locator('section[aria-labelledby="dashboard-reading"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(900);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`[${vp.name}] no horizontal overflow`, overflow <= 0, `${overflow}px`);

  /* The reading band's metric cluster must stay inside the band. */
  const fits = await page.evaluate(() => {
    const band = document.querySelector('section[aria-labelledby="dashboard-reading"]');
    if (!band) return null;
    const b = band.getBoundingClientRect();
    const dl = band.querySelector('dl');
    const d = dl ? dl.getBoundingClientRect() : null;
    return { bandRight: Math.round(b.right), dlRight: d ? Math.round(d.right) : null };
  });
  check(
    `[${vp.name}] reading metrics stay inside the band`,
    fits && fits.dlRight !== null && fits.dlRight <= fits.bandRight + 1,
    JSON.stringify(fits),
  );

  if (vp.width < 768) {
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, select, [role="tab"]'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40);
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
          t: (el.textContent || '').trim().slice(0, 18),
        })),
    );
    check(
      `[${vp.name}] touch targets >= 40px`,
      small.length === 0,
      small.length ? `${small.length}: ${JSON.stringify(small.slice(0, 4))}` : '',
    );
  }

  check(`[${vp.name}] no page errors`, errors.length === 0, errors.slice(0, 1).join(''));

  await page.screenshot({ path: `.shots/dashboard-${vp.name}.png`, fullPage: false });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
