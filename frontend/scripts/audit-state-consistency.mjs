/**
 * AUDIT — §31 State consistency invariant, CORRECTED methodology.
 *
 * ROOT CAUSE OF THE EARLIER FALSE NEGATIVE:
 * The store is a module-level Zustand store with NO persistence middleware.
 * `page.goto()` is a HARD navigation -> full reload -> the store is rebuilt.
 * So any test that `goto`s between steps destroys the state it is checking.
 *
 * The invariant "ONE DESIGN STATE -> ... -> ONE VISUAL" only governs
 * CLIENT-SIDE navigation. This harness therefore navigates by CLICKING the
 * sidebar, exactly as a user does, and never reloads mid-test.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
};
const info = (l, v) => console.log(`        · ${l}: ${v}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
const errs = [];
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) errs.push(String(e).slice(0, 200)); });

/** Client-side navigation via the sidebar — NO reload. */
async function navTo(label) {
  const ok = await page.evaluate((lbl) => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const link = links.find((a) => (a.textContent || '').trim().replace(/\s+/g, ' ') === lbl)
      || links.find((a) => (a.textContent || '').trim().includes(lbl));
    if (!link) return false;
    link.click();
    return true;
  }, label);
  await page.waitForTimeout(3500);
  return ok;
}

const readAnalysis = () =>
  page.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="thermal-condition"]');
    const t = s ? s.innerText : '';
    return {
      weak: (t.match(/[A-Za-z]+ is the weakest point in the fabric, conducting [\d.]+ kWh\/day/) || [])[0] || null,
      verdict: (t.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./) || [])[0] || null,
      raw: t.replace(/\s+/g, ' '),
    };
  });

const readShell = () =>
  page.evaluate(() => {
    const t = document.body.innerText;
    return {
      city: (t.match(/\b(Pune|Leh|Jodhpur|Chennai|Shillong|Delhi|Srinagar)\b/) || [])[0] || null,
      pip: (t.match(/\d+\s*\/\s*100/) || [])[0] || null,
      comfort: (t.match(/\d+(?:\.\d+)?%\s*of the year/) || [])[0] || null,
      verdict: (t.match(/Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\./) || [])[0] || null,
      h1: (document.querySelector('h1') || {}).textContent || null,
    };
  });

/* ============ 1. ALLOW THE FIRST BOOT TO COMPLETE ============ */
console.log('\n════ §31 STATE CONSISTENCY (client-side navigation) ════\n');
await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
await page.locator('section[aria-labelledby="dashboard-reading"]').first().waitFor({ timeout: 60000 }).catch(() => {});
await page.waitForTimeout(14000);
const boot = await readShell();
info('boot city', boot.city);
info('boot pip', boot.pip);
info('boot verdict', boot.verdict);
check('§31.1 pipeline boots and produces a verdict', !!boot.verdict, boot.verdict || 'none');

/* ============ 2. CHANGE THE SITE (client-side) ============ */
await navTo('Site & Climate');
const climatePage = await page.evaluate(() => (document.querySelector('h1') || {}).textContent);
info('landed on', climatePage);
check('§31.2 client-side nav to Site & Climate works', /Climate/i.test(climatePage || ''), climatePage || 'none');

/* change the city in the topbar — stays on the SAME module instance */
const switched = await page.evaluate(() => {
  const s = Array.from(document.querySelectorAll('select')).find((x) => x.getAttribute('aria-label') === 'City');
  if (!s) return 'no select';
  const opt = Array.from(s.options).find((o) => /Leh/i.test(o.textContent || ''));
  if (!opt) return 'no option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(s, opt.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.textContent;
});
info('switched city to', switched);
await page.waitForTimeout(6000);

const afterSwitch = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    status: (t.match(/Site set to [^\n]*/) || [])[0] || null,
    generating: /Generating/.test(t),
    idle: /\bIdle\b/.test(t),
  };
});
info('after switch status', afterSwitch.status);
info('after switch generating', afterSwitch.generating);
check('§31.3 site change clears stale results and invites a re-run', !!afterSwitch.status, afterSwitch.status || 'no status');

/* ============ 3. GENERATE AND CONFIRM THE NEW SITE PROPAGATES ============ */
const gen = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /Generate design/i.test(x.textContent || ''));
  if (!b) return 'no button';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
});
info('generate', gen);
await page.waitForTimeout(14000);

/* ============ 4. CLIENT-SIDE NAV TO ANALYSIS — state must survive ============ */
await navTo('Thermal Analysis');
const h1A = await page.evaluate(() => (document.querySelector('h1') || {}).textContent);
info('on', h1A);
const A = await readAnalysis();
info('analysis weak', A.weak);
info('analysis verdict', A.verdict);
check('§31.4 Analysis renders a result after client-side nav', !!A.weak || !!A.verdict, A.weak || A.verdict || 'none');
const cityA = await readShell();
check(
  '§31.5 the site the user selected survives navigation (Leh)',
  /Leh/i.test(JSON.stringify(cityA)),
  `city=${cityA.city}`,
);

/* ============ 5. DRIVE A REAL ENVELOPE PARAMETER IN THE STUDIO ============ */
await navTo('Design Studio');
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /^Manual$/i.test((x.textContent || '').trim()));
  if (b) b.click();
});
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /Envelope/i.test(x.textContent || ''));
  if (b) b.click();
});
await page.waitForTimeout(2500);

const envChange = await page.evaluate(() => {
  /* Pick the FIRST envelope control that actually has a DIFFERENT value to move
     to. Setting a select to the value it already holds is not a design change,
     and treating it as one was the fault in the previous pass of this probe. */
  const NAMES = [
    'Insulation level',
    'Wall material',
    'Roof material',
    'Glazing',
    'Glazing position',
    'Wall thickness',
    'Insulation thickness',
    'Window-to-wall ratio',
  ];
  for (const name of NAMES) {
    const el = document.querySelector(`[aria-label="${name}"]`);
    if (!el) continue;
    if (el.tagName === 'SELECT') {
      const sel = el;
      if (sel.options.length < 2) continue;
      const before = sel.value;
      const target = Array.from(sel.options).find((o) => o.value !== before);
      if (!target) continue;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, target.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { kind: 'select', name, before, after: target.value, text: target.textContent };
    }
    /* range */
    const min = parseFloat(el.min || '0');
    const max = parseFloat(el.max || '100');
    const cur = parseFloat(el.value || '0');
    const next = cur + (max - min) * 0.3 > max ? cur - (max - min) * 0.3 : cur + (max - min) * 0.3;
    if (!Number.isFinite(next) || Math.abs(next - cur) < 1e-9) continue;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(Number(next.toFixed(4))));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { kind: 'range', name, before: cur, after: Number(next.toFixed(4)) };
  }
  return null;
});
info('insulation changed', JSON.stringify(envChange));
check('§31.6 an envelope parameter was driven', !!envChange, JSON.stringify(envChange));
await page.waitForTimeout(8000);

/* thermal analysis must reflect it */
await navTo('Thermal Analysis');
const B = await readAnalysis();
info('after-change weak', B.weak);
info('after-change verdict', B.verdict);

/* ============ 6. ROUND TRIP — state must persist ============ */
await navTo('Materials');
await page.waitForTimeout(2500);
await navTo('Thermal Analysis');
const C = await readAnalysis();

check(
  '§31.7 the SAME design is shown after a round trip through another page',
  C.raw === B.raw,
  C.raw === B.raw ? 'identical' : 'DIFFERS',
);
check(
  '§31.8 changing the envelope changed the thermal result',
  A.raw !== B.raw,
  A.raw !== B.raw ? 'changed' : 'IDENTICAL — stale',
);

/* ============ 7. REPORT MUST MATCH THE CURRENT DESIGN ============ */
await navTo('Design Brief');
await page.waitForTimeout(6000);
const brief = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    city: (t.match(/\b(Pune|Leh|Jodhpur|Chennai|Shillong)\b/) || [])[0] || null,
    h1: (document.querySelector('h1') || {}).textContent || null,
    len: t.length,
  };
});
info('brief h1', brief.h1);
info('brief city', brief.city);
check('§31.9 the brief reflects the SAME site as the live design', brief.city === cityA.city, `brief=${brief.city} design=${cityA.city}`);

check('§31.10 no page errors during the run', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.name} :: ${f.detail}`));
process.exit(failed.length ? 1 : 0);
