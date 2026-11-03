# Waythread app (Cloudflare)

One Worker serves the frontend and `/api/*`. Each trip is a Durable Object (`TripRoom`) that owns its stops and members and pushes live edits over WebSockets. D1 holds accounts, sessions, trip membership, and the home-screen summaries.

| File | What it does |
| --- | --- |
| [src/index.ts](src/index.ts) | API routes, session check, share links |
| [src/trip.ts](src/trip.ts) | `TripRoom`: trip data, validation, membership, live events |
| [src/auth.ts](src/auth.ts) | Better Auth: Google, Apple, email and password, guests |
| [src/maps.ts](src/maps.ts) | Stadia place search and drive routes, routes cached in KV |
| [migrations/](migrations) | D1 schema |
| [web/](web) | The frontend: plain HTML, CSS and JS, started from `../prototype` |
| [scripts/build.mjs](scripts/build.mjs) | Copies `web/` and `../design-system/` into `public/`, which Wrangler serves. Runs on `dev` and `deploy` |

The frontend saves edits in the background (they show at once) and keeps a WebSocket open on the current trip, so co-editors' changes appear live. Changes to `../prototype` don't carry over to `web/` automatically.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then set BETTER_AUTH_SECRET
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Sign-in offers Google (when its keys are set), email, and guest, one choice per screen. Email asks for the address first, then for its password, to use Google, or to create an account. A Google sign-in isn't joined to an existing password account with the same email, because that email was never verified; the app explains this and points to email sign-in. Email addresses aren't verified and there's no password reset yet: both need an email service. Without `STADIA_API_KEY`, local dev uses the public OSM demo servers for place search and routes; production returns 503 instead.

To try co-editing locally, use a second browser profile (each needs its own session cookie), or open the trip's share link in a private window.

## Deploy

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) checks every pull request (typecheck, bundle) and deploys every push to `main`: it applies D1 migrations, then uploads the Worker together with its secrets, then smoke-tests `/api/config`. The production D1 database and KV namespace already exist; their IDs are in `wrangler.jsonc`.

One-time setup, in the GitHub repo under Settings → Secrets and variables → Actions:

| Name | Kind | What |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then add **Account → D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Your Cloudflare account ID |
| `BETTER_AUTH_SECRET` | Secret | Any long random string. Changing it signs everyone out |
| `STADIA_API_KEY` | Secret | Needed for place search and routes in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secrets | Optional: Google sign-in |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` | Secrets | Optional: Apple sign-in |
| `APP_URL` | Variable | Optional: a custom domain. Without it the app runs at `https://waythread.<your-subdomain>.workers.dev` |

Only the secrets you set are uploaded, and a feature whose keys are missing stays off. Register `<app URL>/api/auth/callback/google` (and `/callback/apple`) with each provider, and the app's domain with Stadia so map tiles load.

`BETTER_AUTH_URL` isn't in `wrangler.jsonc`: `.dev.vars` sets it locally and the workflow sets it for production, so deploy through the workflow rather than `npm run deploy`.

Rate limits (in `wrangler.jsonc`): 20 sign-in steps per minute per IP (an email lookup and a sign-in count as two), and 120 place searches plus route lookups per minute per person. Over the limit, the API returns 429 `rate_limited`. Sessions last 90 days from the last visit.

## API

All routes need a session cookie, except `/api/auth/*`, `/api/config`, `/api/sign-in-options` and `/api/invite/:token`.

| Route | |
| --- | --- |
| `GET /api/config` | Which sign-in options are set up: `{ google, apple, password }` |
| `POST /api/sign-in-options` `{ email }` | Where an address leads: `{ account: 'password' \| 'google' \| 'none' }`, so sign-in asks for the right thing next |
| `GET /api/invite/:token` | The trip name for a share link, for the sign-in screen |
| `GET /api/me` | `{ id, name, image, isGuest }` |
| `GET /api/trips` | Home cards: `[{ id, name, start, end }]` |
| `POST /api/trips` `{ name }` | Create; returns the trip snapshot |
| `GET /api/trips/:id` | `{ trip, members, stops }` |
| `PATCH /api/trips/:id` `{ name }` | Rename |
| `DELETE /api/trips/:id` · `POST /api/trips/:id/restore` | Soft delete and undo |
| `GET /api/trips/:id/invite` · `POST …/invite/rotate` | Share link, or a fresh one that kills the old |
| `POST /api/join/:token` | Join through a share link |
| `PUT /api/trips/:id/stops/:stopId` | Create a stop, or restore one (Undo). The client picks the id |
| `PATCH /api/trips/:id/stops/:stopId` | Changed fields only, e.g. `{ done: true }` |
| `DELETE /api/trips/:id/stops/:stopId` | |
| `GET /api/trips/:id/live` (WebSocket) | `stop.upserted`, `stop.removed`, `member.joined`, `member.updated`, `trip.updated`, `trip.deleted`, each with `by` |
| `GET /api/places?q=&near=lat,lng` | Place search |
| `GET /api/route?from=lat,lng&to=lat,lng` | `{ duration, distance, coords }` |

Errors are `{ error }` with 400 `invalid`, 401 `unauthorized`, 403 `not_member`, 404 `not_found`, 410 `gone`, 429 `rate_limited`, or 503 `maps_not_configured`.
