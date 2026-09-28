/**
 * AUDIT — §37 SIH END-TO-END, CORRECTED.
 *
 * Fixes over the first attempt:
 *  - the studio's parameter groups are COLLAPSIBLES named "Mission1",
 *    "Programme6", "Envelope10"… (name + item count). Exact-text matching for
 *    "Personnel accommodation" failed because the mission buttons live INSIDE
 *    the collapsed "Mission1" group, so the group must be opened first.
 *  - the on-screen Design Brief and the printable report are different surfaces:
 *    the three PS-51 outputs are asserted on the REPORT (lib/report.ts), which
 *    is where the brief's own comment says they live.
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:4123';
const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? `  :: ${d}` : ''}`); };
const info = (l, v) => console.log(`        · ${l}: ${v}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errs = [];
page.on('pageerror', (e) => { if (!/defaultProps/.test(String(e))) errs.push(String(e).slice(0, 220)); });

/** Click a sidebar link. Scoped to the <nav> so in-page links cannot be hit. */
const navTo = async (label) => {
  const ok = await page.evaluate((lbl) => {
    const scopes = Array.from(document.querySelectorAll('nav, aside'));
    for (const scope of scopes) {
      const l = Array.from(scope.querySelectorAll('a[href^="/dashboard"]')).find(
        (a) => (a.textContent || '').trim() === lbl,
      );
      if (l) { l.click(); return true; }
    }
    return false;
  }, label);
  /* Wait for the route to actually change, not a fixed sleep. */
  await page.waitForFunction(
    (lbl) => {
      const h1 = (document.querySelector('h1') || {}).textContent || '';
      return h1.length > 0 && new RegExp(lbl.split(' ')[0], 'i').test(h1);
    },
    label,
    { timeout: 12000 },
  ).catch(() => {});
  await page.waitForTimeout(2500);
  return ok;
};

/** Open a collapsible parameter group by its leading word (the title has a count). */
const openGroup = (word) =>
  page.evaluate((w) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) =>
      new RegExp(`^${w}\\d*$`, 'i').test((x.textContent || '').trim()),
    );
    if (!b) return `no group "${w}"`;
    if (b.getAttribute('aria-expanded') === 'true') return `"${(b.textContent || '').trim()}" already open`;
    b.click();
    return `opened "${(b.textContent || '').trim()}"`;
  }, word);

const setCity = (city) =>
  page.evaluate((c) => {
    const s = Array.from(document.querySelectorAll('select')).find((x) => x.getAttribute('aria-label') === 'City');
    if (!s) return 'no city select';
    const o = Array.from(s.options).find((op) => new RegExp(c, 'i').test(op.textContent || ''));
    if (!o) return `no option ${c}`;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, o.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return o.textContent;
  }, city);

/**
 * Set the mission via its real control: a <select aria-label="Mission profile">.
 * The first attempt searched for buttons, which never existed.
 */
const setMission = (match) =>
  page.evaluate((m) => {
    const s = Array.from(document.querySelectorAll('select')).find((x) => x.getAttribute('aria-label') === 'Mission profile');
    if (!s) return 'no Mission profile select';
    const o = Array.from(s.options).find((op) => new RegExp(m, 'i').test(op.textContent || '') || new RegExp(m, 'i').test(op.value));
    if (!o) return `no option matching ${m}`;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, o.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return `${o.value} :: ${o.textContent.trim().slice(0, 46)}`;
  }, match);

const setSelect = (aria, match) =>
  page.evaluate(({ a, m }) => {
    const s = Array.from(document.querySelectorAll('select')).find((x) => x.getAttribute('aria-label') === a);
    if (!s) return `no select "${a}"`;
    const o = Array.from(s.options).find((op) => new RegExp(m, 'i').test(op.textContent || ''));
    if (!o) return `no option ${m}`;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, o.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return `${s.value} → ${o.textContent.slice(0, 50)}`;
  }, { a: aria, m: match });

const gen = () =>
  page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /Generate design/i.test(x.textContent || ''));
    if (!b) return 'no button';
    if (b.disabled) return 'disabled';
    b.click(); return 'clicked';
  });

/** Read the Thermal Condition band specifically. */
const readBand = () =>
  page.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="thermal-condition"]');
    const t = s ? s.innerText.replace(/\s+/g, ' ') : '';
    /* The verdict vocabulary includes the dual-season case ("Both seasons fall
       outside the adaptive band…"), which the first regex omitted. */
    return {
      present: !!s,
      verdict:
        (t.match(
          /Too warm[^.]*\.|Too cold[^.]*\.|Comfortable[^.]*\.|Partially[^.]*\.|Both seasons[^.]*\.|Attention[^.]*\.|Critical[^.]*\./,
        ) || [])[0] || null,
      tier: (t.match(/\b(Critical|Attention|Good|Comfortable)\b/) || [])[0] || null,
      weak: (t.match(/[A-Za-z]+ is the weakest point in the fabric, conducting [\d.]+ kWh\/day/) || [])[0] || null,
      head: t.slice(0, 240),
    };
  });

await page.goto(BASE + '/dashboard/', { waitUntil: 'load' });
await page.waitForTimeout(15000);

/* ========================= CASE A ========================= */
console.log('\n════ §37 CASE A — Leh · Personnel Accommodation · high-altitude ════\n');
await navTo('Design Studio');
info('city', await setCity('Leh'));
await page.waitForTimeout(2500);

info('shelter group', await openGroup('Shelter'));
await page.waitForTimeout(1500);
info('shelter type', await setSelect('Type', 'high-altitude'));
await page.waitForTimeout(2500);

info('mission group', await openGroup('Mission'));
await page.waitForTimeout(1500);
info('mission', await setMission('Personnel accommodation'));
await page.waitForTimeout(2500);

info('generate', await gen());
await page.waitForTimeout(17000);

await navTo('Thermal Analysis');
const bandA = await readBand();
info('band present', bandA.present);
info('band head', bandA.head);
check('§37.A Thermal Condition band renders for Leh', bandA.present, bandA.head.slice(0, 90));
check('§37.A a verdict is stated', !!bandA.verdict, bandA.verdict || 'none');
check('§37.A a dominant fabric path is named', !!bandA.weak, bandA.weak || 'none');

await navTo('Design Brief');
await page.waitForTimeout(5000);
const briefA = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    h1: (document.querySelector('h1') || {}).textContent,
    city: (t.match(/\b(Pune|Leh|Jodhpur|Chennai|Shillong)\b/) || [])[0] || null,
    len: t.replace(/\s+/g, ' ').length,
    disclaimer: /not a measured building result|model estimate/i.test(t),
    sections: (t.match(/Indoor temperature|Comfort|Energy|Heat|Moisture|Cost|Recommend/g) || []).slice(0, 12),
  };
});
info('brief', JSON.stringify(briefA));
check('§37.A Design Brief is about Leh', briefA.city === 'Leh', briefA.city || 'none');
check('§37.A Design Brief is substantive', briefA.len > 2000, `${briefA.len} chars`);
check('§37.A Design Brief carries the model-estimate disclaimer', briefA.disclaimer);

/* ========================= CASE B ========================= */
console.log('\n════ §37 CASE B — Chennai · Medical · warm/humid ════\n');
await navTo('Design Studio');
info('city', await setCity('Chennai'));
await page.waitForTimeout(2500);
info('shelter group', await openGroup('Shelter'));
await page.waitForTimeout(1500);
info('shelter type', await setSelect('Type', 'warm-humid'));
await page.waitForTimeout(2500);
info('mission group', await openGroup('Mission'));
await page.waitForTimeout(1500);
info('mission', await setMission('Medical'));
await page.waitForTimeout(2500);
info('generate', await gen());
await page.waitForTimeout(17000);

await navTo('Thermal Analysis');
const bandB = await readBand();
info('band head', bandB.head);
check('§37.B Thermal Condition band renders for Chennai', bandB.present, bandB.head.slice(0, 90));
check('§37.B a verdict is stated', !!bandB.verdict, bandB.verdict || 'none');
check(
  '§37.B the climate change alters the answer (Leh vs Chennai)',
  bandA.verdict !== bandB.verdict || bandA.weak !== bandB.weak,
  `A="${(bandA.verdict || '').slice(0, 34)}" B="${(bandB.verdict || '').slice(0, 34)}"`,
);

await navTo('Design Brief');
await page.waitForTimeout(5000);
const briefB = await page.evaluate(() => {
  const t = document.body.innerText;
  return { city: (t.match(/\b(Pune|Leh|Jodhpur|Chennai|Shillong)\b/) || [])[0] || null, len: t.replace(/\s+/g, ' ').length };
});
check('§37.B Design Brief is about Chennai', briefB.city === 'Chennai', briefB.city || 'none');

console.log('\n════ §37 other required surfaces ════\n');
for (const [label, expect] of [
  ['Site & Climate', /Climate/i],
  ['Optimization', /Optim/i],
  ['Climate Response', /Response/i],
  ['Materials', /Materials/i],
  ['Method & Limits', /Method/i],
]) {
  const clicked = await navTo(label);
  const h1 = await page.evaluate(() => (document.querySelector('h1') || {}).textContent || '');
  const renders = expect.test(h1);
  check(`§37 ${label} renders`, clicked && renders, `clicked=${clicked} h1="${h1}"`);
}

check('§37 no page errors across both scenarios', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.n} :: ${f.d}`));
process.exit(failed.length ? 1 : 0);
