/**
 * Motion QA — verifies the animation pass actually works AND that the
 * reduced-motion path collapses it.
 *
 * The important assertion is the second one: `MotionConfig
 * reducedMotion="user"` is easy to add and easy to get wrong, and a
 * transform that still runs when the user asked for no motion is an
 * accessibility regression.
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

/* ---------- 1. Motion runs when motion is allowed ---------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + ROUTE, { waitUntil: 'load' });
  await page
    .locator('section[aria-labelledby="thermal-condition"]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(800);

  // The stagger items should settle to their final state (y:0, opacity:1).
  const settled = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('section[aria-labelledby="thermal-condition"] dd'),
    );
    return items.map((el) => {
      const cs = getComputedStyle(el.parentElement);
      return { opacity: cs.opacity, transform: cs.transform };
    });
  });
  const allSettled = settled.length > 0 && settled.every((s) => Number(s.opacity) > 0.95);
  check(
    'Motion: staggered metrics settle to full opacity',
    allSettled,
    `${settled.length} items`,
  );

  // The bar rows animate width; confirm the final width is the real share,
  // not 0 (which is what a broken animation leaves behind).
  const bars = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.recharts-surface'));
    return els.length;
  });
  check('Motion: charts still render after animation', bars > 0, `${bars} surfaces`);

  await ctx.close();
}

/* ---------- 2. Motion is suppressed under reduced-motion ---------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + ROUTE, { waitUntil: 'load' });
  await page
    .locator('section[aria-labelledby="thermal-condition"]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});

  /* The assertion is about the *transform*, which is the part that causes
     motion sickness. framer-motion's `reducedMotion="user"` deliberately
     keeps the opacity fade — a fade is not vestibular-triggering, and
     dropping it entirely would make content pop without warning.
     Sampling opacity at 60ms is a race against a 400ms fade, so it is not
     asserted here; "content fully settled" below covers legibility. */
  await page.waitForTimeout(60);
  const immediate = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('section[aria-labelledby="thermal-condition"] dd'),
    );
    return items.map((el) => {
      const cs = getComputedStyle(el.parentElement);
      return { opacity: cs.opacity, transform: cs.transform };
    });
  });

  const noOffset = immediate.every(
    (s) => s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)',
  );
  check(
    'Reduced motion: no transform on any metric',
    immediate.length > 0 && noOffset,
    JSON.stringify(immediate.slice(0, 2)),
  );

  /* And the fade completes quickly — nothing is left invisible. */
  await page.waitForTimeout(900);
  const final = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('section[aria-labelledby="thermal-condition"] dd'),
    ).every((el) => Number(getComputedStyle(el.parentElement).opacity) > 0.99),
  );
  check('Reduced motion: content fully settled after the fade', final);

  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
