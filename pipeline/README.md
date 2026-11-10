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
| `destinations.json` | The destinations with a guide: cities, counties and national parks, each with its Wikidata item, its outline's ID (Census place or county, NPS unit), its state and how many picks at most |
| `destinations.py` | Adds every national park, or a state's counties, to `destinations.json`; and plans a guides run, one job per state |
| `load_d1.sh` | Loads the SQL files both workflows leave in R2 into D1, one state at a time |
| `states.json` | The 50 states and DC, with their Wikidata items |
| `../.github/workflows/spots-data.yml` | Runs both every month on GitHub Actions and keeps the results in R2 |
| `../.github/workflows/spots-guides.yml` | Runs `guides.py` by hand for the destinations you name, a job per state, saves the answers in each state's store in R2, and loads the guides into D1 |

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

After saving a state's store, the workflow writes it as SQL for D1 (`places`, `place_links`, `place_schemes`,
`place_loads`; see `app/migrations/0004_places.sql`) and keeps the file in R2 under `d1/`. Once every state is built, one
job loads those files one at a time, each replacing its state's rows: D1 serves no queries while it imports a file (the
app's sign-in included, a few seconds a state), and two imports at once can trip over each other. A loaded file is
removed from R2, so a state that failed to build keeps the rows it had. The app shows the result at `/developer/spots`:
search by name, filter by state and source, and open a place to see its identifiers and the records in other sources
that share one. Only metadata and links are loaded, never text copied from Wikipedia or other sites.

Search goes through a full-text index on names (`places_fts`, `app/migrations/0007_places_search.sql`), kept in step by
triggers on `places`, so a search reads only the places whose words match, not the whole table. That's why the export
writes `places` with an upsert rather than `INSERT OR REPLACE`: REPLACE would delete a row that's in two states (a river,
a park across a state line) without the triggers seeing it.

## The guide

Only places worth a special trip, about 10 to 20 for a city or a park, each with a one-liner and two or three
paragraphs in a travel guide's voice (under two minutes to read), practical facts kept apart, and photos from Wikimedia
Commons. `guides.py` makes them for a destination in `destinations.json`, from its state's store:

1. Candidates: places inside the destination's outline with an English Wikipedia article or an NPS page. A city's
   outline is its Census place, a county's its Census county (both from TIGERweb), a park's its NPS boundary (the
   NPS Land Resources Division's); all of their parts, islands included. A park across a state line (Yellowstone,
   the Great Smokies) also reads the stores of its `other_states`; its guide is kept in its own state's store.
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
run the Spots guides workflow (Actions → Spots guides → Run workflow) when you want them rewritten, naming the
destinations: ids (`seattle,yellowstone`), `parks`, `counties`, `cities`, a state's code (`WA`: every destination kept
in Washington's store) or `all`. It runs a job per state, four at a time, each state's destinations one after another
(they write the same store); one that fails doesn't stop the others. The run's summary lists what it will make and
what that costs at most. Answers whose input didn't change are reused, so a second run costs little; a first run for
Seattle cost $2.34 (Haiku $0.24 to judge 1,064 candidates, Opus $2.10 to pick 19 and write and illustrate them), so all
the national parks come to about $150. The result is at `/developer/guide`, for review, and on the app's Spots page
(`#/spots`), open to anyone, most viewed first.

`destinations.json` has Seattle and the 60 national parks in a state (American Samoa's and the Virgin Islands' are
left out with their territories). To add more:

```bash
python3 destinations.py parks          # national parks the file doesn't have yet
python3 destinations.py counties WA    # every county in Washington (39)
```

They're added as found, never changed after: edit an entry by hand (its cap, its name, its state). A park's state is
the one its centre is in, which can be wrong for a small park on a state line: Gateway Arch's centre is in the
Mississippi, on Illinois' side, so its entry was set to Missouri by hand. A city is added by hand, with its Wikidata
item and its 7-digit Census place (state and place FIPS codes, `5363000` for Seattle).

On this machine, with `ANTHROPIC_API_KEY` in `pipeline/.env` and the destinations' stores in `data/`:

```bash
python3 guides.py --destination seattle olympic
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

## Every state at once

Washington, from scratch: 28,771 places in D1, 145,703 rows written (the delete, the rows, their indexes), 54 minutes
to build. Every state is about 40 times that, so roughly a million places, 6 to 10 million rows written and half a GB
in D1; the stores in R2 come to a few GB. To load them all:

1. **Cloudflare Workers Paid** ($5 a month). D1's free plan allows 100,000 rows written a day and 500 MB a database, and
   this one also holds the app's accounts: a full load would hit both. Paid includes 50 million rows written a month and
   10 GB a database.
2. **GitHub Actions minutes.** From scratch, every state takes about 40 runner hours (half an hour to an hour a state,
   California, Texas and New York longer), and the repository is private: more than GitHub Free's 2,000 minutes a month
   (about $15 more at $0.006 a minute), so add a payment method or split the run across two months.
3. Merge and deploy, so D1 has `places_fts` (migration 0007) before anything is loaded into it.
4. Actions → Spots data → Run workflow with `all` (page views are already in R2). Four states build at a time; the whole
   run takes about half a day. A state that runs into the 5-hour limit saves what it fetched: **Re-run failed jobs**
   carries on from there, and the load job loads whatever finished.

The sources see four states at a time: Wikidata 8 requests at once from each, Wikipedia 4, websites 16 (different
hosts), and the NPS API a few requests a state. Every request waits as long as `Retry-After` says when it's turned away.

The monthly run that follows only fetches what changed: a fraction of the time.

## What it costs

R2's free tier (10 GB stored, a million writes a month) holds every state's store.
