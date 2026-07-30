# CLAUDE.md — building_permits

Instructions for anyone (human or agent) changing code in this folder.

Read [README.md](./README.md) first for what this unit does and how the data source behaves. This file is only about **how to work on it without breaking the property that makes it valuable**.

---

## The one rule

**This folder must not import anything from outside itself.**

No `require('../../service/database')`, no `require('../config')`, no `require('../log')`, no npm packages. `test/isolation.test.js` enforces this and will fail the build.

Why it matters: this unit exists because the repository it currently sits in may be rewritten. It is written to be moved — to another directory, another repository, or an npm package — by copying the folder. Every import that escapes the folder makes that impossible.

The failure mode to imitate *avoiding*: `api/lib/trees/tree_crawler.js` in this same repo imports the host's database, config and logger at module scope, so it cannot even be `require`d outside this project. All the hard-won knowledge in those parsers is stuck there. Do not repeat that.

**Host-specific code goes in an adapter outside this folder.** If you need the host's database, implement the `store` contract there and inject it.

## Corollaries

- **Zero dependencies.** Node built-ins only (`fetch` is global on Node 18+). If you truly need a package, that is a design discussion, not a quick `npm i`.
- **No side effects at module scope.** No connections opened, no config read, no clock read at import time. Everything happens inside a function that received its dependencies.
- **`crawl.js` stays time-free.** Timestamps are stamped by the caller so the orchestrator is deterministic in tests.

---

## Architecture

```
index.js              the entire public surface. Nothing outside reaches into src/.
src/
  schema.js           canonical shapes, lifecycle ladders, TRACKED_FIELDS. The contract.
  arcgis.js           generic ArcGIS REST client: paging, date coercion, field validation.
  normalize.js        raw feature -> canonical record. Pure.
  dedupe.js           key builders, partitioning, status diffing. Pure.
  crawl.js            orchestrator. Takes {http, log, store} injected.
  defaults.js         default http/log/store so it runs standalone.
  sources/            one module per (municipality, entity). Registered in index.js.
bin/cli.js            standalone CLI.
test/                 fixture-based, offline.
```

Data flow: `sources/*.fetch()` pages via `arcgis.js`, normalizes through `normalize.js`, and `crawl.js` partitions and diffs via `dedupe.js` before handing records to the injected `store`.

### Which file does a change belong in?

| Change | Where |
|---|---|
| New municipality or layer | `src/sources/` + register in `src/sources/index.js` |
| Meirim database wiring | `api/lib/building_permits_adapter.js` — **outside** this folder |
| New field extracted from the source | `src/normalize.js` (+ `schema.js` typedef) |
| Different identity/dedup logic | `src/dedupe.js` |
| New alert trigger | `isImminentConstruction` in `src/crawl.js` |
| New spatial filter shape | `spatialParams` in `src/arcgis.js` |
| Anything touching a database | **an adapter outside this folder** |

---

## Invariants worth not breaking

1. **`sourceFields` keeps every raw attribute, verbatim.** The whole point is that analysis later never requires a re-crawl. Do not filter it.

2. **`dedupeKey` identifies one polygon; `groupKey` identifies one permit.** The source publishes multi-parcel permits as several features with identical attributes (10,561 features, 8,921 distinct request numbers). Keying only on the request number silently discards ~1,600 real geometries. Alerts group on `groupKey`.

3. **Paging is ordered by the object-id field.** ArcGIS gives no offset stability without an explicit `orderByFields`; rows get skipped or duplicated. A test asserts the parameter is present.

4. **Alerting is driven by status *changes*, not new rows.** A years-old permit flipping to `קיים היתר` is the most valuable alert there is. Any redesign that only looks at new rows breaks the product requirement.

5. **`advanced` distinguishes forward movement from any change.** Data corrections and backward edits must not alert.

6. **Esri date fields are epoch milliseconds; some date-*named* fields are strings.** `esriDateToIso` deliberately returns `null` for strings rather than guessing a format. `finished` and `occupation` are strings upstream and stay raw.

7. **Geometry is WGS84 on arrival** because `f=geojson` reprojects from EPSG:2039. Do not add a projection step. A test asserts coordinates fall inside Israel so a change upstream fails loudly.

8. **A failing source must not fail the run.** `crawl.js` catches per source and reports. Do not let one dead layer stop the others.

9. **Field validation runs before crawling.** Layers get republished with renamed columns; failing loudly beats writing thousands of null-filled rows. Keep `requiredFields` honest when you add a mapping.

10. **Filter server-side, never client-side.** A 300m radius returns 145 features instead of 10,561. `spatialParams` builds the query parameters; an invalid area throws *before* any request so a typo can never silently become a full-dataset crawl. A test asserts that. Never "fetch all and filter in JS" — it wastes the service's bandwidth and ours.

11. **Prefer `stats` before `crawl`.** Same filters, one request, no data transferred. Cheapest way to size a job.

12. **Every record is namespaced by `city`.** Keys look like `tlv-permit-req-20220582-970`. Two municipalities can otherwise issue the same request number, and they share one table. Never hardcode a city — sources declare theirs and pass it into the key builders. A test asserts two cities produce different keys.

13. **The canonical shape is the contract across cities.** A new municipality may parse HTML, Excel or a different API; whatever it reads, it must emit the same fields. Add per-city normalizers rather than widening the canonical shape with city-specific fields — those belong in `sourceFields`.

---

## Working on it

```bash
npm test                                     # offline, no install
node bin/cli.js validate                     # is upstream still as expected?
node bin/cli.js crawl --max 20 --dry-run     # smoke test without writing
node bin/cli.js crawl --max 20 --out /tmp/x.json --debug
```

- **Prefer `--max` while iterating.** A full permits crawl is ~11 pages against a public government service; be a considerate client.
- **Fixtures are the durable asset.** The expensive knowledge here is what the source's fields mean. When you learn something about the data, encode it in a test, not just a comment. Refresh instructions are in the README.
- **Adding a source needs no changes to `crawl.js`, `dedupe.js` or the CLI.** If it seems to, the abstraction is being bent — reconsider.
- **Hebrew string values are data.** Status ladders are matched by exact string; do not "tidy" whitespace or reorder `PERMIT_STAGES`/`SITE_STAGES` (index is meaning).

## Style

Match the surrounding code: tabs, single quotes, semicolons, CommonJS, JSDoc on exported functions. Comments explain *why* — the non-obvious source behaviour, the measured facts, the tradeoffs — not what the line does.

---

## Porting this out

This folder is expected to move to another repository. Full instructions are in README.md under *Moving this to another repository*. The short version:

1. Copy the folder.
2. `npm test` — 70 tests, no install, no database, no network. If they pass, the move worked.
3. `node bin/cli.js validate && node bin/cli.js crawl --max 20 --out /tmp/x.json` — confirms it still reaches the source.
4. Write a `store` adapter for the new host (four methods).
5. Delete nothing in `test/`; those tests are the specification, and the fixtures are real captured responses.

Host-specific files (adapter, models, migration, cron hook, runner, config block) live **outside** this folder and are meant to be left behind and rewritten. That separation is the whole point — do not "helpfully" move them in.
