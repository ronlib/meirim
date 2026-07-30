# Task: Export `searchApi` from `server/api/lib/mavat/index.js`

## Description
Wire the new `searchApi.js` module into the existing Mavat library index so it's accessible alongside the existing `fetchPlanData()` for SV4/1 enrichment.

## Expected Outcome
- `server/api/lib/mavat/index.js` exports or re-exports `searchApi` functions
- Existing `fetchPlanData()` for SV4/1 enrichment remains unchanged
- Both modules are accessible from the same mavat entry point

## Acceptance Criteria
- [ ] `searchApi.js` is imported in `mavat/index.js`
- [ ] `searchPlans` and `paginateAllPlans` are re-exported
- [ ] Existing `fetchPlanData()` export is untouched
- [ ] No breaking changes to existing consumers of `mavat/index.js`
