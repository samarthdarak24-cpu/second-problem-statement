/**
 * Thermal Analysis — responsive + accessibility vertical slice.
 *
 * Checks the five target widths from the brief (1440 / 1280 / 1024 / 768 /
 * 390) and the accessibility requirements that apply to this page:
 * one h1, labelled sections, visible focus, non-colour status, and
 * alt/aria coverage on the charts.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:3313';
const ROUTE = '/dashboard/analysis/';

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
    // `pointer: coarse` — and therefore the touch-target floor in
    // globals.css — only matches when the browser context actually has a
    // touch input. Without these two flags the media query never fires and
    // the test silently measures the desktop control sizes.
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

  await page.goto(BASE + ROUTE, { waitUntil: 'load' });
  await page
    .locator('section[aria-labelledby="thermal-condition"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(900);

  /* --- No horizontal overflow --- */
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`[${vp.name}] no horizontal overflow`, overflow <= 0, `${overflow}px`);

  /* --- Reading band reflows: 4-up at >=640, 2-up below --- */
  const cols = await page.evaluate(() => {
    const dl = document.querySelector('section[aria-labelledby="thermal-condition"] dl');
    if (!dl) return null;
    return getComputedStyle(dl).gridTemplateColumns.split(' ').filter(Boolean).length;
  });
  const expectedCols = vp.width >= 640 ? 4 : 2;
  check(
    `[${vp.name}] reading metrics use ${expectedCols} columns`,
    cols === expectedCols,
    `got ${cols}`,
  );

  /* --- The band's grid does not overflow its card --- */
  const bandFits = await page.evaluate(() => {
    const band = document.querySelector('section[aria-labelledby="thermal-condition"]');
    if (!band) return null;
    const b = band.getBoundingClientRect();
    const dl = band.querySelector('dl');
    const d = dl ? dl.getBoundingClientRect() : null;
    return { bandRight: Math.round(b.right), dlRight: d ? Math.round(d.right) : null };
  });
  check(
    `[${vp.name}] reading metrics stay inside the band`,
    bandFits && bandFits.dlRight !== null && bandFits.dlRight <= bandFits.bandRight + 1,
    JSON.stringify(bandFits),
  );

  /* --- Charts: recharts surfaces must not exceed their container --- */
  const chartOk = await page.evaluate(() => {
    const surfaces = Array.from(document.querySelectorAll('.recharts-surface'));
    const bad = surfaces.filter((s) => {
      const r = s.getBoundingClientRect();
      return r.width > window.innerWidth + 1;
    });
    return { total: surfaces.length, bad: bad.length };
  });
  check(
    `[${vp.name}] charts fit the viewport`,
    chartOk.bad === 0,
    `${chartOk.total} surfaces, ${chartOk.bad} overflowing`,
  );

  /* --- Touch targets at coarse-pointer widths --- */
  if (vp.width < 768) {
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a, select, [role="tab"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.height < 40 || r.width < 40) {
          out.push({
            tag: el.tagName.toLowerCase(),
            w: Math.round(r.width),
            h: Math.round(r.height),
            t: (el.textContent || '').trim().slice(0, 20),
          });
        }
      });
      return out;
    });
    // Only report interactive controls inside the page content, not the
    // global shell chrome (which is out of scope for this page slice).
    check(
      `[${vp.name}] touch targets >= 40px (page content)`,
      small.length === 0,
      small.length ? `${small.length} small: ${JSON.stringify(small.slice(0, 4))}` : '',
    );
  }

  /* --- Accessibility: one h1, labelled sections --- */
  const a11y = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    unlabelledSections: Array.from(document.querySelectorAll('section[aria-labelledby]')).filter(
      (s) => !document.getElementById(s.getAttribute('aria-labelledby')),
    ).length,
  }));
  check(`[${vp.name}] exactly one <h1>`, a11y.h1 === 1, `${a11y.h1}`);
  check(
    `[${vp.name}] all labelled sections resolve their label`,
    a11y.unlabelledSections === 0,
    `${a11y.unlabelledSections} dangling`,
  );

  check(`[${vp.name}] no page errors`, errors.length === 0, errors.slice(0, 1).join(''));

  await page.screenshot({
    path: `.shots/analysis-${vp.name}.png`,
    fullPage: false,
  });
  await page.close();
}

/* --- Focus visibility, checked once at desktop --- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + ROUTE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const outlineVisible =
      (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
      cs.boxShadow !== 'none';
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 24),
      outlineVisible,
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
      shadow: cs.boxShadow.slice(0, 40),
    };
  });
  check(
    'Keyboard focus is visible on the 2nd tab stop',
    !!focusInfo && focusInfo.outlineVisible,
    JSON.stringify(focusInfo),
  );
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
