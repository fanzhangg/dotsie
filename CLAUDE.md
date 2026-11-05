# Waythread

| Folder | What it is |
| --- | --- |
| [`app/`](app) | The product: a Cloudflare Worker (`app/src`) and its frontend (`app/web`). See [app/README.md](app/README.md) |
| [`prototype/`](prototype) | The same frontend with no backend: data in localStorage, open tabs sync to simulate co-editing |
| [`design-system/`](design-system) | Tokens, components and icons both of them use. See its [README](design-system/README.md) |
| [`docs/`](docs) | The proposal and the [UX design](docs/ux-design.md) |

## Keep the prototype's UX the same as the product's

`prototype/` must always look and behave like `app/web`. Any change to what people see or do, in either one, goes into the other **in the same change** (same commit or PR). Don't leave it for later.

- `prototype/app.js` is `app/web/app.js` with its backend swapped out: the sections marked *Prototype only* (a pretend `/api`, the session, live edits over a BroadcastChannel, the note in trip settings) replace the app's, and the app's *Sign in* section is left out. Everything else is the same, line for line, so `diff app/web/app.js prototype/app.js` shows only those sections. Port a change by applying the same edit to both files.
- `prototype/styles.css` is `app/web/styles.css` plus `.proto-note`. `prototype/index.html` differs only in the `../design-system/` paths.
- What stays product-only, because the prototype has no server: sign-in and accounts (the prototype uses `?as=` instead), connecting an AI assistant (OAuth and its Allow page), the API, and the WebSocket (the prototype uses localStorage and a BroadcastChannel). Wherever the product has UI for these, such as the share link and its new-link button, the prototype fakes it locally rather than leaving it out.
- Before finishing a change to either one, run `diff app/web/app.js prototype/app.js` and `diff app/web/styles.css prototype/styles.css` and check that nothing outside those sections differs. Then open both and try the change in each.
- If a docs page or the design system's README describes the change, update it once for both.

## Running

- Prototype: `python -m http.server 5173 -d .` from the repo root, then open `http://localhost:5173/prototype/`.
- App: see [app/README.md](app/README.md) (`npm --prefix app run dev`, port 8787). `.claude/launch.json` has both.
