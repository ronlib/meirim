# Crawler

The Meirim crawler is written in Javascript using [Puppeteer](https://pptr.dev) and [Axios](https://axios-http.com).

The crawler code currently lives under the [server](../server) folder alongside the backend code. Separating these is a pending task.

The crawler supports two modes:
- **Backfill**: Fetches all plans (~2042 as of 2024). Designed to run once when the database is empty or needs a full refresh.
- **Incremental**: Fetches only plans updated since the last crawl (minus a configurable buffer). Runs every 6 hours by default.

## Executing

After resolving dependencies and configuring as explained in the [main readme](../README.md), there are several entry points:

### Full pipeline (legacy IPlan discovery)
```bash
$ npm run crawl
```
Calls `controller.iplan()` — queries the IPlan ArcGIS service for all plan geometries and metadata. Slower, heavier. Useful for backfill or fallback.

### SV3 search (new discovery pipeline)
```bash
$ node bin/run_mavat_search
```
Calls `controller.mavatSearch()` — uses the Mavat SV3 search API to discover plans via `paginateAllPlans()`. Lighter, supports both backfill (`dateLastStatusDate: null`) and incremental (`dateLastStatusDate = lastCrawl - bufferDays`) modes automatically.

### IPlan geometry fetch (lightweight)
```bash
$ node bin/run_iplan_geometry
```
Calls `controller.fetchIplanGeometry()` — queries the IPlan ArcGIS service only for plans missing geometry or MP_ID. Does NOT do a full-dump, only per-plan individual queries.

### Backfill missing Mavat data
```bash
$ node bin/complete_mavat_data
```
Queries the database for plans missing Mavat enrichment fields (e.g., `areaChanges`) and re-fetches from Mavat SV4/1.

All crawl processes can be stopped at any time with Ctrl+C (plans crawled up until this point remain saved).

## Crawling process (data pipeline)

The crawler follows a three-stage pipeline: **SV3 Search -> IPlan Geometry -> Mavat Enrichment**.

### Stage 1: SV3 Search (Plan Discovery)

The crawler queries the [Mavat SV3 search API](https://mavat.iplan.gov.il/rest/api/sv3/Search) for all statutory plans. This returns plan metadata:
- **MP_ID** — unique Mavat system identifier
- **ENTITY_NUMBER** — plan number (e.g. `262-0907907`)
- **ENTITY_NAME** — plan name
- **UPDATE_DATE** — timestamp of the last modification
- **INTERNET_SHORT_STATUS** — current status description
- **UNIFIED_STATUS_DESC** — unified status category

Search uses a **3-tier reCAPTCHA fallback strategy** (defined in [`searchApi.js`](../server/api/lib/mavat/searchApi.js)):
1. **Strategy A**: Navigates the SV3 page with URL params, intercepts the API response via `page.waitForResponse()`
2. **Strategy B**: Calls `grecaptcha.execute()` inside `page.evaluate()` then calls the search API directly with the token
3. **Strategy C**: Falls back to per-plan SV4/1 page navigation (the old slow path)

The search is paginated at 20 records per page. The browser page/token is refreshed every 5 pages to avoid reCAPTCHA timeouts.

Change detection compares the `UPDATE_DATE` from the SV3 response against the stored `UPDATE_DATE` in the database:
- **No matching MP_ID in DB** → new plan (flagged for geometry + Mavat enrichment)
- **Matching MP_ID with newer `UPDATE_DATE`** → changed plan (flagged for re-enrichment)
- **Matching MP_ID with same `UPDATE_DATE`** → unchanged (skipped)

The SV3 search API client lives at [`server/api/lib/mavat/searchApi.js`](../server/api/lib/mavat/searchApi.js).

### Stage 2: IPlan (Geometry Fetch)

Plans that are new or missing geometry are enriched with polygon data from the [IPlan](https://www.iplan.gov.il) ArcGIS geospatial service. Unlike the old approach (bulk full-dump via `getBlueLines()`), the new approach queries geometry **per-plan** via `getPlanGeometry(planNumber)`:

```
GET https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1/query
  ?f=json
  &outFields=objectid,shape,plan_county_name,...,mp_id,last_update
  &returnGeometry=true
  &where=PL_NUMBER='{planNumber}'
  &outSR=3857
```

Geometries are reprojected from EPSG:3857 to [WGS84](https://en.wikipedia.org/wiki/World_Geodetic_System).

The IPlan API client lives at [`server/api/lib/iplanApi.js`](../server/api/lib/iplanApi.js).

### Stage 3: Mavat Enrichment (SV4/1)

Each new or changed plan is enriched with detailed data from **Mavat** via the SV4/1 REST API (`https://mavat.iplan.gov.il/rest/api/SV4/1?mid={MP_ID}`). This is done using Puppeteer (headless Chrome), as the API is geo-blocked from outside Israel.

Data fetched from Mavat includes:
- **Plan goals** (`goals_from_mavat`)
- **Plan description/instructions** (`main_details_from_mavat`)
- **Jurisdiction** information
- **Area changes** (quantity/land-use change data)
- **Plan status history**
- **Files** — PDFs, KMLs, DWGs, etc.
- **Chart data** parsed from plan instruction PDFs

If this is a new plan or the status has changed, the plan is marked for email notification, and the `send_emails` process picks it up and alerts subscribers.

The Mavat scraper lives at [`server/api/lib/mavat/index.js`](../server/api/lib/mavat/index.js).

### Linking mechanism: MP_ID

The **MP_ID** is the critical link across all three stages:
1. SV3 search returns `MP_ID` directly
2. IPlan geometry provides `MP_ID` from the `MP_ID` field or extracted from `PL_URL`
3. Mavat enrichment uses `MP_ID` to fetch the corresponding detailed record

A utility at [`server/bin/fill_missing_mp_id`](../server/bin/scrap_mp_id) can backfill missing MP_IDs for plans that were created before the field was introduced.

## Crawl cadence

The crawl logic is orchestrated by [`crawlCadence.js`](../server/api/lib/crawlCadence.js):

- **Backfill mode**: Sets `dateLastStatusDate` to `null`, which triggers a full fetch of all plans. Designed to run once (the `backfillGuard` config flag can prevent accidental re-runs).
- **Incremental mode**: Calculates `dateLastStatusDate` as `lastCrawlDate - bufferDays` (default 7 days). The 7-day buffer ensures that plans updated around the time of the last crawl are not missed.

The last successful crawl date is stored in the `crawl_meta` table (`last_successful_mavat_crawl`). [`run_mavat_search`](../server/bin/run_mavat_search) updates it **only after a full cycle completes with zero per-record errors**. Catastrophic failures (thrown from `mavatSearch`) also skip the update. This prevents the incremental window from advancing past unprocessed or failed plans.

### Schedule

| Mode | Cron | Frequency |
|------|------|-----------|
| Backfill | `0 0 2 * * 0` | Weekly, Sunday at 2 AM |
| Incremental | `0 */6 * * *` | Every 6 hours |

The schedule is configured in `server/config/default.json` under `services.schedule`.

## Caveats

### New Mavat website

A new Mavat website at `https://mavat.iplan.gov.il` (referred to internally as "new Mavat") has been released, alongside a REST API. The old Mavat site at `http://mavat.moin.gov.il` is being phased out. The new site provides the SV3 search API used for plan discovery and the SV4/1 API used for plan enrichment.

### reCAPTCHA

The SV3 search API requires reCAPTCHA tokens for direct API calls. The crawler uses the 3-tier strategy to work around this, with page-level navigation as the primary approach and token generation (`grecaptcha.execute()`) as the fallback.
