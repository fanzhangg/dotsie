// What only the product has: signing in, the server's API and the live socket between two people. Each test makes
// its own accounts and trips, so they run on a database that isn't empty.
import { expect, filterChip, filterMenu, pickFilter, question, sheet, test, toast } from './fixtures.js';

const plan = page => page.getByRole('region', { name: 'Plan' });
const stop = (page, name) => plan(page).getByRole('button', { name: new RegExp(`^\\w+ ${name}`) }).first();

async function guest(page, name, { joining = false } = {}) {
  await page.getByRole('button', { name: joining ? 'Join as a guest' : 'Continue as a guest' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: joining ? 'Join the trip' : 'Continue', exact: true }).click();
}
async function newTrip(page, name) {
  await page.getByRole('button', { name: 'New trip' }).locator('visible=true').first().click();
  await sheet(page).getByRole('textbox', { name: 'Trip name' }).fill(name);
  await sheet(page).getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return page.url().split('/').pop();
}
// Place search needs Stadia or OpenStreetMap, which tests can't reach, so stops go in through the API
async function addStop(page, tripId, id, fields) {
  const res = await page.request.put(`/api/trips/${tripId}/stops/${id}`, { data: fields, headers: { Origin: new URL(page.url()).origin } });
  expect(res.ok()).toBe(true);
}

test('a guest makes a trip, and its stops show in order', async ({ page }) => {
  await page.goto('/');
  await guest(page, 'Alex');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  const id = await newTrip(page, 'Dunes weekend');
  await addStop(page, id, 'stopaaaa2', { name: 'Interdune Boardwalk', lat: 32.793, lng: -106.211, time: '2026-11-20T16:30', kind: 'nature' });
  await addStop(page, id, 'stopaaaa1', { name: 'White Sands Visitor Center', lat: 32.7797, lng: -106.1717, time: '2026-11-20T15:00', kind: 'attraction' });
  await page.reload();
  await expect(plan(page).getByRole('button', { name: /^(Attraction|Nature) / })).toHaveText([/White Sands Visitor Center/, /Interdune Boardwalk/]);
  await page.goto('/#/');
  await expect(page.getByText('Dunes weekend')).toBeVisible();
});

test('a new trip opens on Want to go; a place saved there is added from the plan, and the server takes it off the list', async ({ page }) => {
  await page.goto('/');
  await guest(page, 'Alex');
  const id = await newTrip(page, 'Someday dunes');
  await expect(plan(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Want to go');
  const origin = { Origin: new URL(page.url()).origin };
  const put = await page.request.put(`/api/trips/${id}/ideas/ideaaaaa1`, { data: { name: 'Oliver Lee Memorial State Park', lat: 32.7486, lng: -105.9145, kind: 'nature', note: 'Dog Canyon trail', time: '2026-11-20T09:00' }, headers: origin });
  // only the place: its note and time are dropped
  expect(await put.json()).toMatchObject({ id: 'ideaaaaa1', name: 'Oliver Lee Memorial State Park', kind: 'nature', wikidata: null });
  for (const k of ['time', 'note', 'links']) expect(await put.json()).not.toHaveProperty(k);
  expect((await page.request.put(`/api/trips/${id}/ideas/ideaaaaa2`, { data: { name: 'No place' }, headers: origin })).status()).toBe(400);
  await page.reload();
  await expect(stop(page, 'Oliver Lee Memorial State Park')).toBeVisible();
  // it gets a day and a time from the plan, not from Want to go: Add stop, on the overview, suggests it first
  await plan(page).getByRole('tab', { name: 'Overview' }).click();
  await plan(page).getByRole('button', { name: 'Add stop' }).click();
  await sheet(page).getByRole('option', { name: /Oliver Lee Memorial State Park/ }).click();
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(stop(page, 'Oliver Lee Memorial State Park')).toBeVisible();
  await expect(plan(page).getByRole('tab', { selected: true })).not.toHaveAccessibleName('Want to go');
  await expect.poll(async () => (await (await page.request.get(`/api/trips/${id}`)).json()).ideas).toEqual([]);
  const { stops } = await (await page.request.get(`/api/trips/${id}`)).json();
  expect(stops).toMatchObject([{ name: 'Oliver Lee Memorial State Park', kind: 'nature', note: '' }]);
});

test('someone joins with the share link, and each sees the other’s changes live', async ({ page, newContext }) => {
  await page.goto('/');
  await guest(page, 'Alex');
  const id = await newTrip(page, 'Shared trip');
  await addStop(page, id, 'stopbbbb1', { name: 'White Sands Visitor Center', lat: 32.7797, lng: -106.1717, time: '2026-11-20T15:00', kind: 'attraction' });
  await page.reload();
  await page.getByRole('button', { name: 'Trip settings and sharing' }).click();
  const link = sheet(page).getByRole('textbox', { name: 'Trip link' });
  await expect(link).toHaveValue(/#\/join\//);
  const url = await link.inputValue();
  await sheet(page).getByRole('button', { name: 'Close' }).click();

  // Sam, in a browser of their own
  const sam = await (await newContext()).newPage();
  await sam.goto(url);
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Join Shared trip');
  await guest(sam, 'Sam', { joining: true });
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Shared trip');
  await expect(toast(page)).toContainText('Sam joined');

  // Sam's edit reaches Alex over the socket
  await stop(sam, 'White Sands Visitor Center').click();
  await sam.getByRole('button', { name: 'Edit stop' }).click();
  await sheet(sam).getByRole('textbox', { name: 'Note' }).fill('Buy a sled');
  await sheet(sam).getByRole('button', { name: 'Save' }).click();
  await expect(stop(page, 'White Sands Visitor Center')).toContainText('Buy a sled');
  await expect(toast(page)).toContainText('Sam updated White Sands Visitor Center');

  // Sam leaves: it's off Sam's home, and Alex is told
  await sam.getByRole('button', { name: 'Trip settings and sharing' }).click();
  await sheet(sam).getByRole('button', { name: 'Leave trip' }).click();
  await question(sam).getByRole('button', { name: 'Leave trip' }).click();
  await expect(sam).toHaveURL(/#\/$/);
  await expect(sam.locator('#app').getByText('Shared trip')).toHaveCount(0);
  await expect(toast(page)).toContainText('Sam left');
});

test('an email account: create it, sign out, sign back in', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Jo');
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await sheet(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});

// The spots data page reads /api/developer/spots, open to anyone; e2e/places.sql loads its two places
test('anyone can search the spots data and follow a place to the same place in another source', async ({ page }) => {
  await page.goto('/developer/spots');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spots data');
  await page.getByLabel('State').selectOption('ZZ');
  const results = page.locator('#results').getByRole('button');
  // by the start of each word, in any order, through the names' full-text index
  await page.getByRole('searchbox', { name: 'Search places by name' }).fill('lod tes');
  await expect(results).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search places by name' }).fill('odge');
  await expect(page.locator('#results')).not.toContainText('Test Lodge');
  await page.getByRole('searchbox', { name: 'Search places by name' }).fill('test lodge');
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('hotel, historic building'); // the one read most on Wikipedia first

  await results.filter({ hasText: 'NPS place' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Test Lodge');
  await expect(page.getByText('National Park Service place ID (P8649)')).toBeVisible();
  await page.getByRole('button', { name: /Test Lodge Wikidata · shares National Park Service place ID/ }).click();
  await expect(page.getByText('12,345 in the last 12 months')).toBeVisible();

  await page.getByRole('button', { name: 'Back to search' }).click();
  await expect(page.locator('#detail')).toContainText('Built in 1917'); // the list, hidden behind it, has the same text
  await page.getByRole('button', { name: 'Back to search' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search places by name' })).toHaveValue('test lodge');
});

// The guide preview reads /api/developer/spots/guides; e2e/places.sql loads Testville's one pick
test('anyone can preview a destination’s picks and read a pick’s entry with its sources and photo credits', async ({ page }) => {
  await page.goto('/developer');
  await page.getByRole('link', { name: 'Preview the guide' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guide preview');
  await page.getByRole('link', { name: /Testville/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Testville');
  await expect(page.locator('#guide')).toContainText('Only worth it on a game day.'); // what was left out, and why

  await page.getByRole('link', { name: /Test Lodge Sleep under the beams/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test Lodge');
  await expect(page.getByText('Sleep under the beams loggers cut in 1917.')).toBeVisible();
  const article = page.locator('article');
  await expect(article.locator('p.guide__para')).toHaveCount(2);
  // The inline photo comes after the paragraph it illustrates, the season under "Before you go"
  await expect(article.locator('p.guide__para + figure')).toContainText('The stone fireplace');
  await expect(article.locator('.guide__practical')).toContainText('Open from May to September.');
  await expect(article.locator('.guide__foot')).toContainText('CC BY-SA 4.0');
  await expect(article.locator('.guide__foot')).toContainText('A. Photographer, CC BY-SA 4.0, via Wikimedia Commons');
  await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /46\.78,-121\.73/);

  await page.getByRole('link', { name: 'Testville' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Testville');
});

// Spots are for anyone: no sign-in needed. e2e/places.sql loads Testville's one pick, Test Lodge
test('anyone can browse the spots and read a spot’s guide without signing in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue as a guest' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Spots' }).click();
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('test lodge');
  await expect(page.locator('.wt-spot-card')).toHaveCount(1);
  await expect(page.locator('.wt-spot-card')).toContainText('Testville, ZZ');
  await page.getByRole('link', { name: /Test Lodge/ }).click();
  const entry = page.locator('article.wt-guide');
  await expect(entry.getByRole('heading', { level: 1 })).toHaveText('Test Lodge');
  await expect(entry.locator('.wt-guide__body p')).toHaveCount(2);
  await expect(entry.locator('.wt-guide__facts')).toContainText('Open from May to September.');
  // Every page it was written from, and the others about it, at the end
  await expect(entry.locator('.wt-guide__link-label')).toHaveText(['Wikipedia', 'Official website', 'Google Maps', 'Wikidata', 'National Park Service']);
  await expect(entry.getByRole('link', { name: /^Wikidata/ })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1');
  await expect(entry.locator('.wt-guide__foot')).toContainText('Its Wikipedia article was read 12k times in the last year.');
  await expect(entry.locator('.wt-guide__foot')).toContainText('A. Photographer, CC BY-SA 4.0, via Wikimedia Commons');
  await page.getByRole('link', { name: 'All spots' }).click();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Continue as a guest' })).toBeVisible();
});

// The server filters by type and counts the types in SQL, and sorts nearest first: Testville's Test Lodge is a historic
// building
test('the spots can be narrowed to a type and sorted nearest first', async ({ page }) => {
  await page.goto('/#/spots?city=testville');
  await filterChip(page, 'kind').locator('.wt-filter__open').click();
  await expect(filterMenu(page).getByRole('radio', { name: /^History/ })).toHaveText('History1');
  await expect(filterMenu(page).getByRole('radio', { name: /^Fun & shows/ })).toBeDisabled();
  await filterMenu(page).getByRole('radio', { name: /^History/ }).click();
  await expect(page.locator('.wt-spot-card')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/spots\?kind=history&city=testville$/);
  const get = async q => { const res = await page.request.get(`/api/spots/search?${q}`); expect(res.status()).toBe(200); return res.json(); };
  expect(await get('city=testville&kind=fun')).toMatchObject({ results: [], total: 0, kinds: { history: 1, fun: 0 } });
  expect((await get('city=testville&sort=near&near=46.78,-121.73')).results.map(r => r.name)).toEqual(['Test Lodge']);
  expect((await get('city=testville&sort=name')).results.map(r => r.name)).toEqual(['Test Lodge']);
  expect(await get('city=testville&kind=history&offset=50')).toMatchObject({ results: [], total: 1, more: false }); // past the last page
  for (const q of ['kind=nope', 'sort=toString', 'sort=near&near=95,1']) expect((await page.request.get(`/api/spots/search?${q}`)).status(), q).toBe(400);
});

// Saving a spot waits on the server, so a trip ticked while another's change is on its way must not take a second tap
test('a spot is saved to a trip once, however the taps fall while the server answers', async ({ page }) => {
  await page.goto('/');
  await guest(page, 'Robin');
  await newTrip(page, 'Lodge weekend');
  await page.goto('/#/');
  await newTrip(page, 'Big lodge trip');
  await page.goto('/#/spots');
  await page.getByRole('searchbox', { name: 'Search spots' }).fill('test lodge');
  await page.getByRole('link', { name: /Test Lodge/ }).click();
  await page.getByRole('button', { name: 'Save to a trip' }).click();
  // the first save comes back soon, the second takes a while
  let puts = 0, back = 0;
  await page.route('**/api/trips/*/ideas/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts++;
    await new Promise(r => setTimeout(r, puts === 1 ? 300 : 2000));
    await route.continue();
    back++;
  });
  const box = name => sheet(page).getByRole('checkbox', { name: new RegExp(`^${name}`) });
  await box('Lodge weekend').click();
  await box('Big lodge trip').click();
  await expect.poll(() => back).toBe(1);
  await expect(box('Lodge weekend')).toHaveAttribute('aria-checked', 'true');
  await box('Big lodge trip').click(); // once the first trip's back, while this one's still on its way
  await expect.poll(() => back).toBe(2);
  await expect(box('Lodge weekend')).toHaveAttribute('aria-checked', 'true');
  await expect(box('Big lodge trip')).toHaveAttribute('aria-checked', 'true');
  expect(puts).toBe(2);
  await page.unroute('**/api/trips/*/ideas/*');
  // there's no Testville trip yet, so a new one is offered; once made, it isn't again
  await sheet(page).getByRole('button', { name: /^New trip: Testville/ }).click();
  await expect(box('Testville')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet(page).getByRole('button', { name: /^New trip/ })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(toast(page)).toContainText('On 3 trips');
});

// A long list of cities, as the real guide has (hundreds): the menu searches it. The server's cities, with 20 more.
test('a filter with a long list of choices searches them', async ({ page }) => {
  await page.route('**/api/spots/cities', async route => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: [...real, ...Array.from({ length: 20 }, (_, i) => ({ id: `fake${i}`, name: `Fakeville ${i}`, state: 'ZZ', country: 'US', spots: 1 }))] });
  });
  await page.goto('/#/spots');
  await filterChip(page, 'city').locator('.wt-filter__open').click();
  const search = filterMenu(page).getByRole('searchbox', { name: 'Search cities' }), options = filterMenu(page).getByRole('radio');
  await expect(search).toBeVisible();
  await search.fill('pageto');
  await expect(options).toHaveText(['Pagetown, ZZ']);
  await search.fill('nowhere');
  await expect(filterMenu(page)).toContainText('No cities match “nowhere”');
  // Return picks the first that matches
  await search.fill('pagetown');
  await search.press('Enter');
  await expect(filterMenu(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/spots\?state=ZZ&city=pagetown$/);
  await expect(filterChip(page, 'city').locator('.wt-filter__value')).toHaveText('Pagetown');
});

// e2e/places.sql loads Pagetown's 31 picks
test('on a computer, spots come in pages of 24; on a phone, 30 then Show more', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/spots');
  await pickFilter(page, 'city', 'Pagetown, ZZ');
  const names = page.locator('.wt-spot-card__name'), pager = page.getByRole('navigation', { name: 'Pages of spots' });
  await expect(names).toHaveCount(24);
  await expect(pager.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  await expect(pager.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
  await pager.getByRole('button', { name: 'Next page' }).click();
  await expect(names).toHaveCount(7);
  await expect(names.first()).toHaveText('Page spot 25');
  await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  await expect(pager.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(page).toHaveURL(/page=2$/);
  // The search box is in view under the app bar, and Back goes to the page before
  await expect(page.getByRole('searchbox', { name: 'Search spots' })).toBeInViewport();
  await page.goBack();
  await expect(names.first()).toHaveText('Page spot 01');
  await expect(pager.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(names).toHaveCount(30);
  await expect(pager).toBeHidden();
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(names).toHaveCount(31);
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
});

// The pages for developers document the MCP server from GET /api/developer/mcp and the API from README.md, each part
// on a page of its own, with a menu of them (a drawer behind a button on a phone)
test('the developer pages: a menu of pages, the MCP server’s tools as the server gives them, and the app’s API', async ({ page }) => {
  await page.goto('/developer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Developers');
  const { url, tools, server } = await (await page.request.get('/api/developer/mcp')).json();
  await expect(page.locator('#mcp-url')).toHaveText(url);

  const menu = page.getByRole('navigation', { name: 'Developers' });
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(menu.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: 'Tools' }).click();
  await expect(page).toHaveURL(/\/developer\/tools$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tools');
  await expect(menu).toBeHidden();
  await expect(page.locator('#tool-list h2')).toHaveText(tools.map(t => new RegExp(`^${t.name} `)));
  await expect(page.locator('section', { has: page.locator('#tool-add_stop') })).toContainText('trip_id');
  // edit_stop takes add_stop's fields: named once, not listed again
  await expect(page.locator('section', { has: page.locator('#tool-edit_stop') })).toContainText('Any of name, address, lat, lng');

  // The pages in the menu's order, one after another
  await page.getByRole('link', { name: /^Next/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign-in');
  await expect(page.locator('#oauth')).toContainText('/.well-known/oauth-authorization-server');
  await expect(page.locator('#signin-docs ol li')).toHaveCount(4); // the steps, from README.md
  await page.getByRole('link', { name: /^Next/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changelog');
  await expect(page.locator('#changes h2').first()).toContainText(server.version);
  await page.getByRole('link', { name: /^Previous/ }).click();
  await page.getByRole('link', { name: /^Previous/ }).click();
  await page.getByRole('link', { name: /^Previous/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connect an assistant');
  await expect(page.locator('#mcp-facts')).toContainText(url);
  await expect(page.locator('#mcp-docs')).toContainText(`claude mcp add --transport http dotsie ${url}`);

  // The API's routes, grouped as README.md's API section groups them
  await page.goto('/developer/api');
  await expect(page.getByRole('heading', { level: 2, name: 'Trips' })).toBeVisible();
  await expect(page.locator('#api-docs')).toContainText('GET /api/trips/:id');

  // The page was one page before: its old links go to where each part is now
  await page.goto('/developer#tool-add_stop');
  await expect(page).toHaveURL(/\/developer\/tools#tool-add_stop$/);
  await page.goto('/developer');
  await page.getByRole('link', { name: 'Search the spots data' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spots data');
});

// The trip plans page reads /api/developer/spots/plans; e2e/places.sql loads a plan for Testville
test('anyone can read a trip plan day by day, its article, and follow a place to its guide entry', async ({ page }) => {
  await page.goto('/developer');
  await page.getByRole('main').getByRole('link', { name: /^Trip plans/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip plans');
  await page.getByRole('link', { name: /A Day at Test Lodge Testville · 1 day · 1 place · for a first visit/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A Day at Test Lodge');
  const plan = page.locator('#plans');
  await expect(plan.getByRole('heading', { level: 2, name: 'Day 1 · Beams and a fireplace' })).toBeVisible(); // the article's name for the day
  await expect(plan.locator('.plan__item').first()).toContainText('Sleep under the beams loggers cut in 1917.'); // the entry's one-liner
  await expect(plan.locator('.plan__item').nth(1)).toContainText('4 min on foot from the place before');
  await expect(plan).toContainText('Only on a game day.'); // left out, as an idea
  await plan.getByText('Read it as an article').click();
  await expect(plan.getByText('Walk in under the beams.')).toBeVisible();

  await plan.locator('.plan__item').first().getByRole('link', { name: 'Test Lodge' }).click();
  await expect(page).toHaveURL(/\/developer\/guide#testville\/wikidata\/Q1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test Lodge');
});

// Rules or a model: written by hand, reached from Overview and the menu, after Trip plans
test('rules or a model: how choosing spots by each compares, and how accurate each was', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/developer');
  await page.getByRole('main').getByRole('link', { name: /^Rules or a model/ }).click();
  await expect(page).toHaveURL(/\/developer\/choosing$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choosing spots: rules or a model');
  const menu = page.getByRole('navigation', { name: 'Developers' });
  await expect(menu.getByRole('link', { name: 'Rules or a model' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('row', { name: /Model: the guide’s 19 picks/ })).toContainText('63%');
  await page.getByRole('complementary', { name: 'On this page' }).getByRole('link', { name: 'Accuracy' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Accuracy' })).toBeInViewport();
  await page.getByRole('link', { name: /^Previous/ }).click();
  await expect(page).toHaveURL(/\/developer\/plans$/);
});

// On a wide screen the menu stays on the left, and the page's own headings are on the right
test('a developer page on a wide screen: the menu beside it, and its headings to jump to', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/developer/api');
  const menu = page.getByRole('navigation', { name: 'Developers' });
  await expect(menu.getByRole('link', { name: 'App API' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
  const contents = page.getByRole('complementary', { name: 'On this page' });
  await contents.getByRole('link', { name: 'Errors' }).click();
  await expect(page).toHaveURL(/#errors$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Errors' })).toBeInViewport();
  await expect(contents.getByRole('link', { name: 'Errors' })).toHaveClass(/is-current/);
});

// Trip plans are for anyone to read; making one your trip needs an account. e2e/places.sql loads Testville's one plan:
// Test Lodge and lunch beside it, with Test Stadium left over for Want to go
test('anyone can read a trip plan from a city’s spots; signed in, Make it my trip makes it a trip, the leftovers on Want to go', async ({ page }) => {
  const get = async path => { const res = await page.request.get(path); return { status: res.status(), body: res.ok() ? await res.json() : null }; };
  const cards = await get('/api/spots/plans?city=testville');
  expect(cards.body).toEqual([expect.objectContaining({ planId: 'testville-first-visit-1d', title: '1 day in Testville', headline: 'A Day at Test Lodge',
    destination: { id: 'testville', name: 'Testville', state: 'ZZ', country: 'US' }, days: 1, stops: 1 })]);
  expect(cards.body[0].photos).toHaveLength(1);
  const whole = await get('/api/spots/plans/testville-first-visit-1d');
  expect(whole.body.places['wikidata/Q1']).toEqual(expect.objectContaining({ oneLiner: 'Sleep under the beams loggers cut in 1917.', wikipedia: 'Test Lodge', website: 'https://example.com/lodge' }));
  expect((await get('/api/spots/plans/nope')).status).toBe(404);
  expect((await get('/api/spots/plans?city=Not%20a%20city')).status).toBe(400);

  await page.goto('/#/spots?city=testville');
  await page.getByRole('region', { name: 'Trip plans' }).getByRole('link', { name: /1 day in Testville/ }).click();
  const article = page.locator('article.plan-article');
  await expect(article.getByRole('heading', { level: 1 })).toHaveText('A Day at Test Lodge');
  await expect(article.locator('.plan-card')).toContainText('Sleep under the beams loggers cut in 1917.');
  await expect(article.getByRole('link', { name: /Test Stadium/ })).toBeVisible(); // If there's time
  await page.getByRole('button', { name: 'Make it my trip' }).click();
  await expect(toast(page)).toContainText('Sign in to make it your trip');

  await page.goto('/');
  await guest(page, 'Alex');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  await page.goto('/#/plans/testville-first-visit-1d');
  await page.getByLabel('First day of the trip').fill('2026-12-05');
  await page.getByRole('button', { name: 'Make it my trip' }).click();
  await expect(page).toHaveURL(/#\/trip\/\w+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 day in Testville');
  await expect(plan(page).locator('.wt-tl-stop .wt-tl-name')).toHaveText(['Test Lodge', 'Lunch']);
  await expect(plan(page).getByRole('tablist', { name: 'Days' }).getByRole('tab', { name: /^Want to go/ })).toHaveAccessibleName('Want to go, 1 place');
});
