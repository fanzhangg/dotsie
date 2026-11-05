# Waythread app (Cloudflare)

One Worker serves the frontend and `/api/*`. Each trip is a Durable Object (`TripRoom`) that owns its stops and members and pushes live edits over WebSockets. D1 holds accounts, sessions, trip membership, and the home-screen summaries: each trip's name, dates, people and stop places, which its `TripRoom` writes whenever they change.

| File | What it does |
| --- | --- |
| [src/index.ts](src/index.ts) | API routes, session check, share links |
| [src/trip.ts](src/trip.ts) | `TripRoom`: trip data, validation, membership, live events |
| [src/auth.ts](src/auth.ts) | Better Auth: Google, Apple, email and password, guests |
| [src/maps.ts](src/maps.ts) | Stadia place search and drive routes, routes cached in KV |
| [migrations/](migrations) | D1 schema |
| [web/](web) | The frontend: plain HTML, CSS and JS. `../prototype` is the same frontend with no server |
| [scripts/build.mjs](scripts/build.mjs) | Copies `web/` and `../design-system/` into `public/`, which Wrangler serves. Runs on `dev` and `deploy` |

The frontend saves edits in the background (they show at once) and keeps a WebSocket open on the current trip, so co-editors' changes appear live. `../prototype` must stay the same as `web/` apart from the server: make every UX change to both (see [CLAUDE.md](../CLAUDE.md)).

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

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) checks every pull request (typecheck, bundle) and deploys every push to `main`, as long as that commit is still the newest on `main` (two merges close together can start their deploys out of order, and an older commit deployed last would undo the newer one): it applies D1 migrations, then uploads the Worker together with its secrets, then smoke-tests `/api/config`. The production D1 database and KV namespace already exist; their IDs are in `wrangler.jsonc`.

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

Only the secrets you set are uploaded, and a feature whose keys are missing stays off. Register `<app URL>/api/auth/callback/google` (and `/callback/apple`) with each provider, and the app's domain with Stadia so map tiles load. The map prefetches Stadia tiles around the view and one zoom level in and out, so zooming doesn't wait on the network; that's roughly 3–4× the tile requests of the visible view alone, which counts against the Stadia plan (`EDGE_TILES` and `PREFETCH_ZOOMS` in `web/app.js` tune it). It also preloads the trip's other days, nearest first, so switching days is instant: each day's drives, and the tiles for the part of that day's view the list doesn't cover, at the zoom it opens at. That's one more view's worth of tiles per trip day per visit (about 6–10 on a phone, 15–25 on a laptop; after that the browser's cache has them), fetched four at a time once the day on screen has loaded. The OpenStreetMap fallback doesn't prefetch, since its tile policy discourages loading tiles nobody views.

`BETTER_AUTH_URL` isn't in `wrangler.jsonc`: `.dev.vars` sets it locally and the workflow sets it for production, so deploy through the workflow rather than `npm run deploy`.

Rate limits (in `wrangler.jsonc`): 20 sign-in steps per minute per IP (an email lookup and a sign-in count as two), and 120 place searches plus route lookups per minute per person. Over the limit, the API returns 429 `rate_limited`. The app looks up the other days' drives at most one a second, behind any the screen needs, so preloading a long trip leaves room for search; it pauses for a minute if it hits the limit. All days, the overview a trip opens on outside its dates, shows every drive of the trip, so it asks for all of them at once, one after another; the browser keeps them, so that's once per trip per browser. A trip with more than about 100 drives can reach the limit the first time: the rest show as straight lines until the next visit. Sessions last 90 days from the last visit.

## API

All routes need a session cookie, except `/api/auth/*`, `/api/config`, `/api/sign-in-options` and `/api/invite/:token`.

| Route | |
| --- | --- |
| `GET /api/config` | Which sign-in options are set up: `{ google, apple, password }` |
| `POST /api/sign-in-options` `{ email }` | Where an address leads: `{ account: 'password' \| 'google' \| 'none' }`, so sign-in asks for the right thing next |
| `GET /api/invite/:token` | The trip name for a share link, for the sign-in screen |
| `GET /api/me` | `{ id, name, image, isGuest }` |
| `GET /api/trips` | Home cards: `[{ id, name, start, end, members, stops }]`, last edited first. `members` as in a trip; `stops` only `{ id, name, lat, lng, time, kind, nights }`, for the card's route sketch (at most 300) |
| `POST /api/trips` `{ name }` | Create; returns the trip snapshot |
| `GET /api/trips/:id` | `{ trip, members, stops }` |
| `PATCH /api/trips/:id` `{ name }` | Rename |
| `DELETE /api/trips/:id` · `POST /api/trips/:id/restore` | Soft delete and undo |
| `GET /api/trips/:id/invite` · `POST …/invite/rotate` | Share link, or a fresh one that kills the old |
| `POST /api/join/:token` | Join through a share link |
| `PUT /api/trips/:id/stops/:stopId` | Create a stop, or restore one (Undo). The client picks the id |
| `PATCH /api/trips/:id/stops/:stopId` | Changed fields only, e.g. `{ kind: 'hotel', nights: 2, checkout: '11:00' }` |
| `DELETE /api/trips/:id/stops/:stopId` | |
| `GET /api/trips/:id/live` (WebSocket) | `stop.upserted`, `stop.removed`, `member.joined`, `member.updated`, `trip.updated`, `trip.deleted`, each with `by` |
| `GET /api/places?q=&near=lat,lng` | Place search: `[{ name, address, lat, lng, category }]`. The category feeds the app's first guess at a stop's type |
| `GET /api/route?from=lat,lng&to=lat,lng` | `{ duration, distance, coords }` |

A stop is `{ id, name, address, lat, lng, time, note, kind, nights, checkout, by, updatedAt }`. `time` is trip-local `YYYY-MM-DDTHH:MM`. `kind` is `''` (the app guesses from the name) or one of `place`, `airport`, `hotel`, `restaurant`, `cafe`, `attraction`, `museum`, `viewpoint`, `nature`, `shopping`, `gas`. `nights` is for a hotel: 1–30, or `null` to last until the next hotel or the trip's last day. `checkout` is a hotel's check-out time, `HH:MM`, on the day its nights end, or `null` (the app shows 11:00 AM). Other stops have `null`; a time some older clients saved there as a leave time is ignored. Stops still carry `done`, which older clients set; the app no longer shows it.

Errors are `{ error }` with 400 `invalid`, 401 `unauthorized`, 403 `not_member`, 404 `not_found`, 410 `gone`, 429 `rate_limited`, or 503 `maps_not_configured`.
