// The shared frontend (app/web), run by the prototype on its seeded trips: White Sands, NM (Alex's, Nov 20–22, with
// Sam), Big Bend in spring (Jo's, with Alex and Sam) and Utah’s parks (Alex's, with Jo: saved places only, no stops).
// You're Alex unless ?as= says otherwise. Each test starts from a fresh browser, so from the seed.
import { expect, filterChip, filterMenu, pickFilter, question, sheet, test, toast } from './fixtures.js';

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

test('home groups the trips: Current, then the Wishlist of trips with saved places only, then Past, each of the last two in small cards two to a row once it has two', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('#/');
  const group = title => page.locator('.home-group').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(page.locator('.home-group__title')).toHaveText(['Current', 'Wishlist', 'Past']);
  const current = group('Current').locator('.wt-trip-card');
  await expect(current).toHaveText([/White Sands, NM/]); // the tests' today is Nov 20
  const wish = group('Wishlist').locator('.wt-trip-card');
  await expect(wish).toHaveText([/Utah’s parks/]);
  await expect(wish).toContainText('2 saved places');
  await expect(wish.locator('.wt-trip-card__stop')).toHaveCount(2);
  const past = group('Past').locator('.wt-trip-card');
  await expect(past).toHaveText([/Big Bend in spring/]);
  // one on its own takes the whole row, as any card does
  const width = async l => (await l.boundingBox()).width;
  expect(await width(wish)).toBeCloseTo(await width(current), 0);
  expect(await width(past)).toBeCloseTo(await width(current), 0);
  await expect(wish.locator('.wt-trip-card__people')).toBeVisible();
  // a second trip of saved places only: the wishlist's cards go small, two to a row, with no avatars (the names are
  // still said); Past, with one, stays as it was
  await page.goto('#/spots/seattle/sample/pike-place-market');
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  await sheet(page).getByRole('button', { name: /^New trip: Seattle/ }).click();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await sheetGone(page);
  await page.goto('#/');
  await expect(wish).toHaveText([/Seattle/, /Utah’s parks/]);
  const [a, b] = await Promise.all([wish.nth(0).boundingBox(), wish.nth(1).boundingBox()]);
  expect(a.width).toBeLessThan(await width(current) / 2);
  expect(b.y).toBeCloseTo(a.y, 0);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  await expect(wish.locator('.wt-trip-card__people')).toHaveCount(2);
  await expect(wish.locator('.wt-trip-card__people').first()).toBeHidden();
  await expect(wish.nth(1)).toContainText('with Alex, Jo');
  expect(await width(past)).toBeCloseTo(await width(current), 0);
  // and they open like any card
  await wish.nth(1).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Utah’s parks');
});

test('New trip floats at the bottom of Home, in reach however far down the trips you are, and the last card scrolls clear of it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto('#/');
  const add = page.getByRole('button', { name: 'New trip' });
  await expect(add).toBeInViewport();
  const at = async () => (await add.boundingBox()).y + (await add.boundingBox()).height;
  expect(await at()).toBeGreaterThan(520 - 40);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(add).toBeInViewport();
  const last = page.locator('.wt-trip-card').last();
  expect((await last.boundingBox()).y + (await last.boundingBox()).height).toBeLessThan((await add.boundingBox()).y);
  await add.click();
  await expect(sheet(page)).toBeVisible();
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
  await expect(sheet(page).getByRole('checkbox')).toHaveCount(3); // and Utah’s parks, with no dates
  await expect(sheet(page).getByRole('button', { name: /^New trip/ })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('Removed from Want to go');
  await expect(toast(page)).toContainText('White Sands, NM');
  await expect(page.getByRole('button', { name: 'Saved to Seattle. Change' })).toBeVisible();
  await sheetGone(page);
  await trip(page, 'white-sands');
  await expect(days(page).getByRole('tab', { name: /^Want to go/ })).toHaveAccessibleName('Want to go, 2 places');
});

test('the new trip can be named in place before it’s made, and Esc puts the row back', async ({ page }) => {
  await page.goto('#/spots/seattle/sample/space-needle');
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  // the pencil turns New trip into a field holding the city's name, selected, so typing replaces it
  await sheet(page).getByRole('button', { name: 'Name the new trip' }).click();
  const name = sheet(page).getByRole('textbox', { name: 'New trip’s name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Seattle');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();
  await expect(name).toHaveCount(0);
  await expect(sheet(page).getByRole('button', { name: 'Name the new trip' })).toBeFocused();
  await page.keyboard.press('Enter');
  await name.fill('Pacific Northwest 2027');
  await name.press('Enter');
  await expect(tripBox(page, 'Pacific Northwest 2027')).toHaveAttribute('aria-checked', 'true');
  await expect(tripBox(page, 'Pacific Northwest 2027')).toBeFocused();
  // no trip is called Seattle yet, so New trip stays, as it was
  await expect(sheet(page).getByRole('button', { name: 'New trip: Seattle' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('Pacific Northwest 2027');
  await sheetGone(page);
  await page.goto('#/');
  await expect(cards(page).getByText('Pacific Northwest 2027')).toBeVisible();
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

  await pickFilter(page, 'country', 'United States');
  await expect(spotNames(page)).toHaveCount(6);
  await pickFilter(page, 'state', 'New Mexico');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
  // The cities follow the state; picking a city sets its state
  await filterChip(page, 'city').locator('.wt-filter__open').click();
  await expect(filterMenu(page).locator('.wt-option__label')).toHaveText(['All cities', 'Alamogordo']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear State' }).click();
  await pickFilter(page, 'city', 'Seattle, WA');
  await expect(filterChip(page, 'state').locator('.wt-filter__value')).toHaveText('Washington');
  // In a city, the guide's own order, not the views'
  await expect(spotNames(page)).toHaveText(['Pike Place Market', 'Space Needle', 'Chihuly Garden and Glass', 'Discovery Park']);
  await expect(page.getByText('In the guide’s order for Seattle')).toBeVisible();
  // The address keeps what's asked, so a reload (or a link) shows the same
  await expect(page).toHaveURL(/#\/spots\?country=US&state=WA&city=seattle$/);
  await page.reload();
  await expect(filterChip(page, 'city').locator('.wt-filter__value')).toHaveText('Seattle');
  await expect(spotNames(page)).toHaveCount(4);
  // Another country drops a state and city it doesn't have
  await pickFilter(page, 'country', 'Canada');
  await expect(filterChip(page, 'state')).not.toHaveClass(/is-set/);
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

test('spots can be narrowed to a type, each saying how many of the spots asked for are of it, and Clear all clears them', async ({ page }) => {
  await page.goto('#/spots');
  const type = filterChip(page, 'kind'), options = filterMenu(page).getByRole('radio');
  await type.locator('.wt-filter__open').click();
  await expect(options).toHaveText(['All types', 'Nature & parks4', 'Museums & art2', 'Landmarks & views1', 'History2', 'Markets & food1', 'Fun & shows0']);
  await expect(options.filter({ hasText: 'Fun & shows' })).toBeDisabled(); // none to show
  await page.keyboard.press('Escape');
  await pickFilter(page, 'kind', 'Museums & art');
  await expect(spotNames(page)).toHaveText(['Chihuly Garden and Glass', 'New Mexico Museum of Space History']);
  await expect(page.locator('[data-filter="kind"] .wt-filter__value')).toHaveText('Museums & art'); // the chip, without the count
  await expect(page).toHaveURL(/#\/spots\?kind=museums$/);
  // The counts follow the other filters and the search
  await pickFilter(page, 'state', 'Washington');
  await expect(spotNames(page)).toHaveText(['Chihuly Garden and Glass']);
  await type.locator('.wt-filter__open').click();
  await expect(options).toHaveText(['All types', 'Nature & parks2', 'Museums & art1', 'Landmarks & views1', 'History1', 'Markets & food1', 'Fun & shows0']);
  await expect(options.filter({ hasText: 'Museums & art' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  // Clear all, once two things are set: back to every spot
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(spotNames(page)).toHaveCount(7);
  await expect(page).toHaveURL(/#\/spots$/);
  await expect(type).not.toHaveClass(/is-set/);
  await expect(page.getByRole('button', { name: 'Clear all' })).toBeHidden();
});

test('a set filter clears with its ×, and a list with none to show offers to clear the filters', async ({ page }) => {
  await page.goto('#/spots');
  await pickFilter(page, 'state', 'Washington');
  await expect(spotNames(page)).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Clear all' })).toBeHidden(); // one thing set: its × is enough
  await page.getByRole('button', { name: 'Clear State' }).click();
  await expect(spotNames(page)).toHaveCount(7);
  await expect(filterChip(page, 'state').locator('.wt-filter__value')).toHaveText('State');
  await expect(filterChip(page, 'state').locator('.wt-filter__open')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear State' })).toBeHidden();

  await page.goto('#/spots?kind=landmarks&state=NM');
  await expect(page.getByText('No spots fit these filters yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(spotNames(page)).toHaveCount(7);
  // With a search, Clear filters keeps it
  await page.goto('#/spots?q=glass&state=NM');
  await expect(page.getByText('No spots match “glass” with these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(spotNames(page)).toHaveText(['Chihuly Garden and Glass']);
  await expect(page.getByRole('searchbox', { name: 'Search spots' })).toHaveValue('glass');
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('nowhere at all');
  await page.getByRole('button', { name: 'Clear search' }).last().click();
  await expect(spotNames(page)).toHaveCount(7);
});

test('spots can be sorted A to Z, and nearest first, saying how far each is; in a city, by the guide or by views', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 47.6062, longitude: -122.3321 }); // downtown Seattle
  await page.goto('#/spots');
  const chip = filterChip(page, 'sort');
  await expect(chip.locator('.wt-filter__value')).toHaveText('Most viewed');
  await chip.locator('.wt-filter__open').click();
  await expect(filterMenu(page).getByRole('radio')).toHaveText(['Most viewed', 'Nearest', 'A to Z']);
  await expect(filterMenu(page).getByRole('radio', { name: 'Most viewed' })).toHaveAttribute('aria-checked', 'true');
  await filterMenu(page).getByRole('radio', { name: 'A to Z' }).click();
  await expect(spotNames(page)).toHaveText(['Chihuly Garden and Glass', 'Discovery Park', 'New Mexico Museum of Space History', 'Pike Place Market',
    'Space Needle', 'Stanley Park', 'White Sands National Park']);
  await expect(chip).toHaveClass(/is-set/);
  await expect(page).toHaveURL(/#\/spots\?sort=name$/);

  await pickFilter(page, 'sort', 'Nearest');
  await expect(spotNames(page)).toHaveText(['Pike Place Market', 'Space Needle', 'Chihuly Garden and Glass', 'Discovery Park', 'Stanley Park',
    'White Sands National Park', 'New Mexico Museum of Space History']);
  await expect(page.getByRole('link', { name: /^Pike Place Market/ })).toContainText('Seattle, WA · 0.6 mi');
  await expect(page.getByRole('link', { name: /^Stanley Park/ })).toContainText('Vancouver, BC · 123 mi');
  await expect(page.getByText('Nearest first, as the crow flies')).toBeVisible();
  // The address says nearest, not where you are: a link sent asks the one who opens it
  await expect(page).toHaveURL(/#\/spots\?sort=near$/);
  await page.reload();
  await expect(spotNames(page).first()).toHaveText('Pike Place Market');

  // A city: the guide's order first, or by views; without the city, most viewed is the usual order again
  await page.goto('#/spots?city=seattle');
  await expect(chip.locator('.wt-filter__value')).toHaveText('Guide’s order');
  await expect(chip).not.toHaveClass(/is-set/);
  await pickFilter(page, 'sort', 'Most viewed');
  await expect(spotNames(page)).toHaveText(['Space Needle', 'Pike Place Market', 'Chihuly Garden and Glass', 'Discovery Park']);
  await expect(page).toHaveURL(/#\/spots\?city=seattle&sort=views$/);
  await page.getByRole('button', { name: 'Clear City' }).click();
  await expect(chip.locator('.wt-filter__value')).toHaveText('Most viewed');
  await expect(page).toHaveURL(/#\/spots$/);
});

test('a filter drops its choices down just under it, the phone’s width on a phone; a tap outside or Esc closes it as it was', async ({ page }) => {
  await page.goto('#/spots');
  await expect(spotNames(page)).toHaveCount(7);
  const chip = filterChip(page, 'state'), open = chip.locator('.wt-filter__open'), menu = filterMenu(page);
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('radio', { name: 'All states' })).toBeFocused(); // the one it's set to
  // On a phone, under the row of filters and across the column, whichever filter it's from
  const c = await chip.boundingBox(), m = await menu.boundingBox(), vw = page.viewportSize().width;
  expect(m.y).toBeGreaterThanOrEqual(c.y + c.height);
  expect(m.y).toBeLessThan(c.y + c.height + 12);
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(vw);
  expect(m.width).toBeGreaterThan(vw - 40);
  // ↓ ↑ move between the choices; Return picks one
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('radio').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  // A tap outside closes it with nothing changed; a tap on another filter opens that one instead
  await open.click();
  await page.getByRole('searchbox', { name: 'Search spots' }).click();
  await expect(menu).toHaveCount(0);
  await open.click();
  await filterChip(page, 'kind').locator('.wt-filter__open').click();
  await expect(menu).toHaveCount(1);
  await expect(menu.getByRole('radiogroup')).toHaveAttribute('aria-label', 'Type');
  await page.keyboard.press('Escape');
  await expect(spotNames(page)).toHaveCount(7);
  await expect(page).toHaveURL(/#\/spots$/);
  // On a computer, under the filter itself, lined up with it
  await page.setViewportSize({ width: 1280, height: 800 });
  await open.click();
  const c2 = await chip.boundingBox(), m2 = await menu.boundingBox();
  expect(Math.min(Math.abs(m2.x - c2.x), Math.abs(m2.x + m2.width - c2.x - c2.width))).toBeLessThan(2); // lined up with it
  expect(m2.y).toBeGreaterThanOrEqual(c2.y + c2.height);
  expect(m2.width).toBeLessThan(400);
  await menu.getByRole('radio', { name: 'Washington' }).click();
  await expect(spotNames(page)).toHaveCount(4);
  await expect(menu).toHaveCount(0);
});

test('if the browser can’t say where you are, the order stays as it was, and a toast says why', async ({ page }) => {
  // Location turned down: what a browser says when you block it (left to itself, headless Chromium may not answer)
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1, PERMISSION_DENIED: 1 }), 50);
  });
  await page.goto('#/spots');
  await expect(spotNames(page)).toHaveCount(7);
  await pickFilter(page, 'sort', 'Nearest');
  const why = page.locator('.wt-toast').filter({ hasText: 'Couldn’t tell where you are' }); // an alert: it's an error
  await expect(why).toBeVisible();
  await expect(page.locator('[data-filter="sort"] .wt-filter__value')).toHaveText('Most viewed');
  await expect(page).toHaveURL(/#\/spots$/);
  await expect(spotNames(page).first()).toHaveText('Space Needle');
  await expect(why).toContainText('allow location for Dotsie');
});

test('the search and the filters stay at the top as the spots scroll; on a phone the app bar tucks away going down', async ({ page }) => {
  await page.goto('#/spots');
  await expect(spotNames(page)).toHaveCount(7);
  const bar = page.locator('.wt-app-bar'), search = page.getByRole('searchbox', { name: 'Search spots' });
  // A filter shows what it's set to
  await pickFilter(page, 'state', 'Washington');
  await expect(page.locator('.wt-filter.is-set .wt-filter__value')).toHaveText('Washington');
  await pickFilter(page, 'state', 'All states');
  await expect(page.locator('[data-filter="state"] .wt-filter__value')).toHaveText('State');
  await expect(spotNames(page)).toHaveCount(7);
  await page.mouse.wheel(0, 400);
  await expect(bar).not.toBeInViewport();
  await expect(search).toBeInViewport();
  await expect(filterChip(page, 'state')).toBeInViewport();
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
  await pickFilter(page, 'state', 'New Mexico');
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
  await expect(filterChip(page, 'state').locator('.wt-filter__value')).toHaveText('New Mexico');
  await expect(spotNames(page)).toHaveText(['White Sands National Park', 'New Mexico Museum of Space History']);
});
