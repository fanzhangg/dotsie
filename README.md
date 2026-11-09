# Dotsie

Plan your next road trips with your friends and AI agents.

A trip is a map and a list of stops that everyone can co-edit. Save ideas straight into the plan as stops, let your AI assistant add recommendations and bookings through the MCP server, and follow along on your phone while you're on the road. See the [product vision](docs/product-vision.md) and the [UX design](docs/ux-design.md).

## What's here

| Folder | What it is |
| --- | --- |
| [`app/`](app) | The product: a Cloudflare Worker (`app/src`) and its frontend (`app/web`). See [app/README.md](app/README.md) |
| [`prototype/`](prototype) | The same frontend with no backend: data in localStorage, open tabs sync to simulate co-editing |
| [`design-system/`](design-system) | Tokens, components and icons both of them use. See its [README](design-system/README.md) |
| [`pipeline/`](pipeline) | Collects what outside sources say about places, for the spots data |
| [`docs/`](docs) | The product vision and the UX design |

## Running

Prototype, from the repo root:

```bash
python -m http.server 5173 -d .
```

Then open <http://localhost:5173/prototype/>.

App (port 8787), see [app/README.md](app/README.md) for setup:

```bash
npm --prefix app run dev
```
