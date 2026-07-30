# building-permits

Scraper for Israeli municipal **building permits** (היתרי בניה) and **active construction sites** (אתרי בניה), starting with Tel Aviv-Yafo.

Built as a **self-contained unit**: no database, no host config, no third-party dependencies. It runs standalone from the command line and plugs into a host application through a small adapter. That is deliberate — it is meant to survive being moved to another repository. See [CLAUDE.md](./CLAUDE.md) for the rules that keep it that way.

---

## Quick start

No install required (Node 18+; developed on Node 24).

```bash
cd server/api/lib/building_permits

node bin/cli.js list                 # what sources exist
node bin/cli.js validate             # are the upstream layers still as we expect?
node bin/cli.js stats                # how many features upstream right now

# a small smoke crawl, written to disk
node bin/cli.js crawl --max 50 --out /tmp/permits.json

# everything granted or started since Jan 2026, as GeoJSON
node bin/cli.js crawl --since 2026-01-01 --out /tmp/recent.geojson

npm test                             # 50+ offline fixture tests
```

---

## The data source

Both layers live on Tel Aviv's public, unauthenticated ArcGIS REST service. No API key, no session, no scraping of HTML.

```
https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/<layer>
```

| Layer | Name | Features | What it is |
|---|---|---|---|
| **772** | בקשות והיתרי בניה | ~10,600 | One polygon per permit request, with its full date timeline and current status |
| **499** | אתרי בניה | ~1,600 | Sites under active supervision, with fine-grained on-site progress |

These are the same layers the public [iView2 map viewer](https://gisn.tel-aviv.gov.il/iView2js4/index.aspx) draws; the viewer is just a client of this service.

Two properties worth knowing:

- **Geometry arrives as WGS84 lon/lat.** The layers store ITM (EPSG:2039) but `f=geojson` reprojects on the way out, so no projection library is needed. A test asserts coordinates land inside Israel, which fails loudly if that ever changes.
- **Geometry is `Polygon` *or* `MultiPolygon`.** Measured on a 1,000-record sample: ~99.5% Polygon, ~0.5% MultiPolygon (permits whose parcels are not contiguous). A database column must accept both — MySQL `GEOMETRY` does; a `POLYGON`-typed column would reject ~50 of the 10,561 permits.
- **Layer 772 carries its own history.** `open_request`, `permission_date` and `tr_hathalat_bniya` mean you get each permit's timeline retroactively, from the very first crawl — no snapshotting needed to answer "when was this permit granted".

### Permit lifecycle (layer 772, `building_stage`)

An ordered ladder, exposed as `stage` plus a numeric `stageOrder`:

```
0  בתהליך היתר                    permit in process
1  קיים היתר                      PERMIT GRANTED  <-- construction imminent
2  בבניה                          under construction
3  קיימת לפחות תעודת גמר אחת      at least one completion certificate
4  קיים אכלוס                     occupied
```

### Site progress (layer 499, `matzav_bniya`)

```
פתיחת תיק -> פיצול תיק לבניה בשלבים -> תחילת עבודות ->
עבודות עפר וביסוס -> גמר יסודות -> גמר שלד -> גמר בניה
```

Layer 499 additionally carries `status_pikuach` with 22 finer-grained values (`פרוטוקול התחלת בניה`, `אישור פסולת חתום`, `הפקת תעודת גמר`, …). It is current-state only, so progression there is observable **only** by diffing between crawls.

### Joining the two layers

`site.trackingFile` (`tik_tipul`) matches `permit.trackingFiles[]` (`tik_tipul_1..5`). Both also carry `buildingFileId` (`ms_tik_binyan`) as a looser link.

---

## Alerting: "a building will start construction near me"

This is the use case the unit is designed around, and it drives one non-obvious decision.

**The signal is a status change, not a new row.** A permit that has existed for two years and only now flips to `קיים היתר` is exactly what a resident wants to hear about — and a crawler that only looks for new rows would miss every one of them. So each crawl diffs against what is stored and reports changes.

`crawl()` returns `imminentChanges`, filtered by `isImminentConstruction()`, which fires on:

1. `stage` advancing **to** `קיים היתר` — approved, work can begin
2. `constructionStartedAt` gaining a value — work has actually begun

Changes are classified `advanced: true/false` so forward movement is distinguishable from a data correction or a backwards edit. Only forward movement alerts.

Rough volumes at the time of writing: **784 permits granted in 2026, 217 construction starts in the last 90 days** — a very manageable alert stream.

---

## Output shape

Canonical field names are the contract; see [`src/schema.js`](./src/schema.js) for the full typedefs. A permit record, abridged:

```js
{
  kind: 'building_permit',
  sourceId: '970',
  dedupeKey: 'tlv-permit-req-20220582-970',  // one per polygon
  groupKey:  'tlv-permit-req-20220582',      // shared by a permit's parcels

  requestNumber: 20220582,
  permitNumber: 20240134,
  stage: 'קיים היתר',
  stageOrder: 1,
  address: 'שילר שלמה 6',
  housingUnits: 3,
  tama38: { applies: false, isNew: false, isAddition: false },

  requestOpenedAt:       '2022-03-01T09:12:00.000Z',
  permitGrantedAt:       '2022-05-09T17:44:00.000Z',   // the "promoted" moment
  constructionStartedAt: '2026-02-16T00:00:00.000Z',

  geometry: { type: 'Polygon', coordinates: [...] },   // WGS84
  sourceFields: { /* all 43 raw attributes, verbatim */ }
}
```

**Every raw attribute is preserved under `sourceFields`.** Typed top-level fields exist for what we filter, join and alert on; everything else stays available for later analysis without re-crawling. That includes the rich free-text fields (`tochen_bakasha` runs to 4,000 characters and describes what is being demolished and built, unit counts, parking, even pool volumes).

### Multi-parcel permits — an important gotcha

10,561 features carry only **8,921 distinct** `request_num` values. A permit spanning several parcels is published as one feature per polygon with otherwise identical attributes.

So `dedupeKey` includes the ArcGIS object id (one key per polygon, nothing lost) while `groupKey` is shared across a permit's polygons. **Group on `groupKey` when alerting**, or a resident gets one email per parcel.

The tradeoff: if a layer is ever fully republished with renumbered object ids, keys change and rows look new. That is visible (a crawl reporting ~10k "new" records) and much better than silently discarding geometry on every ordinary run.

---

## CLI reference

```
node bin/cli.js <crawl|list|validate|stats|help> [options]

  --source <names>   comma-separated source names, or 'all' (default: all)
  --year <YYYY>      filter permits by request-opened year
  --since <DATE>     only records with recent activity (YYYY-MM-DD)
  --bbox <W,S,E,N>   only records intersecting this lon/lat envelope
  --near <LON,LAT>   only records within --radius of this point
  --radius <METERS>  radius for --near (default 500)
  --within           require full containment instead of intersection
  --max <N>          cap features per source (smoke tests)
  --page-size <N>    features per request (default 1000, upstream max 2000)
  --out <file>       write records as JSON (.geojson -> FeatureCollection)
  --changes <file>   write the detected status-change log
  --state <file>     a previous --out file, to diff against
  --geojson          force FeatureCollection output
  --no-geometry      strip geometry from output
  --dry-run          never write to the store
  --quiet / --debug  logging volume
```

`--state` is how you detect status changes **without a database**: keep the previous run's `--out` file and pass it back in.

```bash
node bin/cli.js crawl --out today.json --state yesterday.json --changes changes.json
```

### Scoping by area

Filtering happens **server-side**, so an area-scoped crawl is small and fast rather than "fetch everything and discard".

```bash
# how big is this going to be? one tiny request, no data fetched
node bin/cli.js stats --near 34.7749,32.0754 --radius 300

# 500m around a point (the shape of a "near me" alert query)
node bin/cli.js crawl --near 34.7749,32.0754 --radius 500 --out area.geojson

# a neighbourhood envelope
node bin/cli.js crawl --bbox 34.770,32.063,34.780,32.070 --out area.geojson

# area and time compose
node bin/cli.js crawl --near 34.7749,32.0754 --radius 300 --since 2026-01-01
```

Measured effect of narrowing, on the permits layer:

| Filter | Features |
|---|---|
| none | 10,561 |
| 1000m radius | 1,321 |
| 300m radius | 145 |
| 300m radius + granted since 2026 | 14 |

`stats` accepts the same filters and costs one request per source, so **check the size before you fetch**. Programmatically the same thing is the `area` option: `{bbox: [w,s,e,n]}`, `{center: [lon, lat], radiusMeters: n}`, or `{geometry: <GeoJSON Polygon>}` — the last one takes an arbitrary polygon, so a subscriber's saved area-of-interest can be passed straight through. Coordinates are lon/lat (WGS84); add `--within` (or `spatialRel: 'esriSpatialRelWithin'`) for strict containment instead of intersection.

---

## Moving this to another repository

This folder is self-contained by design and verified so by `test/isolation.test.js`: every import is either relative-internal or a Node built-in, and there are no third-party dependencies. Moving it is a copy.

### The move

```bash
# 1. copy the folder as-is
cp -r /path/to/old/server/api/lib/building_permits /path/to/new-repo/<wherever>

# 2. prove it survived the trip — no install, no database, no network for the tests
cd /path/to/new-repo/<wherever>/building_permits
npm test                  # expect 70 passing

# 3. prove it still reaches the source
node bin/cli.js validate
node bin/cli.js crawl --max 20 --out /tmp/check.json
node bin/inspect.js /tmp/check.json
```

If `npm test` passes in the new location, the move is complete. Nothing else in this folder needs editing — no paths, no config, no imports.

These steps were rehearsed by copying the folder to an unrelated directory and running all four: 72 tests passed, `validate` and `crawl` reached the live service, and `inspect` produced its report — all with no install and no configuration.

**As a standalone repo instead of a subdirectory:** the folder already has its own `package.json` with a `bin` entry, so `git init && npm test` works immediately, and `npm link` (or a git dependency) makes `building-permits` importable elsewhere. Drop `"private": true` from `package.json` if you intend to publish it.

### What does NOT come along

Everything Meirim-specific lives *outside* this folder and is deliberately left behind. In the old repo that was:

| File | What it did | In the new repo |
|---|---|---|
| `api/lib/building_permits_adapter.js` | implemented `store` against Bookshelf models; **the only** canonical↔column mapping | rewrite for the new persistence layer |
| `api/lib/building_permits_crawl.js` | injected the host's db/config/log into `crawl()` | rewrite (small) |
| `api/model/building_permit*.js`, `construction_site.js` | Bookshelf models | replace with the new repo's ORM |
| `migrations/*_create_building_permit.js` | the three tables | port the schema; keep `GEOMETRY` (not `POLYGON`) and a JSON column for `sourceFields` |
| `api/controller/cron.js` → `fetchBuildingPermits()` | cron entry point | rewire |
| `bin/fetch_building_permits` | standalone runner | rewire |
| `config/default.json` → `buildingPermits` | page size, timeouts, retries | port the values |

Those seven are worth reading before rewriting even if the new stack is different — they encode decisions (`GEOMETRY` over `POLYGON`, per-source stores scoped by city, ISO→MySQL date conversion) that were found by testing against real data. They are not in this folder precisely so a rewrite discards them cleanly rather than fighting them.

**All you must implement in the new host is `store`** — four methods, described under *Embedding in a host application* below. Until then the CLI's `--state` flag gives you change detection with no database at all.

### If the new repo is not Node

The canonical shapes in `src/schema.js` are the contract, and the CLI emits them as JSON or GeoJSON:

```bash
node bin/cli.js crawl --out permits.json          # array of canonical records
node bin/cli.js crawl --out permits.geojson       # FeatureCollection
```

So a Python/Go/Rust host can shell out to the CLI and ingest the output, rather than reimplementing the parsers. Not elegant, but it means the expensive part — knowing what the source's fields mean — is never rewritten.

### Do not lose the tests

`test/` is the most valuable thing here. The fixtures are real captured responses, and the assertions encode hard-won facts about the source: which fields are dates versus date-shaped strings, that ~0.5% of geometries are MultiPolygon, that request numbers are not unique, that paging needs an explicit sort. Copy `test/` verbatim. If a test becomes inconvenient in the new repo, that is a signal to check whether the new code is wrong — not to delete the test.

## Embedding in a host application

Inject four dependencies; defaults for all of them ship in [`src/defaults.js`](./src/defaults.js).

```js
const { crawl, sources, defaults } = require('./api/lib/building_permits');

const report = await crawl(
  { http: defaults.createHttp(), log: myLogger, store: myStore },
  { sources, since: '2026-01-01' }
);
```

The `store` contract is the only piece a host must write:

```js
{
  async loadKnown(sourceName) {},        // -> Map<dedupeKey, record> (or Set of keys)
  async save(record) {},                 // insert
  async update(record, changes) {},      // optional; falls back to save
  async recordChange(change) {},         // optional; one row per status change
}
```

Returning a **`Map`** rather than a `Set` from `loadKnown` is what enables status diffing — with a bare `Set` the crawler can only tell new from seen. The stored objects need only the tracked fields (`TRACKED_FIELDS` in `src/schema.js`) plus `stageOrder`/`buildStageOrder`.

### Integrating into Meirim specifically

The scraper deliberately contains **no** Meirim code. The wiring lives *outside* this folder and is already written:

| File | Role |
|---|---|
| `migrations/20260730120000_create_building_permit.js` | `building_permit`, `construction_site`, `building_permit_change` tables |
| `api/model/building_permit.js`, `construction_site.js`, `building_permit_change.js` | Bookshelf models (+ `building_permit_constants.js`) |
| `api/lib/building_permits_adapter.js` | implements `store`; **the only place** canonical names meet column names |
| `api/lib/building_permits_crawl.js` | injects Meirim's db/config/log into `crawl()` |
| `api/controller/cron.js` → `fetchBuildingPermits()` | the cron entry point |
| `bin/fetch_building_permits` | standalone runner, mirrors `bin/fetch_tree_permit` |
| `config/default.json` → `buildingPermits` | page size, timeouts, retries, source selection |

Because the canonical→column mapping is confined to the adapter, a schema rename never touches scraper code — and if this repo is replaced, only the adapter is rewritten.

Still to do if the data should appear in the product: an API controller + routes (mirroring `/tree/`), client scenes, and an alert-email template. The alert *feed* already exists: `building_permit_change` rows with `imminent = 1`, via `BuildingPermitChange.getUnsentImminent()`.

```bash
node bin/fetch_building_permits --source tlv --since 2026-01-01
node bin/fetch_building_permits --max 50 --dry-run     # smoke test, no writes
```

---

## Inspecting a crawl (no database needed)

`bin/inspect.js` turns a crawl output file into a single self-contained HTML report — distributions, field coverage, date ranges, a map drawn as inline SVG, and a table of the alert-relevant records. No dependencies, no network, works offline.

```bash
node bin/cli.js crawl --max 500 --out /tmp/sample.json
node bin/inspect.js /tmp/sample.json          # writes /tmp/sample.report.html
```

It also runs sanity checks and **exits non-zero if any fail**, so it doubles as a smoke test in a pipeline:

- every record has a unique `dedupeKey`, and geometry
- geometry types are Polygon/MultiPolygon, all coordinates inside Israel
- all dates parse as ISO-8601, no absurd future dates
- `stage` agrees with `stageOrder`
- raw `sourceFields` preserved

What to look for by eye: **the map should look like Tel Aviv.** A smear, a single dot, or coordinates in the wrong hemisphere means a projection problem. Hebrew must render correctly; mojibake means an encoding problem. `unique keys` should equal `records`, while `permits (grouped)` is legitimately lower because multi-parcel permits share a group.

## Verifying it works on a development machine

The whole point of the dependency-free design: none of this needs MySQL, Docker, or `npm install`.

```bash
cd server/api/lib/building_permits
npm test                                          # 70 tests, offline, ~1s
node bin/cli.js validate                          # upstream layers still as expected?
node bin/cli.js stats --near 34.7749,32.0754 --radius 300   # 1 request, no data
node bin/cli.js crawl --near 34.7749,32.0754 --radius 300 --since 2026-01-01 --out /tmp/a.json
node bin/inspect.js /tmp/a.json                   # then open the HTML
```

That exercises the entire pipeline — fetch, page, normalize, dedupe, diff, write. The only thing a database adds is the `store`.

## Tests

```bash
npm test                      # or: node --test "test/*.test.js"
```

Runs with **no install** on Node 18+, and also under the host project's mocha.

- `normalize.test.js` — parsing, against fixtures captured from the live service
- `crawl.test.js` — paging, dedup, status diffing, alert classification, failure isolation
- `isolation.test.js` — enforces no imports leaving the folder and no third-party deps

Two tests are early-warning systems for upstream drift: the required-fields check against captured layer metadata, and the WGS84 coordinate-range assertion.

### Refreshing fixtures

```bash
B=https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer
curl -s "$B/772/query?where=permission_date>=date '2026-01-01'&outFields=*&resultRecordCount=8&orderByFields=oid_permit&f=geojson" -o test/fixtures/tlv_building_permits.geojson
curl -s "$B/499/query?where=1=1&outFields=*&resultRecordCount=8&orderByFields=oid_site&f=geojson"   -o test/fixtures/tlv_construction_sites.geojson
curl -s "$B/772?f=json" -o test/fixtures/layer_772_metadata.json
curl -s "$B/499?f=json" -o test/fixtures/layer_499_metadata.json
```

---

## Adding another municipality

Cities are added one at a time; nothing in `crawl.js`, `dedupe.js`, the CLI or the database layer changes when you add one.

A source module is any object shaped like this — only `fetch` is strictly required:

```js
module.exports = {
  name: 'haifa-building-permits',   // unique; how the CLI selects it
  kind: KIND.PERMIT,               // PERMIT or SITE
  city: 'haifa',                   // namespaces dedupe keys — must be unique per city
  cityName: 'חיפה',
  description: '...',
  requiredFields: [...],           // upstream fields the parser needs
  buildWhere(options),             // attribute filter, in the source's own language
  async *fetch(deps, options),     // yields canonical records
  parse(rawPayload),               // for fixture tests
  validate(deps),                  // [] or names of missing fields
};
```

Then register it in `src/sources/index.js` and add fixtures plus parser tests.

**Sources need not be ArcGIS.** A city serving HTML, Excel or a bespoke JSON API just implements `fetch` differently and normalizes to the same canonical shape. `serviceUrl`/`layerId` are ArcGIS conveniences, not part of the contract. Most Israeli municipal GIS *is* ArcGIS, so `src/arcgis.js` — paging, spatial filters, field validation, date coercion — is reusable as-is; for those cities a new source is mostly a field-mapping exercise.

Two things to get right:

1. **A unique `city` code.** Keys are namespaced by it (`tlv-permit-req-20220582-970`), which is what stops Tel Aviv request 20220582 colliding with another city's request 20220582 in a shared table. A test asserts different cities produce different keys.
2. **Its own normalizer if the fields differ.** `normalizePermit`/`normalizeSite` are written against Tel Aviv's column names. Another city with different columns needs its own mapping function producing the same canonical shape — put it in the source module or add a normalizer alongside the existing ones.

The CLI selects by city as well as by source name:

```bash
node bin/cli.js list                       # grouped by city
node bin/cli.js crawl --source tlv         # every source for one city
node bin/cli.js crawl --source haifa,tlv-construction-sites
```

If a city's identifiers have a different shape, add a key builder to `dedupe.js` rather than special-casing the crawler.

---

## Measured cost of a crawl

From a single-request feasibility test against the live service:

| | Requests | Wire size | Time |
|---|---|---|---|
| 1,000 permits (one request) | 1 | 2.6 MB | 2s warm |
| All 10,561 permits | 11 | ~28 MB | ~60s |
| All 1,579 sites | 2 | ~2 MB | 4s |
| 300m radius + since-2026 | 2 | ~0.1 MB | <2s |
| `stats` (count only) | 1/source | ~100 bytes | <1s |

Paging at 1,000 features means the *entire* dataset is ~13 requests — a lighter traffic pattern than one person panning the map. The constraint is payload, not request count, and `--since` / `--near` / `--bbox` address that. Uncached first requests can take ~30s; the service caches, so repeats are much faster.

## Known limitations

- **Tel Aviv only.** No other municipality is implemented yet.
- **Between-crawl history for layer 499 requires storage.** Its build-stage progression has no date fields, so transitions are only visible by diffing. Crawl regularly if that matters.
- **Object-id dependence in dedup keys** — see the multi-parcel section above.
- **`finished` and `occupation` are strings upstream**, despite naming dates. They are passed through raw rather than guessed at.
- **`--state` diffing loads the whole previous run into memory.** Fine at ~10k records; a database-backed store is the answer at real scale.
