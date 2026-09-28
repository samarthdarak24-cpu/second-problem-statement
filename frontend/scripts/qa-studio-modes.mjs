/**
 * Verifies the grouped 3D mode control on the Design Studio.
 *
 * The concern being tested is that splitting sixteen flat tabs into
 * "always-visible tabs + one grouped dropdown" must not make any mode
 * unreachable. So this asserts:
 *   1. the analysis modes are tabs and all present
 *   2. every other mode is in the dropdown, in the right optgroup
 *   3. selecting a dropdown mode actually drives the store (the panel
 *      subtitle changes to that mode's own label)
 *   4. the total reachable set is still the full 16
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:3312';

const ANALYSIS = ['Normal', 'Solar', 'Temp', 'Loss', 'Flux', 'Moisture', 'Condense'];
const GROUPS = {
  Composition: ['Exploded view', 'Section cut'],
  'Site context': ['Air flow', 'Sun path', 'Dimensioned plan'],
  View: ['Front elevation', 'Side elevation', 'Roof plan', 'Walkthrough'],
};

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

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

console.log('\n=== Design Studio — mode control ===\n');

await page.goto(`${BASE}/dashboard/design/`, { waitUntil: 'networkidle', timeout: 90_000 });
await page.waitForTimeout(4000);

/* 1 — analysis mode tabs.
   Scoped to the first tablist: the page has four segmented controls
   (design mode Auto/Manual, the visualization modes, render quality,
   camera presets), so a bare [role="tab"] query would count all of them.
   The mode control is the one that contains "Normal". */
const modeTablist = page.locator('[role="tablist"]').filter({ hasText: 'Normal' }).first();
const tabs = (await modeTablist.locator('[role="tab"]').allInnerTexts()).map((t) => t.trim());
record('analysis modes render as tabs', tabs.length === 7, `${tabs.length} tabs: ${tabs.join(', ')}`);
for (const label of ANALYSIS) {
  record(`tab present: "${label}"`, tabs.includes(label));
}

/* 2 — dropdown structure */
const optgroups = await page.locator('select[aria-label="More visualization modes"] optgroup').evaluateAll((els) =>
  els.map((el) => ({ label: el.label, options: [...el.children].map((o) => o.textContent) })),
);
record('dropdown has 3 optgroups', optgroups.length === 3, optgroups.map((g) => g.label).join(' | '));

for (const [group, expected] of Object.entries(GROUPS)) {
  const found = optgroups.find((g) => g.label === group);
  const ok = found && expected.every((e) => found.options.includes(e));
  record(`optgroup "${group}" complete`, !!ok, ok ? `${expected.length} options` : JSON.stringify(found));
}

/* 3 — total reachable modes */
const dropdownValues = await page
  .locator('select[aria-label="More visualization modes"] option[value]:not([value=""])')
  .evaluateAll((els) => els.map((e) => e.value));
record(
  'total modes still 16',
  tabs.length + dropdownValues.length === 16,
  `${tabs.length} tabs + ${dropdownValues.length} dropdown = ${tabs.length + dropdownValues.length}`,
);

/* 4 — selecting a dropdown mode drives the store */
const select = page.locator('select[aria-label="More visualization modes"]');
await select.selectOption('exploded');
await page.waitForTimeout(1200);
const stateLabel = await page.getByTestId('active-mode').innerText();
record('selecting "exploded" updates the readout', /explod/i.test(stateLabel), `readout: "${stateLabel.trim()}"`);

/* the dropdown must now report the active mode rather than "More views…" */
const shownOption = await select.locator('option[value=""]').innerText();
record('dropdown reports active mode when off-tab', /explod/i.test(shownOption), `placeholder: "${shownOption.trim()}"`);

/* 5 — switching back to a tab clears the dropdown state.
   `MODE_LABEL.temperature` is 'Surface temp', not 'Temperature'. */
await modeTablist.locator('[role="tab"]', { hasText: 'Temp' }).first().click();
await page.waitForTimeout(1200);
const backLabel = await page.getByTestId('active-mode').innerText();
record('switching back to a tab works', /surface temp/i.test(backLabel), `readout: "${backLabel.trim()}"`);

/* and the dropdown should have fallen back to its placeholder */
const afterTab = await select.locator('option[value=""]').innerText();
record('dropdown resets to placeholder on tab', /more views/i.test(afterTab), `placeholder: "${afterTab.trim()}"`);

record('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/thermo-qa/studio-modes.png', fullPage: false });
console.log('\n  screenshot → /tmp/thermo-qa/studio-modes.png');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
process.exit(failed.length === 0 ? 0 : 1);
