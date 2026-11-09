// What only the product has: signing in, the server's API and the live socket between two people. Each test makes
// its own accounts and trips, so they run on a database that isn't empty.
import { expect, question, sheet, test, toast } from './fixtures.js';

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
  await page.getByRole('searchbox', { name: 'Search places by name' }).fill('test lodge');
  const results = page.locator('#results').getByRole('button');
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

// The developer page documents the MCP server from GET /api/developer/mcp and the API from README.md
test('the developer page lists the MCP server’s tools as the server gives them, and the app’s API', async ({ page }) => {
  await page.goto('/developer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Developers');
  const { url, tools } = await (await page.request.get('/api/developer/mcp')).json();
  await expect(page.locator('#tools h3')).toHaveText(tools.map(t => new RegExp(`^${t.name} · `)));
  await expect(page.locator('#tool-add_stop')).toContainText('trip_id');
  await expect(page.locator('#mcp-facts')).toContainText(url);
  await expect(page.locator('#api-docs')).toContainText('GET /api/trips/:id');
  await page.getByRole('link', { name: 'Search the spots data' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Spots data');
});
