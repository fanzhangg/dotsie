// The trip's map, through what people see and do on it, not how it's drawn: pins where the places are and clear of the
// list, tapping a pin, a route or empty map, the camera following the plan, Whole day, double-tap zoom, sights. Run by
// the prototype (seeded trips, no server). Routes can't be looked up here, so each drive is a straight line between
// its pins.
import { expect, sheet, test } from './fixtures.js';

const plan = page => page.getByRole('region', { name: 'Plan' });
// A pin is the round dot itself, which carries its stop's number, name and type
const pin = (page, re) => page.locator('#map .wt-pin').filter({ visible: true }).and(page.getByRole('img', { name: re }));
const row = (page, name) => plan(page).getByRole('button', { name: new RegExp(`^\\w+ ${name}`) }).first();
const drive = (page, to) => plan(page).getByRole('button', { name: new RegExp(`drive to ${to}\\. Show the route`) }).first();
const wholeDay = page => page.getByRole('button', { name: /^Show the whole (day|trip) on the map$/ });
const center = async loc => { const b = await loc.boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

// The part of the map you can see: under the header, and above the list on a phone or beside it on a wide screen
async function shown(page) {
  const map = await page.locator('#map').boundingBox(), head = await page.locator('.wt-trip-head').boundingBox();
  const list = await page.locator('.wt-sheet').boundingBox(), beside = list.x + list.width <= map.x + 1;
  return { left: map.x, right: map.x + map.width, top: beside ? map.y : head.y + head.height, bottom: beside ? map.y + map.height : list.y };
}
const inside = (p, a, pad = 0) => p && p.x >= a.left + pad && p.x <= a.right - pad && p.y >= a.top + pad && p.y <= a.bottom - pad;
// Every pin of the day, in the part of the map you can see
async function pinsInView(page) {
  const a = await shown(page), pins = await page.locator('#map .wt-pin').all();
  const out = [];
  for (const p of pins) if (await p.isVisible()) out.push(inside(await center(p), a, 4));
  return out.length > 0 && out.every(Boolean);
}
const settled = page => page.waitForTimeout(1200); // a camera move takes under a second

test.beforeEach(async ({ page }) => {
  await page.goto('#/trip/white-sands');
  await expect(plan(page)).toBeVisible();
  await settled(page);
});

test('the day’s places have numbered pins, all of them clear of the list', async ({ page }) => {
  await expect(pin(page, /^1\. El Paso International Airport, Airport$/)).toBeVisible();
  await expect(pin(page, /^2\. Holiday Inn Express Alamogordo, Hotel$/)).toBeVisible();
  // the Visitor Center and the Boardwalk are a few km apart: one pin for both at the day's zoom
  await expect(pin(page, /^3–4\. 2 stops here: White Sands Visitor Center, Interdune Boardwalk$/)).toBeVisible();
  expect(await pinsInView(page)).toBe(true);
});

test('another day, and the overview, bring the camera to their places', async ({ page }) => {
  await plan(page).getByRole('tab', { name: 'Sat, Nov 21' }).click();
  await settled(page);
  await expect(pin(page, /New Mexico Museum of Space History/)).toBeVisible();
  await expect(pin(page, /Cloudcroft/)).toBeVisible();
  expect(await pinsInView(page)).toBe(true);
  await plan(page).getByRole('tab', { name: 'Overview' }).click();
  await settled(page);
  await expect(pin(page, /El Paso International Airport/).first()).toBeVisible();
  expect(await pinsInView(page)).toBe(true);
});

test('tapping a pin selects its stop and leaves the map where it is', async ({ page }) => {
  const before = await center(pin(page, /^1\. El Paso/));
  await pin(page, /^1\. El Paso/).click();
  await expect(row(page, 'El Paso International Airport')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map .wt-pin--selected')).toHaveAccessibleName(/El Paso International Airport/);
  await settled(page);
  const after = await center(pin(page, /^1\. El Paso/));
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(3);
});

test('tapping a stop in the list brings its pin up close, in the middle of the map you can see', async ({ page }) => {
  const a0 = await center(pin(page, /^1\. El Paso/)), b0 = await center(pin(page, /^2\. Holiday Inn/));
  await row(page, 'White Sands Visitor Center').click();
  await settled(page);
  const p = pin(page, /White Sands Visitor Center/);
  await expect(p).toHaveClass(/wt-pin--selected/);
  const a = await shown(page), c = await center(p);
  expect(Math.abs(c.x - (a.left + a.right) / 2)).toBeLessThan(12);
  expect(Math.abs(c.y - (a.top + a.bottom) / 2)).toBeLessThan(12);
  // closer in: the airport and the hotel, 125 km apart, no longer both fit
  const a1 = await center(pin(page, /^1\. El Paso/)), b1 = await center(pin(page, /^2\. Holiday Inn/));
  expect(!a1 || !b1 || Math.hypot(a1.x - b1.x, a1.y - b1.y) > 2 * Math.hypot(a0.x - b0.x, a0.y - b0.y)).toBe(true);
});

test('tapping a route shows that drive, and tapping empty map goes back', async ({ page }) => {
  const a = await center(pin(page, /^1\. El Paso/)), b = await center(pin(page, /^2\. Holiday Inn/));
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await expect(drive(page, 'Holiday Inn Express Alamogordo')).toHaveAttribute('aria-pressed', 'true');
  await expect(wholeDay(page)).toBeEnabled();
  await settled(page);
  // empty map: well away from the route and the pins
  const s = await shown(page);
  await page.mouse.click(s.right - 20, s.top + 20);
  await expect(drive(page, 'Holiday Inn Express Alamogordo')).toHaveAttribute('aria-pressed', 'false');
});

test('Whole day is greyed out while the map shows the day, and brings it back once you’ve moved the map', async ({ page }) => {
  await expect(wholeDay(page)).toBeDisabled();
  const s = await shown(page), x = (s.left + s.right) / 2, y = (s.top + s.bottom) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y - 60, { steps: 8 });
  await page.mouse.up();
  await expect(wholeDay(page)).toBeEnabled();
  expect(await pinsInView(page)).toBe(false);
  await wholeDay(page).click();
  await settled(page);
  await expect(wholeDay(page)).toBeDisabled();
  expect(await pinsInView(page)).toBe(true);
});

test('double-tapping the map zooms in a step', async ({ page }) => {
  const a0 = await center(pin(page, /^1\. El Paso/)), b0 = await center(pin(page, /^2\. Holiday Inn/));
  const s = await shown(page);
  await page.mouse.dblclick(s.right - 30, s.top + 30);
  await settled(page);
  const a1 = await center(pin(page, /^1\. El Paso/)), b1 = await center(pin(page, /^2\. Holiday Inn/));
  const k = Math.hypot(a1.x - b1.x, a1.y - b1.y) / Math.hypot(a0.x - b0.x, a0.y - b0.y);
  expect(k).toBeGreaterThan(1.9);
  expect(k).toBeLessThan(2.1);
});

test('up close, the map shows sights nearby, and tapping one opens its card', async ({ page, context }) => {
  // the prototype asks Overpass for a map tile's sights: one viewpoint, next to the Visitor Center
  await context.route(/overpass-api\.de|maps\.mail\.ru/, route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ elements: [{ type: 'node', id: 7, lat: 32.7745, lon: -106.1640, tags: { name: 'Dune Overlook', tourism: 'viewpoint' } }] }),
  }));
  await row(page, 'White Sands Visitor Center').click();
  const sight = page.locator('#map .wt-sight', { hasText: 'Dune Overlook' });
  await expect(sight).toBeVisible({ timeout: 10_000 });
  // and to the keyboard, a button that says what it is
  await expect(page.locator('#map [aria-label="Dune Overlook, Viewpoint. Show more"]')).toHaveCount(1);
  await sight.click();
  await expect(sheet(page).getByRole('heading', { name: 'Dune Overlook' })).toBeVisible();
});

test.describe('on a wide screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('the day’s pins are beside the plan, not under it', async ({ page }) => {
    await expect(pin(page, /^1\. El Paso/)).toBeVisible();
    expect(await pinsInView(page)).toBe(true);
  });
});

test('Want to go shows its places as hollow pins with no numbers, the trip’s stops faded around them; tapping one selects it', async ({ page }) => {
  await plan(page).getByRole('tab', { name: /^Want to go/ }).click();
  await settled(page);
  const oliver = pin(page, /^Oliver Lee Memorial State Park, Nature$/), rivers = pin(page, /^Three Rivers Petroglyph Site, Attraction$/);
  await expect(oliver).toHaveClass(/wt-pin--idea/);
  await expect(rivers).toHaveClass(/wt-pin--idea/);
  await expect(page.locator('#map .wt-pin .wt-pin__num')).toHaveCount(0);
  await expect(page.locator('#map .wt-pin--muted')).toHaveCount(0); // grey means over: the stops are faded instead
  const a = await shown(page);
  expect(inside(await center(oliver), a, 4) && inside(await center(rivers), a, 4)).toBe(true);
  await oliver.click();
  await expect(row(page, 'Oliver Lee Memorial State Park')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map .wt-pin--selected')).toHaveAccessibleName(/Oliver Lee Memorial State Park/);
  await expect(plan(page).getByRole('button', { name: 'Remove from Want to go' })).toBeVisible();
});

test('a day’s map shows the Want to go places nearest it, and one tapped there is added to that day', async ({ page }) => {
  // today: Oliver Lee, near the hotel; not Three Rivers, nearer Saturday's stops
  const oliver = pin(page, /^Oliver Lee Memorial State Park, Nature$/);
  await expect(oliver).toHaveClass(/wt-pin--idea/);
  await expect(pin(page, /^Three Rivers Petroglyph Site/)).toHaveCount(0);
  expect(await pinsInView(page)).toBe(true);
  await oliver.click();
  await plan(page).getByRole('button', { name: 'Add to this day' }).click();
  await expect(row(page, 'Oliver Lee Memorial State Park')).toHaveAttribute('aria-pressed', 'true');
  await expect(pin(page, /^\d+\. Oliver Lee Memorial State Park, Nature$/)).toBeVisible();
  await expect(page.locator('#map .wt-pin--idea')).toHaveCount(0);
});
