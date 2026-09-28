import { chromium } from 'playwright';

const B = process.env.BASE_URL ?? 'http://localhost:3444';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${B}/dashboard/materials`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const badges = [];
  document.querySelectorAll('.status-badge').forEach((el) => {
    const cs = getComputedStyle(el);
    badges.push({
      txt: el.textContent.trim(),
      bg: cs.backgroundColor,
      fg: cs.color,
      inline: el.getAttribute('style'),
    });
  });

  const chips = [];
  document.querySelectorAll('.chip').forEach((el) => {
    const cs = getComputedStyle(el);
    chips.push({
      txt: el.textContent.trim().slice(0, 24),
      bg: cs.backgroundColor,
      fg: cs.color,
    });
  });
  return { badges: badges.slice(0, 6), chips: chips.slice(0, 10) };
});

console.log('STATUS BADGES');
console.log(JSON.stringify(r.badges, null, 1));
console.log('\nCHIPS');
console.log(JSON.stringify(r.chips, null, 1));

await browser.close();
