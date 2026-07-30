# Mavat-First Crawler Architecture

## Goal
Replace IPlan as the primary plan discovery source with Mavat SV3 Search. Keep IPlan **only** for geometry/polygon data. Use Mavat's `UPDATE_DATE` for change detection.

## Key Decisions
- **Discovery**: `POST /rest/api/sv3/Search` with reCAPTCHA token
- **Change detection**: `UPDATE_DATE` field from search results (vs current IPlan `LAST_UPDATE`)
- **Geometry**: Keep IPlan ArcGIS, query minimally (only for plans that need it)
- **Enrichment**: Unchanged (`SV4/1/{MP_ID}/310`)
- **reCAPTCHA strategy**: Auto-search via page navigation (A), fallback to manual `grecaptcha.execute()` (B)

## Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  Stage 1: Mavat SV3 Search                                       │
│  (plan discovery + change detection)                             │
│                                                                  │
│  POST /rest/api/sv3/Search                                       │
│    searchEntity: 1, searchType: 1                                │
│    dateLastStatusDate: <lastCrawlDate minus buffer>              │
│    paginated: fromResult / toResult                              │
│                                                                  │
│  reCAPTCHA strategy:                                             │
│    Try A: Navigate SV3 with URL params → auto-search →          │
│            intercept via page.waitForResponse()                  │
│    Fallback B: grecaptcha.execute() inside page.evaluate()       │
│    Fallback C: Per-plan SV4/1 navigation (existing slow path)    │
│                                                                  │
│  Log which strategy was used on each run                         │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼ MP_ID + UPDATE_DATE + ENTITY_NUMBER
         │
┌──────────────────────────────────────────────────────────────────┐
│  Stage 2: Compare with DB                                        │
│                                                                  │
│  Match by MP_ID (already stored as plan.MP_ID)                   │
│  NEW plan → flag for geometry fetch + enrichment                 │
│  EXISTING + newer UPDATE_DATE → flag for re-enrichment           │
│  UNCHANGED → skip                                                │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼ (geometry needed?)
         │
┌──────────────────────────────────────────────────────────────────┐
│  Stage 3: IPlan Geometry (minimal)                               │
│                                                                  │
│  Query ArcGIS only for plans needing geometry                    │
│  (new plans, or geometry_missing flag)                           │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Stage 4: Mavat SV4/1 Detail (unchanged)                         │
│                                                                  │
│  Puppeteer: navigate SV4/1/{MP_ID}/310                           │
│  waitForResponse(rest/api/SV4/1?mid={MP_ID})                     │
│  Enrich: goals, instructions, files, status history, etc.        │
└──────────────────────────────────────────────────────────────────┘
```

## Module: `server/api/lib/mavat/searchApi.js` (new)

### `searchPlans(params)` — search with retry/fallback

```js
async function searchPlans(params) {
  // params: { dateLastStatusDate, fromResult, toResult, _page }

  // Strategy A: Auto-search via page navigation
  const queryString = `?searchEntity=1&searchType=1&searchMethod=2`;
  const response = await page.waitForResponse(
    'https://mavat.iplan.gov.il/rest/api/sv3/Search',
    page.goto(`https://mavat.iplan.gov.il/SV3${queryString}`)
  );
  // ...
}
```

### `paginateAllPlans(dateLastStatusDate)` — loop paginated results

```js
async function* paginateAllPlans(dateLastStatusDate) {
  let page = 1;
  let totalPages;
  do {
    const results = await searchPlans({
      dateLastStatusDate,
      fromResult: (page - 1) * 20 + 1,
      toResult: page * 20,
      _page: page
    });
    totalPages = results.totalPages;
    yield results;
    page++;
  } while (page <= totalPages);
}
```

## Changes to Existing Files

### `server/api/controller/cron.js`
- `iplan()` → split into:
  - `mavatSearch()` — SV3 paginated search, returns list of plans with MP_ID + UPDATE_DATE
  - `fetchIplanGeometry()` — called only for plans needing geometry (minimal IPlan query)
- Change detection: compare `UPDATE_DATE` instead of `LAST_UPDATE`
- Keep existing `buildPlan()` and Mavat enrichment flow intact

### `server/api/lib/iplanApi.js`
- Strip down or add `getPlanGeometry(planNumber)` individual query endpoint
- Remove heavy full-dump `getBlueLines()` from main crawl path

### `server/api/lib/mavat/index.js`
- Add `searchApi.js` module
- Keep existing `fetchPlanData()` for SV4/1 enrichment (unchanged)

### Database schema
- Consider adding `plan.UPDATE_DATE` column for Mavat's update timestamp
- Could replace `LAST_UPDATE` logic entirely

## Strategy Details

### reCAPTCHA — Strategy A (primary)

Navigate to SV3 with URL params that trigger auto-search:

```
page.goto('https://mavat.iplan.gov.il/SV3?searchEntity=1&searchType=1&searchMethod=2')
```

The Angular SPA generates a reCAPTCHA token and calls the API on page load. Intercept the response via `page.waitForResponse()`.

**Pagination**: For page 2+, re-navigate with modified params or interact with the UI.

### reCAPTCHA — Strategy B (fallback)

If auto-search fails, generate a token manually:

```js
const token = await page.evaluate(async () => {
  return await grecaptcha.execute(
    '6LeUKkMoAAAAAH4UacB4zewg4ult8Rcriv-ce0Db',
    { action: 'submit' }
  );
});
```

Then call the search API directly with the token.

### reCAPTCHA — Strategy C (last resort)

Fall back to the existing per-plan SV4/1 navigation. Slow but reliable.

### Logging
Each run logs:
- `mavat_search_strategy`: A | B | C
- `mavat_search_results`: total records, pages
- `mavat_search_new`: count of new plans found
- `mavat_search_changed`: count of plans with updated UPDATE_DATE
- Any strategy failures

## Crawl Cadence

- **Initial backfill**: `dateLastStatusDate: null` → fetches all ~2042 plans (103 pages)
  - Run once to populate any plans not yet in DB
- **Incremental crawl**: `dateLastStatusDate: <lastCrawlDate minus 7 days>` (buffer to avoid missing anything)
  - Lightweight — only returns plans with status changes since the buffer date
  - Can run multiple times daily

## Search API Response Fields Used

| Search Result Field | Type | Use |
|---|---|---|
| `MP_ID` | number | Mavat plan ID, key for DB match + enrichment |
| `ENTITY_NUMBER` | string | Plan number (e.g. `262-0907907`) |
| `ENTITY_NAME` | string | Plan name |
| `ENTITY_LOCATION` | string | Location description |
| `UPDATE_DATE` | string | **Change detection** — compare with stored value |
| `INTERNET_STATUS_DATE` | string | Status change date |
| `UNIFIED_STATUS_DESC` | string | Status description |
| `INTERNET_SHORT_STATUS` | string | Short status |
| `AUTH_NAME` | string | Authority name |
| `ENTITY_SUBTYPE` | number | Entity subtype code |

## Edge Cases & Open Questions

1. **Geometry for existing plans**: ~2000 plans already have IPlan geometry in DB. Only need to fetch geometry for new plans going forward. Consider a one-time backfill script for any missing geometry.

2. **IPlan geometry query**: Can we query ArcGIS by `PL_NUMBER` or `MP_ID` individually, or do we still need a full dump? Need to check if the ArcGIS service supports `where=PL_NUMBER='262-0907907'` queries.

3. **`dateLastStatusDate` no-limit proven**: Tested from 2026 back to 1990 — no hard limit. Setting to null returns all records (~2042).

4. **Token expiration**: reCAPTCHA tokens may expire after a few minutes. For long pagination loops, refresh the token every N pages.
