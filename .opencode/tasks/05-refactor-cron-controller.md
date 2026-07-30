# Task: Refactor `server/api/controller/cron.js`

## Description
Split the existing `iplan()` function into two separate concerns:
- `mavatSearch()` — SV3 paginated search via `searchApi`, returns list of plans with MP_ID + UPDATE_DATE
- `fetchIplanGeometry()` — called only for plans needing geometry (new plans or geometry_missing flag)

Change detection compares `UPDATE_DATE` instead of `LAST_UPDATE`. Keep existing `buildPlan()` and Mavat SV4/1 enrichment flow intact.

## Expected Outcome
- `iplan()` is split into `mavatSearch()` and `fetchIplanGeometry()`
- `mavatSearch()` drives the crawl: runs SV3 search, compares with DB by MP_ID, identifies new/changed/unchanged plans
- `fetchIplanGeometry()` is called only for plans flagged as needing geometry
- Change detection uses `UPDATE_DATE` from SV3 search results
- Existing `buildPlan()` and SV4/1 enrichment (`fetchPlanData()`) remain unchanged
- NEW plans → flag for geometry fetch + enrichment
- EXISTING + newer UPDATE_DATE → flag for re-enrichment
- UNCHANGED → skip

## Acceptance Criteria
- [ ] `mavatSearch()` calls `paginateAllPlans()` from searchApi
- [ ] `mavatSearch()` matches results to DB by MP_ID
- [ ] `mavatSearch()` returns categorized results: new, changed, unchanged
- [ ] `fetchIplanGeometry()` queries IPlan only for plans that need geometry
- [ ] SV4/1 enrichment runs only for new/changed plans
- [ ] Build logic and enrichment flow is preserved
