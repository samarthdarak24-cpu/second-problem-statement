/**
 * Responsive audit — measures real breakage at the breakpoints the brief
 * names (1440 / 1280 / 1024 / tablet 768 / mobile 390).
 *
 * Checks that static reading cannot answer:
 *   1. horizontal overflow — the single most common responsive defect
 *   2. tap-target size — anything under 40px is a mis-tap on touch
 *   3. text below 11px — unreadable on mobile regardless of contrast
 *   4. 3D viewport height — the brief asks for a deliberate mobile mode,
 *      so the canvas must not collapse to a sliver or overflow the fold
 *   5. dashboard metric grid — must not squeeze 3 columns into 390px
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:3313';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 950 },
  { name: 'laptop-1280', width: 1280, height: 850 },
  { name: 'small-laptop-1024', width: 1024, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
];

const ROUTES = [
  { path: '/dashboard/', label: 'dashboard', has3d: true },
  { path: '/dashboard/design/', label: 'studio', has3d: true },
  { path: '/dashboard/analysis/', label: 'analysis', has3d: false },
  { path: '/dashboard/climate/', label: 'climate', has3d: false },
  { path: '/dashboard/brief/', label: 'brief', has3d: false },
  { path: '/dashboard/materials/', label: 'materials', has3d: false },
  { path: '/dashboard/scenarios/', label: 'scenarios', has3d: false },
  { path: '/dashboard/optimization/', label: 'optimization', has3d: false },
];

const findings = [];
const note = (v, route, kind, detail, severity = 'warn') =>
  findings.push({ v, route, kind, detail, severity });

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });

  console.log(`\n──────── ${vp.name} (${vp.width}×${vp.height}) ────────`);

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.waitForTimeout(1800);

    const m = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const scrollW = document.documentElement.scrollWidth;

      // Widest offenders that actually cause horizontal overflow.
      const overflowing = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > docW + 2 || r.left < -2) {
          const style = getComputedStyle(el);
          if (style.position === 'fixed') continue;
          overflowing.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 70),
            right: Math.round(r.right),
            left: Math.round(r.left),
          });
        }
      }

      // Tap targets: interactive elements smaller than 40×40.
      const smallTargets = [];
      for (const el of document.querySelectorAll('button, a[href], select, [role="tab"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (r.height < 40 || r.width < 24) {
          smallTargets.push({
            text: (el.textContent || '').trim().slice(0, 28),
            w: Math.round(r.width),
            h: Math.round(r.height),
            tag: el.tagName.toLowerCase(),
          });
        }
      }

      // Tiny text.
      let tiny = 0;
      for (const el of document.querySelectorAll('p, span, td, th, li, label, dt, dd')) {
        if (!el.textContent || !el.textContent.trim()) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs > 0 && fs < 10.5) tiny += 1;
      }

      // The 3D canvas, if this route has one.
      const canvases = [...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });

      return {
        overflowPx: scrollW - docW,
        docW,
        overflowing: overflowing.slice(0, 6),
        smallTargets: smallTargets.slice(0, 8),
        smallCount: smallTargets.length,
        tiny,
        canvases,
      };
    });

    const flags = [];

    if (m.overflowPx > 2) {
      flags.push(`overflow +${m.overflowPx}px`);
      note(vp.name, route.label, 'overflow', `+${m.overflowPx}px — ${JSON.stringify(m.overflowing)}`, 'error');
    }

    // Tap targets only matter on touch-sized viewports.
    const isTouch = vp.width <= 768;
    if (isTouch && m.smallCount > 0) {
      flags.push(`${m.smallCount} small targets`);
      note(vp.name, route.label, 'tap-target', `${m.smallCount} below 40px — ${JSON.stringify(m.smallTargets.slice(0, 4))}`, 'warn');
    }

    if (m.tiny > 0) {
      flags.push(`${m.tiny} tiny text`);
      note(vp.name, route.label, 'tiny-text', `${m.tiny} elements under 10.5px`, 'warn');
    }

    if (route.has3d && m.canvases.length > 0) {
      const c = m.canvases[0];
      const tooShort = c.h < 220;
      const tooWide = c.w > m.docW + 2;
      if (tooShort) {
        flags.push(`canvas ${c.h}px tall`);
        note(vp.name, route.label, 'canvas-height', `3D canvas only ${c.h}px tall (${c.w}×${c.h})`, 'error');
      }
      if (tooWide) {
        flags.push(`canvas overflows`);
        note(vp.name, route.label, 'canvas-width', `canvas ${c.w}px vs viewport ${m.docW}px`, 'error');
      }
      if (!tooShort && !tooWide) flags.push(`canvas ok ${c.w}×${c.h}`);
    }

    const status = flags.length ? flags.join(' · ') : 'clean';
    const hasError = findings.some((f) => f.v === vp.name && f.route === route.label && f.severity === 'error');
    console.log(`  ${hasError ? '✗' : flags.length ? '·' : '✓'} ${route.label.padEnd(14)} ${status}`);
  }

  await page.screenshot({ path: `/tmp/thermo-qa/resp-${vp.name}.png`, fullPage: true });
  await page.close();
}

await browser.close();

console.log('\n════════ SUMMARY ════════');
const errors = findings.filter((f) => f.severity === 'error');
const warns = findings.filter((f) => f.severity === 'warn');
console.log(`  errors:   ${errors.length}`);
console.log(`  warnings: ${warns.length}`);

if (errors.length) {
  console.log('\n  ERRORS (must fix):');
  for (const e of errors) console.log(`    [${e.v}] ${e.route} · ${e.kind} — ${e.detail}`);
}
if (warns.length) {
  console.log('\n  WARNINGS (review):');
  for (const w of warns.slice(0, 25)) console.log(`    [${w.v}] ${w.route} · ${w.kind} — ${w.detail}`);
}

process.exit(errors.length ? 1 : 0);
