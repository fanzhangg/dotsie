# Dotsie

| Folder | What it is |
| --- | --- |
| [`app/`](app) | The product: a Cloudflare Worker (`app/src`) and its frontend (`app/web`). See [app/README.md](app/README.md) |
| [`prototype/`](prototype) | The app's frontend with a pretend backend: data in localStorage, open tabs sync to simulate co-editing |
| [`design-system/`](design-system) | Tokens, components and icons both of them use. See its [README](design-system/README.md) |
| [`docs/`](docs) | The proposal and the [UX design](docs/ux-design.md) |

## The prototype runs the app's own frontend

`prototype/` is `app/web` with no server. Its `index.html` loads the app's modules from `../app/web`, and an import map puts `prototype/backend.js` in place of `app/web/backend.js`, so there is one frontend and the two can't drift apart: a change to what people see or do in `app/web` is in the prototype too.

- `prototype/backend.js` has the same exports as `app/web/backend.js` (`api`, `connectLive`, `disconnectLive`, `signOut`, `settingsNoteHTML`) and answers them in the browser: trips in localStorage, live edits between open tabs over a BroadcastChannel, `?as=` instead of sign-in. When the app's API changes (a route, a field, a rule such as who may delete a trip), change its pretend `/api` the same way **in the same change** (same commit or PR).
- Everything else in `prototype/` points at the app's files: `index.html` (the same as `app/web/index.html` with `../app/web/` and `../design-system/` in front, plus the import map and `proto.css`), `sw.js` (imports the app's), `manifest.json` (the app's, with the icons' paths) and `proto.css` (`.proto-note`, the note `settingsNoteHTML` puts in trip settings). A new module goes in the modulepreload list of both `index.html` files; `npm --prefix app test` checks that.
- What stays product-only, because the prototype has no server: sign-in and accounts (the prototype uses `?as=` instead), connecting an AI assistant (OAuth and its Allow page), the API, and the WebSocket. Their screens are in the shared frontend; the prototype's backend fakes what it can, such as the share link and its new-link button, and never reaches the sign-in screen.
- Before finishing a change, run `npm --prefix app test` and `npm --prefix app run e2e`, then open both and try the change in each. A change to what people see or do gets an end-to-end test in `app/e2e`: `prototype.spec.js` for the shared frontend, `map.spec.js` for the map (through what people see on it: pins, taps, the camera), `app.spec.js` for what only the product has.
- If a docs page or the design system's README describes the change, update it once for both.

## Running

- Prototype: `python -m http.server 5173 -d .` from the repo root, then open `http://localhost:5173/prototype/`.
- App: see [app/README.md](app/README.md) (`npm --prefix app run dev`, port 8787). `.claude/launch.json` has both.
