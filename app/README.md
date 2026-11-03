# Waythread app (Cloudflare)

One Worker serves the frontend and `/api/*`. Each trip is a Durable Object (`TripRoom`) that owns its stops and members and pushes live edits over WebSockets. D1 holds accounts, sessions, trip membership, and the home-screen summaries.

| File | What it does |
| --- | --- |
| [src/index.ts](src/index.ts) | API routes, session check, share links |
| [src/trip.ts](src/trip.ts) | `TripRoom`: trip data, validation, membership, live events |
| [src/auth.ts](src/auth.ts) | Better Auth: Google, Apple, email magic link, guests |
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

Without OAuth keys the sign-in screen offers only email and guest. With `RESEND_API_KEY` empty, the email link is printed to the dev console. In production, the email option only appears once `RESEND_API_KEY` is set. Without `STADIA_API_KEY`, local dev uses the public OSM demo servers for place search and routes; production returns 503 instead.

To try co-editing locally, use a second browser profile (each needs its own session cookie), or open the trip's share link in a private window.

## Deploy

```bash
npx wrangler d1 create waythread          # put the id in wrangler.jsonc
npx wrangler kv namespace create ROUTES   # put the id in wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put BETTER_AUTH_SECRET  # and each other key in .dev.vars.example
npm run deploy
```

Rate limits (in `wrangler.jsonc`): 10 sign-in attempts per minute per IP, and 120 place searches plus route lookups per minute per person. Over the limit, the API returns 429 `rate_limited`. Sessions last 90 days from the last visit.

Set `BETTER_AUTH_URL` in `wrangler.jsonc` to the production origin, and register `<origin>/api/auth/callback/google` and `/callback/apple` with each provider.

## API

All routes need a session cookie, except `/api/auth/*`, `/api/config` and `/api/invite/:token`.

| Route | |
| --- | --- |
| `GET /api/config` | Which sign-in options are set up: `{ google, apple, email }` |
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
