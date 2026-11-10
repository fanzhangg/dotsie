# Spots data

Collects what outside sources say about places in the US, one state at a time, for the spots database
([#90](https://github.com/fanzhangg/waythread/issues/90)). Nothing is filtered or judged at this stage: every
record goes in as the source gave it, and records are linked only through identifiers they share.

| File | What it does |
| --- | --- |
| `store.py` | Builds or updates one state's store, `data/<ST>.sqlite` |
| `pageviews_month.py` | One month of English Wikipedia page views, from Wikimedia's monthly dump |
| `export_d1.py` | A state's store as SQL for D1, for the public page at `/developer/spots`: metadata and links, no page text. With `--guides`, the state's guidebook entries instead |
| `guides.py` | A destination's picks and their guidebook entries, written by Claude from the store, kept in the store |
| `destinations.json` | The destinations with a guide: a city's Wikidata item, its Census place (its boundary), how many picks at most |
| `states.json` | The 50 states and DC, with their Wikidata items |
| `../.github/workflows/spots-data.yml` | Runs both every month on GitHub Actions and keeps the results in R2 |
| `../.github/workflows/spots-guides.yml` | Runs `guides.py` by hand for one destination, saves its answers in the state's store in R2, and loads the guide into D1 |

The other scripts here (`step*.py`, `llm_*.py`, `sources.py`) are the earlier pilots in #90: rule-based
scoring and model ratings tried on Washington, Seattle, Portland and Santa Fe.

## What a state's store holds

| Table | Rows |
| --- | --- |
| `records` | Every Wikidata item located in the state that has coordinates, and every record the NPS Data API lists for it (parks, places, things to do, visitor centers, campgrounds, tours, webcams), with the source's raw JSON (Wikidata without references) |
| `ids` | Every identifier on a record: Wikidata external IDs and items, sitelinks, NPS URLs and park codes |
| `links` | Two records from different sources that share an identifier (ignoring case: Wikidata writes park codes in capitals, NPS in lower case), such as a Wikidata item's NPS place ID (`P8649`) or park code (`P4083`), or the same website. And, kept apart by their `via` (`name`, `similar name`), records that are probably the same place: within 1 km, with the same name once written alike, or one only an apostrophe or a space apart (a name only inside the other doesn't count) |
| `documents` | The English Wikipedia article's wikitext (infoboxes included), and the official website's first page (`P856`) as text, zlib-compressed |
| `categories` | English Wikipedia categories per article |
| `pageviews` | English Wikipedia views per article per month, for the last 12 months |
| `properties` | Wikidata property labels, to read the raw claims |
| `llm_answers` | Every model answer `guides.py` used, by step, place and prompt version, with a hash of what it was asked: asked again only when that changes |
| `destinations`, `picks`, `guides` | Written by `guides.py`: each destination's picks in order (with the model's reason, and what it left out), and each pick's entry |

A run fetches only what changed since the last one: Wikidata items and Wikipedia articles whose revision
changed, websites not fetched in 90 days, months of page views it doesn't have yet. The NPS API is read whole
each time (a few requests per state).

## The public page

After saving a state's store, the workflow loads it into D1 (`places`, `place_links`, `place_schemes`, `place_loads`;
see `app/migrations/0004_places.sql`), replacing that state's rows. The app shows it at `/developer/spots`: search by name, filter
by state and source, and open a place to see its identifiers and the records in other sources that share one. Only
metadata and links are loaded, never text copied from Wikipedia or other sites.

Search matches names with `LIKE`, which reads the whole table: fine for a few states on D1's free plan (5 million rows
read a day). Each load rewrites the state's rows, which counts against the free plan's 100,000 rows written a day, so
loading many states, or all of them, needs Workers Paid; a full-text index can replace `LIKE` then.

## The guide

Only places worth a special trip, about 10 to 20 for a city, each with a one-liner and two or three paragraphs in a
travel guide's voice (under two minutes to read), practical facts kept apart, and photos from Wikimedia Commons.
`guides.py` makes them for a destination in `destinations.json`, from its state's store:

1. Candidates: places inside the city's Census boundary with an English Wikipedia article or an NPS page.
2. Is it a sight (Haiku, every candidate): somewhere people go to see or experience, still there, open to visitors,
   not part of a bigger place nearby. The only hard rules are on what can never be a sight.
3. Shortlist: the 70 sights most read on English Wikipedia, only to narrow the field.
4. Pick (Opus): what a visitor with a few days shouldn't miss, at most `cap`, compared with each other, with what it
   left out and why.
5. Write (Opus): each entry from the store's dossier only (Wikipedia wikitext, the official site's page, NPS pages),
   each paragraph with its sources. The share of its 8-word phrases also in the sources is kept, to spot copying.
6. Pictures (Opus, looking at them): a lead photo and up to two more, each after the paragraph it shows, with author
   and licence.

Entries are adapted from the sources each lists and published under CC BY-SA 4.0. They aren't updated on their own:
run the Spots guides workflow (Actions → Spots guides → Run workflow, with the destination's id) when you want them
rewritten. Answers whose input didn't change are reused, so a second run costs little; a first run for a city costs
about $2 (Haiku $0.25, Opus $1.80). The result is at `/developer/guide`, for review before it reaches the app.

On this machine, with `ANTHROPIC_API_KEY` in `pipeline/.env` and the state's store in `data/`:

```bash
python3 guides.py --destination seattle
```

## Running it

On GitHub: the workflow runs on the 3rd of each month. To run it by hand, open Actions → Spots data → Run
workflow, and name the states (`WA,OR`, or `all`) and how many months of page views R2 should have.

On this machine, to try a change on a few items:

```bash
python3 store.py --state DC --limit 20
```

## One-time setup

1. In Cloudflare, create an R2 bucket named `waythread-spots` (or set the repository variable `SPOTS_BUCKET` to
   another name).
2. Under R2 → Manage API tokens, create a token with Object Read & Write on that bucket. Add its Access Key ID and
   Secret Access Key as repository secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
3. Get a free key at [developer.nps.gov](https://www.nps.gov/subjects/developer/get-started.htm) and add it as the
   secret `NPS_API_KEY` (the public `DEMO_KEY` allows only 50 requests a day).
4. `CLOUDFLARE_ACCOUNT_ID` is already a repository variable for the deploy workflow; this one uses it too.
5. Run the workflow once with `months` set to 12, to fill R2 with a year of page views.
6. For the guide, add an [Anthropic API key](https://console.anthropic.com/settings/keys) as the secret `ANTHROPIC_API_KEY`.

## What it costs

A first run builds every store from scratch: roughly half an hour per state, more for California, Texas or New
York, and up to half an hour per month of page views. A full first run of all states can use most of a GitHub Free
account's monthly Actions allowance ($12 of compute, about 2,000 Linux minutes for a private repository), so run
it a few states at a time, or add a payment method. Later runs only fetch what changed and take a fraction of that.

R2's free tier (10 GB stored, a million writes a month) holds every state's store.
