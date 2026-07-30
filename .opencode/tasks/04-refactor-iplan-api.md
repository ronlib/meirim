# Task: Refactor `server/api/lib/iplanApi.js`

## Description
Strip down the IPlan API module to only what's needed for minimal geometry queries. Keep or add `getPlanGeometry(planNumber)` for individual ArcGIS queries. Remove the heavy full-dump `getBlueLines()` from the main crawl path since plans will now be discovered via Mavat SV3.

## Expected Outcome
- `iplanApi.js` exports `getPlanGeometry(planNumber)` that queries ArcGIS by plan number
- The heavy full-dump `getBlueLines()` and similar bulk fetch logic is removed or moved to a separate maintenance script
- The module is only called for plans that need geometry (new plans, or plans with `geometry_missing` flag)

## Acceptance Criteria
- [ ] `getPlanGeometry(planNumber)` queries ArcGIS individually (e.g., `where=PL_NUMBER='...'`)
- [ ] No full-dump calls in the main crawl path
- [ ] Existing geometry for ~2000 plans in DB is preserved
- [ ] A one-time backfill script option exists for plans missing geometry
