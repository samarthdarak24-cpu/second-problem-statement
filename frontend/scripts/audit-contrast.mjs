/**
 * Contrast audit — proves the `--pastel-*` token repair took effect.
 *
 * The bug being verified: `soft.tsx` and six pages have always written
 * `surface-pastel-*` classes and `hsl(var(--pastel-*))` backgrounds, but those
 * custom properties were never declared. An undefined custom property makes the
 * declaration invalid, so the browser dropped it — cards lost their background
 * AND their ink, and dark text inherited onto whatever surface was behind it.
 *
 * So this script does NOT check "is the text pretty". It checks the two things
 * that were measurably broken:
 *
 *   1. every element carrying `surface-pastel-*` resolves to a real background
 *      (not `rgba(0, 0, 0, 0)` — the value an invalid declaration collapses to)
 *   2. the computed text colour of common content has a WCAG AA contrast ratio
 *      against the background actually rendered behind it
 *
 * Run:  node scripts/audit-contrast.mjs
 * Env:  BASE_URL (default http://localhost:3399)
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3399';

const ROUTES = [
  '/dashboard',
  '/dashboard/climate',
  '/dashboard/brief',
  '/dashboard/design',
  '/dashboard/analysis',
  '/dashboard/optimization',
  '/dashboard/scenarios',
  '/dashboard/materials',
  '/dashboard/method',
  '/dashboard/settings',
];

/* ------------------------------------------------------------------ */
/* Contrast maths — WCAG 2.1 relative luminance                        */
/* ------------------------------------------------------------------ */

function parseColour(input) {
  const m = /rgba?\(([^)]+)\)/.exec(input);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  const [r, g, b, a = 1] = parts;
  return { r, g, b, a };
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flatten a possibly-translucent fg over its bg. */
function flatten(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Page-side probe                                                     */
/* ------------------------------------------------------------------ */

const PROBE = () => {
  /**
   * Composite the whole backdrop stack, not just the nearest opaque layer.
   *
   * The earlier version stopped at the first non-transparent ancestor, then
   * the driver flattened that single value over hard-coded white. On a 12%
   * tint that is roughly right, but on the *engineering* viewport (a dark
   * slate panel) it is badly wrong: `rgba(255,255,255,0.3)` ink over a dark
   * panel is light-on-dark and reads fine, but compositing it over white
   * produced a near-white "background" and reported a 1:1 failure.
   *
   * So walk all the way up, accumulate every layer that actually paints, and
   * composite them outermost-last over the body colour.
   */
  function backdropStack(el) {
    const layers = [];
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.push(bg);
      node = node.parentElement;
    }
    const body = getComputedStyle(document.body).backgroundColor;
    if (body && body !== 'rgba(0, 0, 0, 0)') layers.push(body);
    // Outermost first is what the compositor needs; `layers` is innermost-first.
    return layers.reverse();
  }

  const out = { surfaces: [], text: [] };

  /* 1. Every painted tone surface must resolve to a real background. */
  document
    .querySelectorAll('.surface-pastel-blue,.surface-pastel-lavender,' +
      '.surface-pastel-mint,.surface-pastel-peach,.surface-pastel-yellow,' +
      '.surface-pastel-pink,.surface-pastel-gray,.pastel-card')
    .forEach((el, i) => {
      const cs = getComputedStyle(el);
      const cls = [...el.classList]
        .filter((c) => c.startsWith('surface-pastel-') || c === 'pastel-card')
        .join(' ');
      out.surfaces.push({
        i,
        cls,
        bg: cs.backgroundColor,
        colour: cs.color,
        tag: el.tagName.toLowerCase(),
        // `rgba(0, 0, 0, 0)` is exactly what an invalid hsl() collapses to.
        transparent: !cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)',
        // A surface that set a background but no ink is the half-fix.
        inkInherited: cs.color === 'rgb(28, 25, 23)' && !/fg/.test(cls),
      });
    });

  /* 2. Contrast of real text nodes. */
  const SEL = 'p,span,h1,h2,h3,h4,li,td,th,label,button,a,dd,dt,figcaption';
  document.querySelectorAll(SEL).forEach((el) => {
    // Only leaf-ish elements: skip a parent whose only child is the same text.
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!own) return;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (parseFloat(cs.opacity) < 0.05) return;

    const text = el.textContent.trim().slice(0, 60);
    if (!text) return;

    out.text.push({
      tag: el.tagName.toLowerCase(),
      text,
      fg: cs.color,
      bg: backdropStack(el)[0] ?? 'rgb(255, 255, 255)',
      stack: backdropStack(el),
      size: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      cls: [...el.classList].slice(0, 5).join('') || '',
    });
  });

  return out;
};

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch();
let totalSurfaces = 0;
let brokenSurfaces = 0;
let totalText = 0;
const failures = [];
/** Distinct failing (fg,bg) pairs, to see patterns rather than 500 lines. */
const failurePairs = new Map();

for (const route of ROUTES) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });

  const noise = [];
  page.on('console', (m) => {
    if (m.type() === 'error') noise.push(m.text().slice(0, 140));
  });

  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 45000 });
  } catch {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }
  /*
   * `domcontentloaded` fires before the route's client components have
   * committed. Reading computed styles at that point samples the server HTML,
   * i.e. the *previous* bundle — which is how an earlier run of this script
   * reported stale colours after the tokens had already been fixed. Wait for
   * hydration to settle instead of for a fixed duration.
   */
  await page.waitForFunction(
    () => {
      const bar = document.querySelector('.status-badge, .chip, .panel, .pastel-card');
      return !!bar;
    },
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(2600);

  const data = await page.evaluate(PROBE);

  /* --- surfaces --- */
  const broken = data.surfaces.filter((s) => s.transparent);
  totalSurfaces += data.surfaces.length;
  brokenSurfaces += broken.length;

  /* --- text contrast --- */
  const bad = [];
  for (const t of data.text) {
    const fg0 = parseColour(t.fg);
    if (!fg0) continue;

    /* Composite the full ancestor stack, outermost first. Start from an
       assumed white page (nothing in this app paints a page background other
       than `--background`, which is itself nearly white) and fold each layer
       in, so a 12% tint over a dark panel resolves to the dark panel's tint,
       not to a tint of white. */
    const stack = (t.stack ?? [t.bg]).map(parseColour).filter(Boolean);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of stack) {
      bg = {
        r: layer.r * layer.a + bg.r * (1 - layer.a),
        g: layer.g * layer.a + bg.g * (1 - layer.a),
        b: layer.b * layer.a + bg.b * (1 - layer.a),
        a: 1,
      };
    }

    /* Alpha ink composites over that backdrop before measuring — a 70%
       opacity caption is genuinely lighter than the token suggests. */
    const fg = flatten(fg0, bg);
    const r = ratio(fg, bg);
    // WCAG AA: 3.0 for large/bold-large text, 4.5 for body.
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    const min = large ? 3 : 4.5;
    totalText += 1;
    if (r < min) {
      const key = `${t.fg} on ${t.bg}  (need ${min})`;
      failurePairs.set(key, (failurePairs.get(key) ?? 0) + 1);
      bad.push({ ...t, ratio: Math.round(r * 100) / 100, min });
    }
  }
  if (bad.length) failures.push({ route, bad });

  console.log(
    `${route.padEnd(28)} surfaces ${String(data.surfaces.length).padStart(2)}` +
      ` (${broken.length} blank)  text ${String(data.text.length).padStart(4)}` +
      `  below-AA ${String(bad.length).padStart(3)}` +
      (noise.length ? `  console-err ${noise.length}` : ''),
  );

  await page.close();
}

await browser.close();

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

console.log('\n' + '='.repeat(72));
console.log('TONE SURFACES');
console.log('='.repeat(72));
console.log(`  checked        : ${totalSurfaces}`);
console.log(`  transparent bg : ${brokenSurfaces}`);
console.log(
  brokenSurfaces === 0
    ? '  ✓ every surface-pastel-* element resolves to a real background'
    : '  ✗ token repair did NOT take effect — check globals.css :root',
);

console.log('\n' + '='.repeat(72));
console.log('TEXT CONTRAST (WCAG 2.1 AA)');
console.log('='.repeat(72));
console.log(`  measured       : ${totalText}`);
const totalBad = failures.reduce((n, f) => n + f.bad.length, 0);
console.log(`  below AA       : ${totalBad}`);

if (totalBad) {
  console.log('\n  BY PATTERN (fg on bg, worst first)');
  const sorted = [...failurePairs.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, n] of sorted.slice(0, 14)) {
    console.log(`    ${String(n).padStart(4)}×  ${key}`);
  }
  if (sorted.length > 14) console.log(`    … ${sorted.length - 14} more distinct pairs`);

  console.log('\n  WORST EXAMPLES');
  const all = failures.flatMap((f) => f.bad.map((b) => ({ ...b, route: f.route })));
  all.sort((a, b) => a.ratio - b.ratio);
  for (const b of all.slice(0, 10)) {
    console.log(`    ${b.ratio.toFixed(2)} (need ${b.min})  ${b.tag}  "${b.text.slice(0, 48)}"`);
    console.log(`        ${b.fg} on ${b.bg}   @ ${b.route}`);
  }
} else {
  console.log('  ✓ no text below the AA threshold on any audited route');
}

process.exit(brokenSurfaces === 0 ? 0 : 1);
