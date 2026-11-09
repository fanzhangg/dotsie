# Dotsie app (Cloudflare)

One Worker serves the frontend and `/api/*`. Each trip is a Durable Object (`TripRoom`) that owns its stops and members and pushes live edits over WebSockets. D1 holds accounts and sessions, and a copy of what spans trips: who's on which trip, each trip's home card (name, dates, people and stop places) and its share link's hash. Only the trip's `TripRoom` writes that copy, whole and in one batch, after every change (see "The D1 copy" in [src/trip.ts](src/trip.ts)): a copy that fails is tried again by the room's alarm and by the next change, and one that lands after a newer one is ignored (`rev`). So D1 can lag for a moment but doesn't stay wrong, and the room's own data is what a trip is.

| File | What it does |
| --- | --- |
| [src/index.ts](src/index.ts) | API routes, session check, share links |
| [src/trip.ts](src/trip.ts) | `TripRoom`: trip data, membership, live events |
| [src/copy.ts](src/copy.ts) | The statements that write a trip's D1 copy |
| [src/stop.ts](src/stop.ts) | A stop's fields and the check every write goes through, on the lists and limits in [web/fields.js](web/fields.js), which the frontend uses too |
| [src/auth.ts](src/auth.ts) | Better Auth: Google, Apple, email and password, guests |
| [src/sights.ts](src/sights.ts) | `SightsLookup`, the Durable Object that looks up one map tile's sights from Overpass, which can take longer than a request can wait |
| [src/maps.ts](src/maps.ts) | Stadia place search, drive routes (cached in KV), the map's sights from OpenStreetMap, and their photos and lines from Wikipedia (both cached in KV) |
| [src/mcp.ts](src/mcp.ts) | The MCP server: tools for an AI assistant to list trips and stops, and add, edit and delete stops |
| [src/oauth.ts](src/oauth.ts) | OAuth sign-in for the MCP server, and its Allow page |
| [migrations/](migrations) | D1 schema |
| [test/](test) | Unit tests: time zones, a trip's days and stays, the stop check, the D1 copy (on SQLite with the migrations), and the app's and the prototype's pages loading the same modules. `npm test` |
| [web/](web) | The frontend: plain HTML, CSS and JS modules, served as they are with no bundler (the top of [web/app.js](web/app.js) says which module does what). [web/backend.js](web/backend.js) is all it says to the server; `../prototype` runs the same modules with its own `backend.js`. [web/tz-lookup.js](web/tz-lookup.js) finds a place's time zone from where it is ([@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup), CC0), so a stop's time is its place's local time; only a zone someone picked by hand is saved (`tz`) |
| [scripts/build.mjs](scripts/build.mjs) | Copies `web/` and `../design-system/` into `public/`, which Wrangler serves. Runs on `dev` and `deploy` |

The frontend saves edits in the background (they show at once) and keeps a WebSocket open on the current trip, so co-editors' changes appear live. A trip can be saved for offline from trip settings: the frontend keeps the trip's last snapshot in `localStorage`, and the app's files and the trip's Stadia tiles in Cache Storage, and [web/sw.js](web/sw.js) serves them when the network can't (see Offline in [the UX design](../docs/ux-design.md#offline)). The API itself isn't cached by the service worker. `../prototype` must stay the same as `web/` apart from the server: make every UX change to both (see [CLAUDE.md](../CLAUDE.md)).

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then set BETTER_AUTH_SECRET
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test                         # unit tests; npm run typecheck checks the Worker and the frontend's pure modules
```

Sign-in offers Google (when its keys are set), email, and guest, one choice per screen. Email asks for the address first, then for its password, to use Google, or to create an account. A Google sign-in isn't joined to an existing password account with the same email, because that email was never verified; the app explains this and points to email sign-in. Email addresses aren't verified and there's no password reset yet: both need an email service. Without `STADIA_API_KEY`, local dev uses the public OSM demo servers for place search and routes; production returns 503 instead.

To try co-editing locally, use a second browser profile (each needs its own session cookie), or open the trip's share link in a private window.

## Deploy

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) checks every pull request (typecheck, unit tests, bundle) and deploys every push to `main`, as long as that commit is still the newest on `main` (two merges close together can start their deploys out of order, and an older commit deployed last would undo the newer one): it applies D1 migrations, then uploads the Worker together with its secrets, then smoke-tests `/api/config`. The production D1 database and KV namespace already exist; their IDs are in `wrangler.jsonc`.

One-time setup, in the GitHub repo under Settings → Secrets and variables → Actions:

| Name | Kind | What |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then add **Account → D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Your Cloudflare account ID |
| `BETTER_AUTH_SECRET` | Secret | Any long random string. Changing it signs everyone out |
| `STADIA_API_KEY` | Secret | Needed for place search and routes in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secrets | Optional: Google sign-in |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` | Secrets | Optional: Apple sign-in |
| `APP_URL` | Variable | Optional: a custom domain, such as `https://dotsie.app`. Without it the app runs at `https://waythread.<your-subdomain>.workers.dev`; with it, that address sends the page on to the custom domain |

Only the secrets you set are uploaded, and a feature whose keys are missing stays off. Register `<app URL>/api/auth/callback/google` (and `/callback/apple`) with each provider, and the app's domain with Stadia so map tiles load. Online, the trip's map is Stadia's style drawn in the browser by [MapLibre](https://maplibre.org/) from Stadia's vector tiles, in two layers so the place and road names sit over the routes (see "The basemap, drawn in the browser" in `web/map.js`); MapLibre and its Leaflet plugin load from unpkg the first time a trip opens. MapLibre fetches vector tiles as the map moves; each tile is fetched once for both layers (`sharedFetch`), and a vector tile covers four picture tiles. Stadia's picture tiles show instead when MapLibre can't run (no WebGL, or it didn't load). Stadia serves its style and fonts to anyone but refuses its vector tiles to a domain not registered with it; a refused tile also puts the picture map back. The picture map prefetches tiles around the view and one zoom level in and out, so zooming doesn't wait on the network; that's roughly 3–4× the tile requests of the visible view alone, which counts against the Stadia plan (`EDGE_TILES` and `PREFETCH_ZOOMS` in `web/map.js` tune it). The vector map doesn't: MapLibre shows the level below until a tile comes. The app also preloads the trip's other days, nearest first, so switching days is quick: each day's drives, and the tiles for the part of that day's view the list doesn't cover, at the zoom it opens at. That's one more view's worth of tiles per trip day per visit (with the picture map, about 6–10 on a phone and 15–25 on a laptop; a quarter of that with the vector map; after that the browser's cache has them), fetched four at a time once the day on screen has loaded. A trip saved for offline keeps the map that was showing: the vector tiles, style, sprite and fonts (the Latin ranges, and any other the map has drawn), or the picture tiles. A trip saved with one kind switches to the other only once that's all saved, and then the first kind's tiles are removed. The OpenStreetMap fallback doesn't prefetch, since its tile policy discourages loading tiles nobody views.

`BETTER_AUTH_URL` isn't in `wrangler.jsonc`: `.dev.vars` sets it locally and the workflow sets it for production, so deploy through the workflow rather than `npm run deploy`.

Zoomed in, the trip's map shows sights nearby: attractions, museums, viewpoints, historic sites and nature from OpenStreetMap, asked of the public [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) a map tile (zoom 12) at a time. Each tile is kept in KV under `sights:v3:x/y` in the `ROUTES` namespace, with when it was looked up, and in the browser for a day, so a tile costs at most one Overpass lookup a month however many people look at it, and none needs a key. Past 30 days a tile is still answered at once from KV and looked up again behind it; if that fails, the kept copy stays. So a place people look at never waits for Overpass again, even when Overpass is down. Each entry expires a year after it was last looked up: one nobody has looked at for a year drops out on its own, like an LRU cache but without a KV write for each read (the free plan allows far fewer writes than reads). Tiles are small (a few KB; at most 80 sights), so even every tile people look at stays well inside KV's storage. D1 holds none of this.

The public Overpass servers are slow because they're busy, not because a tile is big: from a test machine, a query for three museums took maps.mail.ru 15–22 s and a whole tile 20–28 s, and overpass-api.de answered 503 or nothing at all. A request can wait only about 30 s, response and `waitUntil` together, which wasn't enough (asking for a tile in quarters made it worse: four such waits). So a tile no one has looked at is looked up by its own Durable Object, `SightsLookup` in [src/sights.ts](src/sights.ts), one per tile and named by it, whose alarm can run for minutes. It asks both servers at once (overpass-api.de and VK's, at maps.mail.ru), each with a 60 s Overpass time limit, and takes the first good answer; if both fail, it tries once more 15 s later, and then says "failed" for 2 minutes (an hour while an older copy is shown) so a busy Overpass isn't asked again by everyone looking at that tile. Meanwhile `/api/sights` answers 202 and the app asks again every 8 s. What it finds goes into KV, and stays in the object for 10 minutes too, since a KV write can take a while to reach other locations; the object forgets everything an hour on. Each server's failure is logged with its reason (`Overpass maps.mail.ru after 21 s: 504 Gateway Time-out`), in the Worker's logs (observability is on). Overpass's public servers ask for under 10,000 queries a day; if the app outgrows them or they stay this slow, point `OVERPASS` in `src/maps.ts` (and the prototype's copy) at a paid or self-hosted instance. The query asks for relations only for parks and protected areas: a relation is matched by loading its outline, and tiles crossed by huge ones (the missile range next to White Sands) ran out of time. OpenStreetMap has no popularity data, so a sight's rank comes from its kind and whether it has a Wikipedia article or a Wikidata item (see `sightsFrom`). A tile's rank, kinds and fields are fixed when it's cached: after changing them, bump the key's `v3` (it went to `v3` when sights started carrying their Wikidata item).

Tapping a sight opens its card, which asks `/api/about?id=Q123` for the sight's Wikidata item: the Worker looks up the item's English Wikipedia article ([Wikidata API](https://www.wikidata.org/w/api.php)), the article's first three sentences and its lead picture, only a free one ([Wikipedia API](https://en.wikipedia.org/w/api.php), TextExtracts and PageImages), and the picture's author and license, with a 960px-wide copy ([Commons API](https://commons.wikimedia.org/w/api.php)). That's three calls, none needing a key. The answer, or `null` when there's no article, is kept in KV under `about:v1:Q123` the same way as tiles: answered from KV and looked up again behind it once it's 30 days old (7 for `null`, in case an article has been written), and dropped a year after it was last looked up. The browser keeps it a day. When Wikimedia fails, a kept copy answers; with none, it answers 503 and the card goes without. It shares the maps rate limit. A stop added from a sight keeps the item in its `wikidata` field (the `stops` table's `wikidata` column, added to existing trips when their `TripRoom` next starts); moving the stop somewhere else clears it, whoever moves it.

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
| `GET /api/trips/:id` | `{ trip, members, stops }`; `trip.owner` is the id of whoever made it |
| `PATCH /api/trips/:id` `{ name }` | Rename |
| `DELETE /api/trips/:id` · `POST /api/trips/:id/restore` | Soft delete and undo. Owner only (403 `not_owner`) |
| `POST /api/trips/:id/leave` | Leave the trip; your stops stay. Everyone but the owner (the owner gets 400 `invalid`) |
| `GET /api/trips/:id/invite` · `POST …/invite/rotate` | Share link, or a fresh one that kills the old |
| `POST /api/join/:token` | Join through a share link |
| `PUT /api/trips/:id/stops/:stopId` | Create a stop, or restore one (Undo). The client picks the id |
| `PATCH /api/trips/:id/stops/:stopId` | Changed fields only, e.g. `{ kind: 'hotel', nights: 2, checkout: '11:00' }`. `links` is the whole list, `[{ url, label }]`: up to 10 http(s) pages, `label` up to 60 characters (`''` shows the page's site) |
| `DELETE /api/trips/:id/stops/:stopId` | |
| `GET /api/trips/:id/live` (WebSocket) | `stop.upserted`, `stop.removed`, `member.joined`, `member.updated`, `member.left`, `trip.updated`, `trip.deleted`, each with `by` |
| `GET /api/places?q=&near=lat,lng` | Place search: `[{ name, address, lat, lng, category }]`. The category feeds the app's first guess at a stop's type |
| `GET /api/sights?tile=12/x/y` | What's worth seeing in one map tile at zoom 12: `[{ id, name, address, lat, lng, kind, rank }]`, at most 80, best ranked first. `kind` is `attraction`, `museum`, `viewpoint` or `nature`; `rank` is higher for better known places. 202 `{ pending: true }` while a tile no one has looked at yet is looked up (ask again in a few seconds); 503 `unavailable` when Overpass is down or busy |
| `GET /api/route?from=lat,lng&to=lat,lng&mode=` | `{ duration, distance, coords }`. `mode` is `drive` (the default), `walk` or `bike` |
| `GET /api/assistants` | For Account: `{ url, connections: [{ id, name, domain, createdAt }] }`, the MCP server's address and the assistants you've allowed |
| `DELETE /api/assistants/:id` | Disconnect one: its tokens stop working at once |
| `POST /api/mcp` | The MCP server (below), with an OAuth access token |
| `GET`·`POST /api/oauth/authorize` | The Allow page an assistant sends you to (a page, not JSON) |
| `/api/oauth/token`, `/api/oauth/register`, `/.well-known/oauth-*` | OAuth's token, client registration and discovery endpoints, answered by the library |

A stop is `{ id, name, address, lat, lng, time, note, kind, nights, checkout, travel, back, by, updatedAt }`. `time` is trip-local `YYYY-MM-DDTHH:MM`. `kind` is `''` (the app guesses from the name) or one of `place`, `airport`, `hotel`, `restaurant`, `cafe`, `attraction`, `museum`, `viewpoint`, `nature`, `shopping`, `gas`. `nights` is for a hotel: 1–30, or `null` to last until the next hotel or the trip's last day. `checkout` is a hotel's check-out time, `HH:MM`, on the day its nights end, or `null` (the app shows 11:00 AM). Other stops have `null`; a time some older clients saved there as a leave time is ignored. `travel` is how you get to the stop from the place before it (for a hotel, on its check-in day): `drive` (the default), `walk`, `bike`, `transit` or `flight`. `back` is a hotel's way back to it each night, by the day: `{ "2026-03-14": "walk" }`; nights not in it are drives, and a `drive` sent in it is dropped. Other stops have `{}`. A PATCH replaces the whole of it. Drives, walks and rides follow a route (`/api/route` with that `mode`); transit and flights have none, and the app draws them straight, with no time. Stops still carry `done`, which older clients set; the app no longer shows it.

Errors are `{ error }` with 400 `invalid`, 401 `unauthorized`, 403 `not_member` or `not_owner`, 404 `not_found`, 410 `gone`, 429 `rate_limited`, or 503 `maps_not_configured`.

## MCP server

`/api/mcp` lets an AI assistant (Claude, or any client that speaks [MCP](https://modelcontextprotocol.io)) read your trips and add, edit and delete their stops as you. It signs in with OAuth, so all an assistant needs is the address, `https://<app URL>/api/mcp`, which Account shows under **AI assistant**.

- **Claude (web, iOS, Android, Desktop):** in Claude on the web, Customize → Connectors → Add custom connector, paste the address, then Connect. Claude opens Dotsie: sign in if you aren't, then Allow. Connectors belong to your Claude account, so one added on the web works in the mobile apps too, and in Claude Code sessions on the web and in the app.
- **Claude Code in a terminal:**

  ```bash
  claude mcp add --transport http dotsie https://<app URL>/api/mcp
  ```

  then run `/mcp` in Claude Code and pick dotsie to sign in.
- **Other clients:** a Streamable HTTP server at that address, with OAuth sign-in.

Claude reaches the server from Anthropic's cloud, so a connector needs the deployed app; `wrangler dev` works with Claude Code on the same machine. Locally, use `http://localhost:8787` (what `BETTER_AUTH_URL` says), not `127.0.0.1`, since the OAuth issuer and resource are that address.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_trips` | none | `{ trips: [{ id, name, start, end }] }`, newest edit first |
| `list_stops` | `trip_id`, optional `day` (`YYYY-MM-DD`) | `{ trip, stops }`, in time order |
| `add_stop` | `trip_id`, `name`, `lat`, `lng`, `time`, and any of `address`, `checkout`, `kind`, `nights`, `note`, `links` | `{ stop }`, as saved, with its new id |
| `edit_stop` | `trip_id`, `stop_id`, and any of `name`, `address`, `lat`, `lng`, `time`, `checkout`, `kind`, `nights`, `note`, `links` | `{ stop }`, as saved. `links` replaces the whole list |
| `add_link` | `trip_id`, `stop_id`, `url`, optional `label` | `{ stop }`, as saved. Adds the page to the stop's links, keeping the others; a page it has already only gets the new label |
| `delete_stop` | `trip_id`, `stop_id` | `{ deleted }`: the stop as it was, so `add_stop` can put it back |

`links` takes what models send when they guess, or when their copy of the tools is older than links: a JSON string, bare addresses, one link on its own, `title` for `label`, an address without `https://`. A tool error names the field that's wrong and what it should be. Bump `SERVER.version` in `src/mcp.ts` whenever a tool or its arguments change, so clients have a reason to fetch the tools again.

A stop here is the API's stop without `done`, with `by` swapped for `updatedBy` (a name) and `updatedAt` as an ISO time. Changes go through `TripRoom`'s `putStop`, `patchStop`, `addLink` and `deleteStop`, like the app's: the same checks, and everyone with the trip open sees them live.

How it's built:

- **Transport** ([src/mcp.ts](src/mcp.ts)): Streamable HTTP without sessions. Each POST is one JSON-RPC message, answered with JSON (or 202 for a notification). There's no event stream, so GET is 405. It answers `initialize`, `ping`, `tools/list` and `tools/call`.
- **Sign-in** ([src/oauth.ts](src/oauth.ts)): OAuth 2.1 by [`@cloudflare/workers-oauth-provider`](https://www.npmjs.com/package/@cloudflare/workers-oauth-provider), which wraps the Worker. It publishes the discovery documents (`/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`), registers clients by Client ID Metadata Document (what Claude uses) or dynamic registration, issues and refreshes tokens (PKCE S256 only), and checks the token on every `/api/mcp` call. One scope, `trips`. An access token lasts an hour; a connection lasts while it's used and ends after 90 days without, like a session.
- **The Allow page** is ours: `/api/oauth/authorize` uses the app's session cookie. Signed out, it sends you to the app's sign-in (`/?next=…`), which comes back once you're in. It names the assistant (with its verified domain when it has one), what it can do, where access goes, and who you're signed in as. Guests can't connect one, since their trips are only reachable from their own browser.
- **Storage:** clients, grants and tokens live in KV as `OAUTH_KV`, with tokens and codes stored only as hashes. It's the same namespace as `ROUTES` (their keys don't overlap), so a deploy needs nothing created first; give it its own namespace whenever you like (existing connections then have to connect again). `global_fetch_strictly_public` keeps the library's fetches of client metadata on the public internet.
- **Errors:** a bad id, a field that fails validation, or a trip you're not on comes back as a tool result with `isError`, so the assistant can read why and try again. A missing, expired or revoked token is 401 with a `WWW-Authenticate` challenge that points to the discovery document.
- **Not yet:** place search, so `add_stop` has to be given a place's coordinates.
