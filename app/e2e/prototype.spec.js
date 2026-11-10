// The shared frontend (app/web), run by the prototype on its seeded trips: White Sands, NM (Alex's, Nov 20–22, with
// Sam) and Big Bend in spring (Jo's, with Alex and Sam). You're Alex unless ?as= says otherwise. Each test starts from
// a fresh browser, so from the seed.
import { expect, question, sheet, test, toast } from './fixtures.js';

const trip = (page, id, as) => page.goto(`${as ? `?as=${as}` : ''}#/trip/${id}`);
const plan = page => page.getByRole('region', { name: 'Plan' });
const days = page => plan(page).getByRole('tablist', { name: 'Days' });
// Home's cards (a toast can say a trip's name too)
const cards = page => page.locator('#app');
const stop = (page, name) => plan(page).getByRole('button', { name: new RegExp(`^\\w+ ${name}`) }).first();

async function editNote(page, name, note) {
  await stop(page, name).click();
  await page.getByRole('button', { name: 'Edit stop' }).click();
  await sheet(page).getByRole('textbox', { name: 'Note' }).fill(note);
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page)).toBeHidden();
}

test('home lists your trips', async ({ page }) => {
  await page.goto('#/');
  await expect(cards(page).getByText('White Sands, NM')).toBeVisible();
  await expect(cards(page).getByText('Big Bend in spring')).toBeVisible();
});

test('a trip opens on today, with its stops in order and the drives between them', async ({ page }) => {
  await trip(page, 'white-sands');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('White Sands, NM');
  await expect(days(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Today, Nov 20');
  const rows = plan(page).getByRole('button', { name: /^(Airport|Hotel|Attraction|Nature) |drive to/ });
  await expect(rows).toHaveText([
    /El Paso International Airport/, /drive/, /Holiday Inn Express Alamogordo/, /drive/, /White Sands Visitor Center/,
    /drive/, /Interdune Boardwalk/, /drive/, /Holiday Inn Express Alamogordo/,
  ]);
});

test('the day tabs step through the trip, and the overview shows all of it', async ({ page }) => {
  await trip(page, 'white-sands');
  await days(page).getByRole('tab', { name: 'Sat, Nov 21' }).click();
  await expect(days(page).getByRole('tab', { name: 'Sat, Nov 21' })).toHaveAttribute('aria-selected', 'true');
  await expect(stop(page, 'New Mexico Museum of Space History')).toBeVisible();
  await expect(stop(page, 'White Sands Visitor Center')).toHaveCount(0);
  await days(page).getByRole('tab', { name: 'Overview' }).click();
  await expect(stop(page, 'White Sands Visitor Center')).toBeVisible();
  await expect(stop(page, 'Cloudcroft')).toBeVisible();
});

test('editing a stop saves it, and it’s still there after a reload', async ({ page }) => {
  await trip(page, 'white-sands');
  await editNote(page, 'White Sands Visitor Center', 'Bring sunscreen');
  await expect(stop(page, 'White Sands Visitor Center')).toContainText('Bring sunscreen');
  await page.reload();
  await expect(stop(page, 'White Sands Visitor Center')).toContainText('Bring sunscreen');
});

test('a co-editor’s change shows up in the other tab', async ({ page, context }) => {
  await trip(page, 'white-sands');
  const sam = await context.newPage();
  await trip(sam, 'white-sands', 'sam');
  await editNote(sam, 'Interdune Boardwalk', 'Meet at the car');
  await expect(stop(page, 'Interdune Boardwalk')).toContainText('Meet at the car');
  await expect(toast(page)).toContainText('Sam updated Interdune Boardwalk');
});

test('anyone but the owner can leave a trip, and the others are told', async ({ page, context }) => {
  const sam = await context.newPage();
  await trip(sam, 'big-bend', 'sam');
  await trip(page, 'big-bend');
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await expect(sheet(page).getByRole('listitem').filter({ hasText: 'Jo' })).toContainText('Owner');
  await expect(sheet(page).getByRole('button', { name: 'Delete trip' })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Leave trip' }).click();
  await question(page).getByRole('button', { name: 'Leave trip' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(cards(page).getByText('Big Bend in spring')).toHaveCount(0);
  await expect(toast(sam)).toContainText('Alex left');
});

test('the owner can delete a trip, and undo it', async ({ page }) => {
  await trip(page, 'white-sands');
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await sheet(page).getByRole('button', { name: 'Delete trip' }).click();
  await question(page).getByRole('button', { name: 'Delete trip' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(cards(page).getByText('White Sands, NM')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(cards(page).getByText('White Sands, NM')).toBeVisible();
});

test('Back closes a sheet rather than leaving the trip', async ({ page }) => {
  await trip(page, 'white-sands');
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(/#\/trip\/white-sands$/);
});

test('a trip saved for offline opens with no connection', async ({ page, context }) => {
  await trip(page, 'white-sands');
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await sheet(page).getByRole('button', { name: 'Save for offline' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Remove from this device' })).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('White Sands, NM');
  await expect(stop(page, 'White Sands Visitor Center')).toBeVisible();
});

test('after an update that adds a file, a saved trip’s app still opens offline, though only Home was opened online since', async ({ page, context }) => {
  await trip(page, 'white-sands');
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await sheet(page).getByRole('button', { name: 'Save for offline' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Remove from this device' })).toBeVisible({ timeout: 60_000 });
  // An update: the page loads one more module, as when the app gained geo.js
  const page2 = /\/prototype\/(\?.*)?$/;
  await context.route(page2, async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('</head>', '<link rel="modulepreload" href="../app/web/update-test.js">\n</head>') });
  });
  await context.route('**/app/web/app.js', async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `import './update-test.js';\n${await res.text()}` });
  });
  await context.route('**/app/web/update-test.js', route => route.fulfill({ contentType: 'text/javascript', body: "document.documentElement.dataset.updated = 'yes';" }));
  // Online, Home only: the saved trip isn't opened
  await page.goto('#/');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-updated', 'yes');
  await expect(cards(page).getByText('White Sands, NM')).toBeVisible();
  await page.waitForTimeout(1500);
  // Then no connection: the updated app, all of it, from what's saved on the phone (the server, updated, is out of reach)
  await context.unroute(page2);
  await context.unroute('**/app/web/app.js');
  await context.unroute('**/app/web/update-test.js');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-updated', 'yes');
  await expect(cards(page).getByText('White Sands, NM')).toBeVisible();
});


test('Home loads the map’s library while it’s idle, so a trip’s map doesn’t wait for it', async ({ page }) => {
  const isLib = u => u.endsWith('/vendor/maplibre/maplibre-gl.js');
  const lib = page.waitForResponse(r => isLib(r.url()));
  await page.goto('#/');
  await lib;
  await expect.poll(() => page.evaluate(() => !!window.maplibregl)).toBe(true);
  let again = false;
  page.on('request', r => { if (isLib(r.url())) again = true; });
  await cards(page).getByText('White Sands, NM').click();
  await expect(page.locator('#map .wt-pin').first()).toBeVisible();
  expect(again).toBe(false);
});

// Spots: the prototype's sample places (see spots in prototype/backend.js), most viewed first
const spotNames = page => page.locator('.wt-spot-card__name');
test('the nav goes between Plan and Spots, and Spots lists the guide’s places, most viewed first', async ({ page }) => {
  await page.goto('#/');
  const nav = page.getByRole('navigation', { name: 'Pages' });
  await expect(nav.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Spots' }).click();
  await expect(page).toHaveTitle('Spots · Dotsie');
  await expect(nav.getByRole('link', { name: 'Spots' })).toHaveAttribute('aria-current', 'page');
  await expect(spotNames(page)).toHaveText(['Space Needle', 'Pike Place Market', 'White Sands National Park', 'Stanley Park',
    'Chihuly Garden and Glass', 'Discovery Park', 'New Mexico Museum of Space History']);
  await expect(page.getByRole('link', { name: /^Space Needle/ })).toContainText('Seattle, WA · 1.9M views');
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
  await nav.getByRole('link', { name: 'Plan' }).click();
  await expect(cards(page).getByText('White Sands, NM')).toBeVisible();
});

test('spots can be searched and narrowed to a country, a state and a city', async ({ page }) => {
  await page.goto('#/spots');
  await expect(spotNames(page)).toHaveCount(7);
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('glass');
  await expect(spotNames(page)).toHaveText(['Chihuly Garden and Glass']);
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('nowhere at all');
  await expect(page.getByText('No spots match “nowhere at all”.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('');

  await page.getByRole('combobox', { name: 'Country' }).selectOption('US');
  await expect(spotNames(page)).toHaveCount(6);
  await page.getByRole('combobox', { name: 'State' }).selectOption('NM');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
  // The cities follow the state; picking a city sets its state
  await expect(page.getByRole('combobox', { name: 'City' }).locator('option')).toHaveText(['All cities', 'Alamogordo']);
  await page.getByRole('combobox', { name: 'State' }).selectOption('');
  await page.getByRole('combobox', { name: 'City' }).selectOption('seattle');
  await expect(page.getByRole('combobox', { name: 'State' })).toHaveValue('WA');
  await expect(spotNames(page)).toHaveText(['Space Needle', 'Pike Place Market', 'Chihuly Garden and Glass', 'Discovery Park']);
  // Another country drops a state and city it doesn't have
  await page.getByRole('combobox', { name: 'Country' }).selectOption('CA');
  await expect(page.getByRole('combobox', { name: 'State' })).toHaveValue('');
  await expect(spotNames(page)).toHaveText(['Stanley Park']);
});

test('a spot opens its guide entry, and All spots goes back to the list as it was', async ({ page }) => {
  await page.goto('#/spots');
  await page.getByRole('combobox', { name: 'State' }).selectOption('NM');
  await page.getByRole('link', { name: /White Sands National Park/ }).click();
  await expect(page).toHaveTitle('White Sands National Park · Spots · Dotsie');
  const entry = page.locator('article.wt-guide');
  await expect(entry.getByRole('heading', { level: 2 })).toHaveText('White Sands National Park');
  await expect(entry.getByText('Alamogordo, New Mexico')).toBeVisible();
  await expect(entry.locator('.wt-guide__para')).toHaveCount(2);
  await expect(entry.locator('.wt-guide__facts')).toContainText('Water, sun protection and a sled');
  await expect(entry.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /White%20Sands%20National%20Park/);
  await expect(entry.locator('.wt-guide__foot')).toContainText('Written by AI from Wikipedia, and published under CC BY-SA 4.0.');
  await page.getByRole('link', { name: 'All spots' }).click();
  await expect(page.getByRole('combobox', { name: 'State' })).toHaveValue('NM');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
});
