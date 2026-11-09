# Spots data

Collects what outside sources say about places in the US, one state at a time, for the spots database
([#90](https://github.com/fanzhangg/waythread/issues/90)). Nothing is filtered or judged at this stage: every
record goes in as the source gave it, and records are linked only through identifiers they share.

| File | What it does |
| --- | --- |
| `store.py` | Builds or updates one state's store, `data/<ST>.sqlite` |
| `pageviews_month.py` | One month of English Wikipedia page views, from Wikimedia's monthly dump |
| `states.json` | The 50 states and DC, with their Wikidata items |
| `../.github/workflows/spots-data.yml` | Runs both every month on GitHub Actions and keeps the results in R2 |

The other scripts here (`step*.py`, `llm_*.py`, `sources.py`) are the earlier pilots in #90: rule-based
scoring and model ratings tried on Washington, Seattle, Portland and Santa Fe.

## What a state's store holds

| Table | Rows |
| --- | --- |
| `records` | Every Wikidata item located in the state that has coordinates, and every record the NPS Data API lists for it (parks, places, things to do, visitor centers, campgrounds, tours, webcams), with the source's raw JSON (Wikidata without references) |
| `ids` | Every identifier on a record: Wikidata external IDs and items, sitelinks, NPS URLs and park codes |
| `links` | Two records from different sources that share an identifier, such as a Wikidata item's NPS place ID (`P8649`) or park code (`P4083`), or the same website |
| `documents` | The English Wikipedia article and the official website's first page (`P856`), as text, zlib-compressed |
| `categories` | English Wikipedia categories per article |
| `pageviews` | English Wikipedia views per article per month, for the last 12 months |
| `properties` | Wikidata property labels, to read the raw claims |

A run fetches only what changed since the last one: Wikidata items and Wikipedia articles whose revision
changed, websites not fetched in 90 days, months of page views it doesn't have yet. The NPS API is read whole
each time (a few requests per state).

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

## What it costs

A first run builds every store from scratch: roughly half an hour per state, more for California, Texas or New
York, and up to half an hour per month of page views. A full first run of all states can use most of a GitHub Free
account's monthly Actions allowance ($12 of compute, about 2,000 Linux minutes for a private repository), so run
it a few states at a time, or add a payment method. Later runs only fetch what changed and take a fraction of that.

R2's free tier (10 GB stored, a million writes a month) holds every state's store.
