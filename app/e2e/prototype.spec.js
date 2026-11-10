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


// Want to go: the trip's places with no day yet. White Sands has Oliver Lee Memorial State Park (near its first day) and
// Three Rivers Petroglyph Site (near its second) on it.
const wish = page => plan(page).locator('.wt-tl-idea');
const wantToGo = page => days(page).getByRole('tab', { name: /^Want to go/ });
test('Want to go groups its places by the day each is nearest, and says how many there are', async ({ page }) => {
  await trip(page, 'white-sands');
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 2 places');
  await wantToGo(page).click();
  await expect(plan(page).locator('.wt-tl-day, .wt-tl-idea')).toHaveText([/Near Today, Nov 20/, /Oliver Lee Memorial State Park/, /Near Sat, Nov 21/, /Three Rivers Petroglyph Site/]);
  await plan(page).getByRole('button', { name: 'Near Sat, Nov 21. Open this day' }).click();
  await expect(days(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Sat, Nov 21');
});

test('a Want to go place gets a time only on a day: Add to this day puts it after the stop nearest it, and it comes off the list', async ({ page }) => {
  await trip(page, 'white-sands');
  // today's map has it, near the hotel, as a hollow pin
  await page.locator('#map .wt-pin--idea').filter({ visible: true }).and(page.getByRole('img', { name: /^Oliver Lee/ })).click();
  await plan(page).getByRole('button', { name: 'Add to this day' }).click();
  // after the hotel at 1:00 PM, halfway to the Visitor Center at 3:00 PM
  await expect(toast(page)).toContainText('Added to Fri, Nov 20, arriving at 2:00 PM');
  await expect(stop(page, 'Oliver Lee Memorial State Park')).toContainText('2:00');
  await expect(stop(page, 'Oliver Lee Memorial State Park')).toHaveAttribute('aria-pressed', 'true');
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 1 place');
  await page.reload();
  await wantToGo(page).click();
  await expect(wish(page)).toHaveText([/Three Rivers Petroglyph Site/]);
});

test('Add to a day, on Want to go, asks which day, the nearest saying so, and puts it there as Add to this day does', async ({ page }) => {
  await trip(page, 'white-sands');
  await wantToGo(page).click();
  await stop(page, 'Three Rivers Petroglyph Site').click();
  await plan(page).getByRole('button', { name: 'Add to a day' }).click();
  const days_ = sheet(page).getByRole('list', { name: 'Days' }).getByRole('button');
  await expect(days_).toHaveText([/Fri, Nov 20/, /Sat, Nov 21\s*Nearest · 2 stops/, /Sun, Nov 22/, /Another day/]);
  await days_.filter({ hasText: 'Sat, Nov 21' }).click();
  // after the museum at 9:30 AM, the stop nearest it, halfway to Cloudcroft at 12:30 PM
  await expect(toast(page)).toContainText('Added to Sat, Nov 21, arriving at 11:00 AM');
  await expect(days(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Sat, Nov 21');
  await expect(stop(page, 'Three Rivers Petroglyph Site')).toHaveAttribute('aria-pressed', 'true');
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 1 place');
});

test('a trip of saved places only, with no days yet, is planned from Want to go: Add to a day opens Add stop with the place in it', async ({ page }) => {
  await page.goto('#/spots/seattle/sample/pike-place-market');
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  await sheet(page).getByRole('button', { name: /^New trip: Seattle/ }).click();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await toast(page).getByRole('button', { name: 'Open' }).click();
  await expect(days(page).getByRole('tab')).toHaveCount(2); // Want to go and the overview: no days
  await stop(page, 'Pike Place Market').click();
  await plan(page).getByRole('button', { name: 'Add to a day' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Add stop' })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Place' })).toContainText('Pike Place Market');
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(stop(page, 'Pike Place Market')).toBeVisible();
  await expect(days(page).getByRole('tab')).toHaveCount(3);
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go');
});

test('a planned stop moves back to Want to go from its sheet, as only its place, and Undo puts it back on its day', async ({ page }) => {
  await trip(page, 'white-sands');
  await stop(page, 'White Sands Visitor Center').click();
  await page.getByRole('button', { name: 'Edit stop' }).click();
  await sheet(page).getByRole('button', { name: 'Move to Want to go' }).click();
  await expect(toast(page)).toContainText('Moved White Sands Visitor Center to Want to go');
  await expect(stop(page, 'White Sands Visitor Center')).toHaveCount(0);
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 3 places');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(stop(page, 'White Sands Visitor Center')).toContainText('Buy a sled');
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 2 places');
  // and again, kept: on the list, only the place, near the day it left
  await stop(page, 'White Sands Visitor Center').click();
  await page.getByRole('button', { name: 'Edit stop' }).click();
  await sheet(page).getByRole('button', { name: 'Move to Want to go' }).click();
  await wantToGo(page).click();
  await expect(plan(page).locator('.wt-tl-day, .wt-tl-idea')).toHaveText([/Near Today, Nov 20/, /Oliver Lee/, /^\s*White Sands Visitor Center\s*$/, /Near Sat, Nov 21/, /Three Rivers/]);
});

test('Want to go is an icon with a count; its places are only places, with nothing to add to them', async ({ page }) => {
  await trip(page, 'white-sands');
  await expect(wantToGo(page)).toHaveText('2');
  await expect(wantToGo(page).locator('svg')).toHaveCount(1);
  await wantToGo(page).click();
  await expect(wish(page)).toHaveText([/^\s*Oliver Lee Memorial State Park\s*$/, /^\s*Three Rivers Petroglyph Site\s*$/]);
});

test('Want to go is a plain list: a place selected has Add to a day, Open in Maps and Remove, which takes it off, with Undo, for everyone', async ({ page, context }) => {
  await trip(page, 'white-sands');
  const sam = await context.newPage();
  await trip(sam, 'white-sands', 'sam');
  await wantToGo(sam).click();
  await wantToGo(page).click();
  await stop(page, 'Three Rivers Petroglyph Site').click();
  await expect(plan(page).getByRole('link', { name: 'Open Three Rivers Petroglyph Site in your maps app' })).toBeVisible();
  await expect(plan(page).getByRole('button', { name: 'Add to a day' })).toBeVisible();
  await plan(page).getByRole('button', { name: 'Remove from Want to go' }).click();
  await expect(wish(page)).toHaveCount(1);
  await expect(wish(sam)).toHaveCount(1);
  await expect(toast(sam)).toContainText('Alex removed Three Rivers Petroglyph Site from Want to go');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(wish(page)).toHaveText([/Oliver Lee/, /Three Rivers/]);
  await expect(wish(sam)).toHaveText([/Oliver Lee/, /Three Rivers/]);
});

test('Add stop suggests the Want to go places first, and one picked there comes off the list', async ({ page }) => {
  await trip(page, 'white-sands');
  await plan(page).getByRole('button', { name: 'Add stop' }).click();
  const results = sheet(page).getByRole('listbox', { name: 'Places' });
  await expect(results.getByText('Want to go')).toBeVisible();
  await expect(results.getByRole('option')).toHaveText([/Oliver Lee Memorial State Park/, /Three Rivers Petroglyph Site/]);
  await results.getByRole('option', { name: /Three Rivers/ }).click();
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(stop(page, 'Three Rivers Petroglyph Site')).toBeVisible();
  await wantToGo(page).click();
  await expect(wish(page)).toHaveText([/Oliver Lee Memorial State Park/]);
});

test('a new trip opens on Want to go, where planning starts', async ({ page }) => {
  await page.goto('#/');
  await page.getByRole('button', { name: 'New trip' }).locator('visible=true').first().click();
  await sheet(page).getByRole('textbox', { name: 'Trip name' }).fill('Seattle weekend');
  await sheet(page).getByRole('button', { name: 'Create' }).click();
  await expect(days(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Want to go');
  await expect(plan(page)).toContainText('Places you’d like to go, before you know when.');
  await expect(plan(page).getByRole('button', { name: 'Save place' })).toBeVisible();
  await days(page).getByRole('tab', { name: 'Overview' }).click();
  await expect(plan(page).getByRole('button', { name: 'Add stop' })).toBeVisible();
});

// Saving spots: the sheet of trips is checkboxes, so a spot can be on several, and saving is undone by unticking
// A closed sheet takes its history entry a moment later (see closeSheet): wait for that before going anywhere, or it
// takes the step back from the page gone to
const sheetGone = page => expect.poll(() => page.evaluate(() => !history.state?.wtSheet)).toBe(true);
const tripBox = (page, name) => sheet(page).getByRole('checkbox', { name: new RegExp(`^${name}`) });
test('a spot’s page has Save to a trip floating at the bottom; Open, once saved, opens the trip on Want to go', async ({ page }) => {
  await page.goto('#/spots/alamogordo/sample/white-sands');
  const save = page.getByRole('button', { name: 'Save to a trip' });
  await expect(save).toBeInViewport();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(save).toBeInViewport();
  await save.click();
  await tripBox(page, 'White Sands, NM').click();
  await expect(tripBox(page, 'White Sands, NM')).toHaveAttribute('aria-checked', 'true');
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('Saved to Want to go');
  await expect(toast(page)).toContainText('White Sands, NM');
  // it says Saved, not where: a spot can be on several trips, and a trip's name can read as a place's
  await expect(page.getByRole('button', { name: 'Saved to White Sands, NM. Change' })).toHaveText('Saved');
  await toast(page).getByRole('button', { name: 'Open' }).click();
  await expect(days(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Want to go, 3 places');
  // the national park is near the first day, with the visitor center
  await expect(wish(page)).toHaveText([/Oliver Lee/, /White Sands National Park/, /Three Rivers/]);
});

test('a spot can be saved to several trips, a new one too, and unticking one takes it off again', async ({ page }) => {
  await page.goto('#/spots/seattle/sample/space-needle');
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  await tripBox(page, 'White Sands, NM').click();
  await sheet(page).getByRole('button', { name: /^New trip: Seattle/ }).click();
  await expect(tripBox(page, 'Seattle')).toHaveAttribute('aria-checked', 'true');
  await expect(tripBox(page, 'White Sands, NM')).toHaveAttribute('aria-checked', 'true');
  // there's a Seattle now, so no second one is offered, and it takes the new button's focus
  await expect(sheet(page).getByRole('button', { name: /^New trip/ })).toHaveCount(0);
  await expect(tripBox(page, 'Seattle')).toBeFocused();
  // ticked trips show their checks, not grey rows that run together (with the pointer off them, as a finger is)
  await page.mouse.move(0, 0);
  await expect(tripBox(page, 'Seattle')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('Saved to Want to go');
  await expect(toast(page)).toContainText('On 2 trips');
  await expect(page.getByRole('button', { name: 'Saved to 2 trips. Change' })).toHaveText('Saved');
  // off White Sands again: the sheet shows where it is, and a tick takes it off
  await page.getByRole('button', { name: 'Saved to 2 trips. Change' }).click();
  await tripBox(page, 'White Sands, NM').click();
  await expect(tripBox(page, 'White Sands, NM')).toHaveAttribute('aria-checked', 'false');
  await expect(sheet(page).getByRole('checkbox')).toHaveCount(2);
  await expect(sheet(page).getByRole('button', { name: /^New trip/ })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('Removed from Want to go');
  await expect(toast(page)).toContainText('White Sands, NM');
  await expect(page.getByRole('button', { name: 'Saved to Seattle. Change' })).toBeVisible();
  await sheetGone(page);
  await trip(page, 'white-sands');
  await expect(days(page).getByRole('tab', { name: /^Want to go/ })).toHaveAccessibleName('Want to go, 2 places');
});

test('a spot already planned on a trip is saved to it: ticked, with its day, and not taken off its day from here', async ({ page }) => {
  // White Sands has the museum on Saturday
  await page.goto('#/spots/alamogordo/sample/museum-of-space-history');
  const saved = page.getByRole('button', { name: 'Saved to White Sands, NM. Change' });
  await expect(saved).toHaveText('Saved');
  await saved.click();
  await expect(tripBox(page, 'White Sands, NM')).toHaveAttribute('aria-checked', 'true');
  await expect(tripBox(page, 'White Sands, NM')).toContainText('Planned for Sat, Nov 21');
  await tripBox(page, 'White Sands, NM').click();
  await expect(toast(page)).toContainText('Planned for Sat, Nov 21');
  await expect(tripBox(page, 'White Sands, NM')).toHaveAttribute('aria-checked', 'true');
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await sheetGone(page);
  await trip(page, 'white-sands');
  await expect(wantToGo(page)).toHaveAccessibleName('Want to go, 2 places');
  await page.goto('#/spots?q=museum');
  await expect(page.getByRole('button', { name: 'Saved to White Sands, NM. Change' })).toHaveAttribute('aria-pressed', 'true');
});

test('each spot’s card has a bookmark that saves it without leaving the list, filled once it’s saved', async ({ page }) => {
  await page.goto('#/spots');
  const bookmark = page.getByRole('button', { name: 'Save Pike Place Market to a trip' });
  await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
  await bookmark.click();
  const pike = page.locator('[data-spot-save="seattle/sample/pike-place-market"]');
  await tripBox(page, 'White Sands, NM').click();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/spots$/);
  await expect(pike).toHaveAccessibleName('Saved to White Sands, NM. Change');
  await expect(pike).toHaveAttribute('aria-pressed', 'true');
  // and after a reload, from the trips themselves
  await sheetGone(page);
  await page.reload();
  await expect(pike).toHaveAccessibleName('Saved to White Sands, NM. Change');
  await expect(pike).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Save Space Needle to a trip' })).toHaveAttribute('aria-pressed', 'false');
});

test('a trip of saved places only shows them on its Home card: their dots for a sketch, and their photos asked for', async ({ page }) => {
  await page.goto('#/spots/seattle/sample/pike-place-market');
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  await sheet(page).getByRole('button', { name: /^New trip: Seattle/ }).click();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await sheetGone(page);
  // the photo's looked up by the place's name, as for a stop found by search; it needn't come, offline or blocked
  const asked = page.waitForRequest(r => /Pike(\+|%20| )Place/.test(r.url()));
  await page.route(/wikipedia\.org|wikidata\.org|wikimedia\.org/, route => route.abort());
  await page.goto('#/');
  await asked;
  const card = page.locator('.wt-trip-card').filter({ hasText: 'Seattle' });
  await expect(card.locator('.wt-trip-card__stop')).toHaveCount(1);
  await expect(card).not.toContainText('No stops yet');
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
  await expect(page.getByRole('link', { name: /^Space Needle/ })).toContainText('Seattle, WA');
  await expect(page.getByRole('status').filter({ hasText: 'spots' })).toHaveText('7 spots');
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
  // In a city, the guide's own order, not the views'
  await expect(spotNames(page)).toHaveText(['Pike Place Market', 'Space Needle', 'Chihuly Garden and Glass', 'Discovery Park']);
  await expect(page.getByText('In the guide’s order for Seattle')).toBeVisible();
  // The address keeps what's asked, so a reload (or a link) shows the same
  await expect(page).toHaveURL(/#\/spots\?country=US&state=WA&city=seattle$/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'City' })).toHaveValue('seattle');
  await expect(spotNames(page)).toHaveCount(4);
  // Another country drops a state and city it doesn't have
  await page.getByRole('combobox', { name: 'Country' }).selectOption('CA');
  await expect(page.getByRole('combobox', { name: 'State' })).toHaveValue('');
  await expect(spotNames(page)).toHaveText(['Stanley Park']);
});

test('the search finds a city’s and a state’s spots by their names, and clears', async ({ page }) => {
  await page.goto('#/spots');
  const search = page.getByRole('searchbox', { name: 'Search spots' });
  await search.fill('seattle');
  await expect(spotNames(page)).toHaveCount(4);
  await search.fill('new mexico');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
  await search.fill('nm');
  await expect(spotNames(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');
  await expect(spotNames(page)).toHaveCount(7);
});

test('the search and the filters stay at the top as the spots scroll; on a phone the app bar tucks away going down', async ({ page }) => {
  await page.goto('#/spots');
  await expect(spotNames(page)).toHaveCount(7);
  const bar = page.locator('.wt-app-bar'), search = page.getByRole('searchbox', { name: 'Search spots' });
  // A filter shows what it's set to
  await page.getByRole('combobox', { name: 'State' }).selectOption('WA');
  await expect(page.locator('.wt-filter.is-set .wt-filter__value')).toHaveText('Washington');
  await page.getByRole('combobox', { name: 'State' }).selectOption('');
  await expect(page.locator('[data-filter="state"] .wt-filter__value')).toHaveText('State');
  await expect(spotNames(page)).toHaveCount(7);
  await page.mouse.wheel(0, 400);
  await expect(bar).not.toBeInViewport();
  await expect(search).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'State' })).toBeInViewport();
  await page.mouse.wheel(0, -60);
  await expect(bar).toBeInViewport();
  // On a computer, the bar stays
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.mouse.wheel(0, 2000);
  await expect(bar).toBeInViewport();
  await expect(search).toBeInViewport();
  const b = await bar.boundingBox(), s = await search.boundingBox();
  expect(s.y).toBeGreaterThanOrEqual(b.y + b.height); // just under it, not under it
});

test('a spot opens its guide entry, a page of its own with its sources and links at the end, and back goes to the list as it was', async ({ page }) => {
  await page.goto('#/spots');
  await page.getByRole('combobox', { name: 'State' }).selectOption('NM');
  await page.getByRole('link', { name: /White Sands National Park/ }).click();
  await expect(page).toHaveTitle('White Sands National Park · Spots · Dotsie');
  // No app bar: the page is the guide
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeHidden();
  const entry = page.locator('article.wt-guide');
  await expect(entry.getByRole('heading', { level: 1 })).toHaveText('White Sands National Park');
  await expect(entry.getByText('Alamogordo, New Mexico')).toBeVisible();
  await expect(entry.locator('.wt-guide__body p')).toHaveCount(2);
  await expect(entry.locator('.wt-guide__facts')).toContainText('Water, sun protection and a sled');
  // Sources and links: the Wikipedia article and the maps app, once each
  const links = entry.locator('.wt-guide__link');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/White_Sands_National_Park');
  await expect(entry.getByRole('link', { name: /^Google Maps/ })).toHaveAttribute('href', /White%20Sands%20National%20Park/);
  await expect(entry.locator('.wt-guide__foot')).toContainText('Written by AI from the sources above, and published under CC BY-SA 4.0.');
  await page.getByRole('link', { name: 'All spots' }).click();
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'State' })).toHaveValue('NM');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
});
