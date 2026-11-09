// A browser with no WebGL (turned off, or a very old phone) can't draw the map. The trip screen says so where the map
// would be, and the plan works as ever. Run by the prototype in a Chromium started without WebGL.
import { expect, sheet, test } from './fixtures.js';

test('with no WebGL, the map says why it isn’t there, and the plan works as ever', async ({ page }) => {
  await page.goto('#/trip/white-sands');
  await expect(page.locator('#map')).toContainText('it needs WebGL');
  await expect(page.locator('#map .wt-pin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Show the whole (day|trip) on the map$/ })).toBeHidden();
  const plan = page.getByRole('region', { name: 'Plan' });
  const row = plan.getByRole('button', { name: /^Attraction White Sands Visitor Center/ });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit stop' }).click();
  await sheet(page).getByRole('textbox', { name: 'Note' }).fill('No map, no matter');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('No map, no matter');
  await plan.getByRole('tab', { name: 'Sat, Nov 21' }).click();
  await expect(plan.getByRole('button', { name: /^Museum New Mexico Museum of Space History/ })).toBeVisible();
});
