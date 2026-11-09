// End-to-end tests: `npm run e2e`. The prototype project drives the shared frontend with the prototype's pretend
// backend (seeded trips, no server); the app project drives what only the product has (sign-in, the API, the live
// socket) against a local Worker. Both start their own server unless one is already running locally.
import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github']] : 'list',
  // WebGL, which MapLibre draws the map with, by software (SwiftShader): headless Chromium has no GPU
  use: {
    viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver', locale: 'en-US', trace: 'on-first-retry',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'prototype', testMatch: /(prototype|map)\.spec\.js/, use: { baseURL: 'http://localhost:5199/prototype/' } },
    { name: 'app', testMatch: 'app.spec.js', use: { baseURL: 'http://localhost:8787/' } },
    { name: 'no-webgl', testMatch: 'nowebgl.spec.js', use: { baseURL: 'http://localhost:5199/prototype/', launchOptions: { args: ['--disable-3d-apis'] } } },
  ],
  webServer: [
    { command: 'python3 -m http.server 5199 -d ../..', url: 'http://localhost:5199/prototype/', reuseExistingServer: !CI },
    // .dev.vars must exist (see app/README.md); BETTER_AUTH_URL there is this port
    { command: 'npm run db:migrate:local && npx wrangler dev --port 8787', cwd: '..', url: 'http://localhost:8787/api/config', reuseExistingServer: !CI, timeout: 120_000 },
  ],
});
