# Waythread app (Cloudflare)

One Worker serves the frontend and `/api/*`. Each trip is a Durable Object (`TripRoom`) that owns its stops and members and pushes live edits over WebSockets. D1 holds accounts, sessions, trip membership, and the home-screen summaries: each trip's name, dates, people and stop places, which its `TripRoom` writes whenever they change.

| File | What it does |
| --- | --- |
| [src/index.ts](src/index.ts) | API routes, session check, share links |
| [src/trip.ts](src/trip.ts) | `TripRoom`: trip data, validation, membership, live events |
| [src/auth.ts](src/auth.ts) | Better Auth: Google, Apple, email and password, guests |
| [src/maps.ts](src/maps.ts) | Stadia place search, drive routes (cached in KV), the home cards' map pictures (cached at the edge), and the map's sights from OpenStreetMap (cached in KV) |
| [src/mcp.ts](src/mcp.ts) | The MCP server: tools for an AI assistant to list trips and stops, and add, edit and delete stops |
| [src/oauth.ts](src/oauth.ts) | OAuth sign-in for the MCP server, and its Allow page |
| [migrations/](migrations) | D1 schema |
| [web/](web) | The frontend: plain HTML, CSS and JS. `../prototype` is the same frontend with no server |
| [scripts/build.mjs](scripts/build.mjs) | Copies `web/` and `../design-system/` into `public/`, which Wrangler serves. Runs on `dev` and `deploy` |

The frontend saves edits in the background (they show at once) and keeps a WebSocket open on the current trip, so co-editors' changes appear live. A trip can be saved for offline from trip settings: the frontend keeps the trip's last snapshot in `localStorage`, and the app's files and the trip's Stadia tiles in Cache Storage, and [web/sw.js](web/sw.js) serves them when the network can't (see Offline in [the UX design](../docs/ux-design.md#offline)). The API itself isn't cached by the service worker. `../prototype` must stay the same as `web/` apart from the server: make every UX change to both (see [CLAUDE.md](../CLAUDE.md)).

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

Only the secrets you set are uploaded, and a feature whose keys are missing stays off. Register `<app URL>/api/auth/callback/google` (and `/callback/apple`) with each provider, and the app's domain with Stadia so map tiles load. Online, the trip's map is Stadia's style drawn in the browser by [MapLibre](https://maplibre.org/) from Stadia's vector tiles, in two layers so the place and road names sit over the routes (see "The basemap, drawn in the browser" in `web/app.js`); MapLibre and its Leaflet plugin load from unpkg the first time a trip opens. MapLibre fetches vector tiles as the map moves; each tile is fetched once for both layers (`sharedFetch`), and a vector tile covers four picture tiles. Stadia's picture tiles show instead when MapLibre can't run (no WebGL, or it didn't load). Stadia serves its style and fonts to anyone but refuses its vector tiles to a domain not registered with it; a refused tile also puts the picture map back. The picture map prefetches tiles around the view and one zoom level in and out, so zooming doesn't wait on the network; that's roughly 3–4× the tile requests of the visible view alone, which counts against the Stadia plan (`EDGE_TILES` and `PREFETCH_ZOOMS` in `web/app.js` tune it). The vector map doesn't: MapLibre shows the level below until a tile comes. The app also preloads the trip's other days, nearest first, so switching days is quick: each day's drives, and the tiles for the part of that day's view the list doesn't cover, at the zoom it opens at. That's one more view's worth of tiles per trip day per visit (with the picture map, about 6–10 on a phone and 15–25 on a laptop; a quarter of that with the vector map; after that the browser's cache has them), fetched four at a time once the day on screen has loaded. A trip saved for offline keeps the map that was showing: the vector tiles, style, sprite and fonts (the Latin ranges, and any other the map has drawn), or the picture tiles. A trip saved with one kind switches to the other only once that's all saved, and then the first kind's tiles are removed. The OpenStreetMap fallback doesn't prefetch, since its tile policy discourages loading tiles nobody views.

`BETTER_AUTH_URL` isn't in `wrangler.jsonc`: `.dev.vars` sets it locally and the workflow sets it for production, so deploy through the workflow rather than `npm run deploy`.

Home's cards show a map picture of each trip from Stadia's [static maps](https://docs.stadiamaps.com/static-maps/), made by the Worker with the cacheable endpoint (the one whose pictures may be kept) and kept in the Cache API by what's drawn on it. So a picture costs one static map from the Stadia plan when it's first made, and again only when the trip's places, its drives' roads or the theme change; browsers keep it for a day. Drives are drawn along the roads already in KV, straight otherwise: making a picture never looks up a route. The cache is per Cloudflare location, so someone opening Home from another region can cost one more. Each picture made counts against the person's maps rate limit.

Zoomed in, the trip's map shows sights nearby: attractions, museums, viewpoints, historic sites and nature from OpenStreetMap, asked of the public [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) a map tile (zoom 12) at a time. Each tile is kept in KV for 30 days, under `sights:v2:x/y` in the `ROUTES` namespace, and in the browser for a day, so a tile costs one Overpass call a month however many people look at it, and none needs a key. When overpass-api.de fails or hasn't answered in 15 s, the Worker asks a second public server too (VK's, at maps.mail.ru) and takes whichever answers first; when both fail, the tile is marked `sights:failed:x/y` for 2 minutes and answers 503 at once meanwhile, so a busy Overpass isn't asked again by everyone looking at it. A lookup can take Overpass 25 s or more (central Paris takes about 25), so a request waits 8 s for it and then answers 202: the lookup carries on after the response (`waitUntil`, about 30 s for both servers together), is marked `sights:loading:x/y` so other requests don't start their own, and the app asks again until it's in KV. Overpass's public servers ask for under 10,000 queries a day and give up on a query after its time limit (25 s here); if the app outgrows them, point `OVERPASS` in `src/maps.ts` (and the prototype's copy) at a paid or self-hosted instance. The query asks for relations only for parks and protected areas: a relation is matched by loading its outline, and tiles crossed by huge ones (the missile range next to White Sands) ran out of time. OpenStreetMap has no popularity data, so a sight's rank comes from its kind and whether it has a Wikipedia article or a Wikidata item (see `sightsFrom`). A tile's rank and kinds are fixed when it's cached: after changing them, bump the key's `v2`.

Rate limits (in `wrangler.jsonc`): 20 sign-in steps per minute per IP (an email lookup and a sign-in count as two), 120 place searches plus route lookups plus sights tiles per minute per person, and 60 MCP calls per minute per person. Over the limit, the API returns 429 `rate_limited`. The app looks up the other days' drives at most one a second, behind any the screen needs, so preloading a long trip leaves room for search; it pauses for a minute if it hits the limit. All days, the overview a trip opens on outside its dates, shows every drive of the trip, so it asks for all of them at once, one after another; the browser keeps them, so that's once per trip per browser. A trip with more than about 100 drives can reach the limit the first time: the rest show as straight lines until the next visit. Sessions last 90 days from the last visit.

## API

All routes need a session cookie, except `/api/auth/*`, `/api/config`, `/api/sign-in-options`, `/api/invite/:token`, the OAuth routes, and `/api/mcp`, which takes an OAuth access token instead.

| Route | |
| --- | --- |
| `GET /api/config` | Which sign-in options are set up: `{ google, apple, password }` |
| `POST /api/sign-in-options` `{ email }` | Where an address leads: `{ account: 'password' \| 'google' \| 'none' }`, so sign-in asks for the right thing next |
| `GET /api/invite/:token` | The trip name for a share link, for the sign-in screen |
| `GET /api/me` | `{ id, name, image, isGuest }` |
| `GET /api/trips` | Home cards: `[{ id, name, start, end, members, stops }]`, last edited first. `members` as in a trip; `stops` only `{ id, name, lat, lng, time, kind, nights, travel, back }`, for the card's route sketch (at most 300) |
| `POST /api/trips` `{ name }` | Create; returns the trip snapshot |
| `GET /api/trips/:id` | `{ trip, members, stops, folders }`; `trip.owner` is the id of whoever made it |
| `PATCH /api/trips/:id` `{ name }` | Rename |
| `DELETE /api/trips/:id` · `POST /api/trips/:id/restore` | Soft delete and undo. Owner only (403 `not_owner`) |
| `POST /api/trips/:id/leave` | Leave the trip; your stops stay. Everyone but the owner (the owner gets 400 `invalid`) |
| `GET /api/trips/:id/invite` · `POST …/invite/rotate` | Share link, or a fresh one that kills the old |
| `POST /api/join/:token` | Join through a share link |
| `PUT /api/trips/:id/stops/:stopId` | Create a stop, or restore one (Undo). The client picks the id |
| `PATCH /api/trips/:id/stops/:stopId` | Changed fields only, e.g. `{ kind: 'hotel', nights: 2, checkout: '11:00' }`. `links` is the whole list, `[{ url, label }]`: up to 10 http(s) pages, `label` up to 60 characters (`''` shows the page's site) |
| `DELETE /api/trips/:id/stops/:stopId` | |
| `PUT /api/trips/:id/folders/:folderId` `{ name }` | Create a folder, or rename one; returns `{ id, name }`. The client picks the id. A stop goes in or out with its own `folder` field |
| `GET /api/trips/:id/live` (WebSocket) | `stop.upserted`, `stop.removed`, `folder.upserted`, `member.joined`, `member.updated`, `member.left`, `trip.updated`, `trip.deleted`, each with `by` |
| `GET /api/places?q=&near=lat,lng` | Place search: `[{ name, address, lat, lng, category }]`. The category feeds the app's first guess at a stop's type |
| `GET /api/sights?tile=12/x/y` | What's worth seeing in one map tile at zoom 12: `[{ id, name, address, lat, lng, kind, rank }]`, at most 80, best ranked first. `kind` is `attraction`, `museum`, `viewpoint` or `nature`; `rank` is higher for better known places. 202 `{ pending: true }` while a tile no one has looked at yet is looked up (ask again in a few seconds); 503 `unavailable` when Overpass is down or busy |
| `GET /api/route?from=lat,lng&to=lat,lng&mode=` | `{ duration, distance, coords }`. `mode` is `drive` (the default), `walk` or `bike` |
| `GET /api/trips/:id/map?theme=&route=&legs=&dots=` | A home card's map picture (PNG, 1000×400). `theme` is `light` or `dark`; `route` the line color as six hex digits; `legs` the drives as pairs of indexes into the card's `stops`, like `0-1,1-2`, with the way after a colon when it isn't a drive (`1-2:walk`); `dots` the places, like `0:b24acf,1:7250e2`. 503 `maps_not_configured` without a Stadia key, in local dev too, and the card shows its sketch |
| `GET /api/assistants` | For Account: `{ url, connections: [{ id, name, domain, createdAt }] }`, the MCP server's address and the assistants you've allowed |
| `DELETE /api/assistants/:id` | Disconnect one: its tokens stop working at once |
| `POST /api/mcp` | The MCP server (below), with an OAuth access token |
| `GET`·`POST /api/oauth/authorize` | The Allow page an assistant sends you to (a page, not JSON) |
| `/api/oauth/token`, `/api/oauth/register`, `/.well-known/oauth-*` | OAuth's token, client registration and discovery endpoints, answered by the library |

A stop is `{ id, name, address, lat, lng, time, note, kind, nights, checkout, travel, back, folder, by, updatedAt }`. `time` is trip-local `YYYY-MM-DDTHH:MM`. `kind` is `''` (the app guesses from the name) or one of `place`, `airport`, `hotel`, `restaurant`, `cafe`, `attraction`, `museum`, `viewpoint`, `nature`, `shopping`, `gas`. `nights` is for a hotel: 1–30, or `null` to last until the next hotel or the trip's last day. `checkout` is a hotel's check-out time, `HH:MM`, on the day its nights end, or `null` (the app shows 11:00 AM). Other stops have `null`; a time some older clients saved there as a leave time is ignored. `travel` is how you get to the stop from the place before it (for a hotel, on its check-in day): `drive` (the default), `walk`, `bike`, `transit` or `flight`. `back` is a hotel's way back to it each night, by the day: `{ "2026-03-14": "walk" }`; nights not in it are drives, and a `drive` sent in it is dropped. Other stops have `{}`. A PATCH replaces the whole of it. Drives, walks and rides follow a route (`/api/route` with that `mode`); transit and flights have none, and the app draws them straight, with no time. `folder` is the id of the folder the stop is in, or `null`. A folder is `{ id, name }`: a name for stops that follow each other by time (the app keeps a folder's stops together; the server doesn't check). It isn't checked against the trip's folders either, since a stop can arrive a moment before its new folder's name. A folder whose stops have all left it stays in `folders`, so Undo can put them back; the app shows only folders that hold stops. Stops still carry `done`, which older clients set; the app no longer shows it.

Errors are `{ error }` with 400 `invalid`, 401 `unauthorized`, 403 `not_member` or `not_owner`, 404 `not_found`, 410 `gone`, 429 `rate_limited`, or 503 `maps_not_configured`.

## MCP server

`/api/mcp` lets an AI assistant (Claude, or any client that speaks [MCP](https://modelcontextprotocol.io)) read your trips and add, edit and delete their stops as you. It signs in with OAuth, so all an assistant needs is the address, `https://<app URL>/api/mcp`, which Account shows under **AI assistant**.

- **Claude (web, iOS, Android, Desktop):** in Claude on the web, Customize → Connectors → Add custom connector, paste the address, then Connect. Claude opens Waythread: sign in if you aren't, then Allow. Connectors belong to your Claude account, so one added on the web works in the mobile apps too, and in Claude Code sessions on the web and in the app.
- **Claude Code in a terminal:**

  ```bash
  claude mcp add --transport http waythread https://<app URL>/api/mcp
  ```

  then run `/mcp` in Claude Code and pick waythread to sign in.
- **Other clients:** a Streamable HTTP server at that address, with OAuth sign-in.

Claude reaches the server from Anthropic's cloud, so a connector needs the deployed app; `wrangler dev` works with Claude Code on the same machine. Locally, use `http://localhost:8787` (what `BETTER_AUTH_URL` says), not `127.0.0.1`, since the OAuth issuer and resource are that address.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_trips` | none | `{ trips: [{ id, name, start, end }] }`, newest edit first |
| `list_stops` | `trip_id`, optional `day` (`YYYY-MM-DD`) | `{ trip, stops, folders }`, in time order, with the folders those stops are in |
| `add_stop` | `trip_id`, `name`, `lat`, `lng`, `time`, and any of `address`, `checkout`, `kind`, `nights`, `note`, `links`, `folder` | `{ stop }`, as saved, with its new id |
| `edit_stop` | `trip_id`, `stop_id`, and any of `name`, `address`, `lat`, `lng`, `time`, `checkout`, `kind`, `nights`, `note`, `links`, `folder` | `{ stop }`, as saved. `links` replaces the whole list |
| `add_link` | `trip_id`, `stop_id`, `url`, optional `label` | `{ stop }`, as saved. Adds the page to the stop's links, keeping the others; a page it has already only gets the new label |
| `delete_stop` | `trip_id`, `stop_id` | `{ deleted }`: the stop as it was, so `add_stop` can put it back |
| `add_folder` | `trip_id`, `name` | `{ folder }`, with its new id. Empty until a stop's `folder` is set to it |
| `rename_folder` | `trip_id`, `folder_id`, `name` | `{ folder }` |

A stop here is the API's stop without `done`, with `by` swapped for `updatedBy` (a name) and `updatedAt` as an ISO time. Changes go through `TripRoom`'s `putStop`, `patchStop`, `addLink`, `deleteStop` and `putFolder`, like the app's: the same checks, and everyone with the trip open sees them live.

How it's built:

- **Transport** ([src/mcp.ts](src/mcp.ts)): Streamable HTTP without sessions. Each POST is one JSON-RPC message, answered with JSON (or 202 for a notification). There's no event stream, so GET is 405. It answers `initialize`, `ping`, `tools/list` and `tools/call`.
- **Sign-in** ([src/oauth.ts](src/oauth.ts)): OAuth 2.1 by [`@cloudflare/workers-oauth-provider`](https://www.npmjs.com/package/@cloudflare/workers-oauth-provider), which wraps the Worker. It publishes the discovery documents (`/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`), registers clients by Client ID Metadata Document (what Claude uses) or dynamic registration, issues and refreshes tokens (PKCE S256 only), and checks the token on every `/api/mcp` call. One scope, `trips`. An access token lasts an hour; a connection lasts while it's used and ends after 90 days without, like a session.
- **The Allow page** is ours: `/api/oauth/authorize` uses the app's session cookie. Signed out, it sends you to the app's sign-in (`/?next=…`), which comes back once you're in. It names the assistant (with its verified domain when it has one), what it can do, where access goes, and who you're signed in as. Guests can't connect one, since their trips are only reachable from their own browser.
- **Storage:** clients, grants and tokens live in KV as `OAUTH_KV`, with tokens and codes stored only as hashes. It's the same namespace as `ROUTES` (their keys don't overlap), so a deploy needs nothing created first; give it its own namespace whenever you like (existing connections then have to connect again). `global_fetch_strictly_public` keeps the library's fetches of client metadata on the public internet.
- **Errors:** a bad id, a field that fails validation, or a trip you're not on comes back as a tool result with `isError`, so the assistant can read why and try again. A missing, expired or revoked token is 401 with a `WWW-Authenticate` challenge that points to the discovery document.
- **Not yet:** place search, so `add_stop` has to be given a place's coordinates.
