// Every test: a fixed "now" (2:10 PM on the first day of the prototype's White Sands trip, Denver time), nothing
// fetched from beyond this machine (map tiles, place search, Wikipedia, Overpass all fail, as they can for real),
// and no uncaught error on any page.
import { test as base, expect } from '@playwright/test';

export const NOW = new Date('2026-11-20T14:10:00-07:00');

// The same for every browser a test opens: `context`, and any other from `newContext` (a second person)
async function prepare(context, errors) {
  // Starts there and runs on: a fixed time would give two edits the same updatedAt, which the app takes for an echo
  await context.clock.install({ time: NOW });
  // Nor through the Worker: without a Stadia key it asks public OpenStreetMap and Overpass servers for these
  const outside = /^\/api\/(route|places|sights|about)$/;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !outside.test(url.pathname) ? route.continue() : route.abort();
  });
  context.on('weberror', e => errors.push(e.error().message));
}

export const test = base.extend({
  errors: async ({}, use) => {
    const errors = [];
    await use(errors);
    expect(errors, 'errors thrown on a page').toEqual([]);
  },
  context: async ({ context, errors }, use) => {
    await prepare(context, errors);
    await use(context);
  },
  newContext: async ({ browser, errors }, use) => {
    const made = [];
    await use(async () => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver', locale: 'en-US' });
      await prepare(c, errors);
      made.push(c);
      return c;
    });
    for (const c of made) await c.close();
  },
});
export { expect };

// The open stop sheet, trip settings, or any other sheet, and a question it asks
export const sheet = page => page.locator('#sheets').getByRole('dialog');
export const question = page => page.getByRole('alertdialog');
// A toast says what just happened
export const toast = page => page.getByRole('status');
// Spots' filters (kind, country, state, city) and order (sort): a chip, which drops its choices down as a menu.
// pickFilter opens it and picks the choice of that name (a type's count after it is left out).
export const filterChip = (page, name) => page.locator(`[data-filter="${name}"]`);
export const filterMenu = page => page.locator('.wt-filter-menu');
export async function pickFilter(page, name, choice) {
  await filterChip(page, name).locator('.wt-filter__open').click();
  const exact = choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await filterMenu(page).getByRole('radio', { name: new RegExp(`^${exact}( \\d+)?$`) }).click();
  await expect(filterMenu(page)).toHaveCount(0);
}
