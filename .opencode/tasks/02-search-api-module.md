# Task: New Module — `server/api/lib/mavat/searchApi.js`

## Description
Create a new module `searchApi.js` that implements SV3 search with a three-tier reCAPTCHA strategy:
- **Strategy A**: Auto-search via page navigation — navigate SV3 with URL params, intercept API response via `page.waitForResponse()`
- **Strategy B**: Manual token — call `grecaptcha.execute()` inside `page.evaluate()` then call the search API directly
- **Strategy C**: Per-plan SV4/1 navigation (existing slow path, last resort)

Includes `searchPlans(params)` and `paginateAllPlans(dateLastStatusDate)`.

## Expected Outcome
- New file `server/api/lib/mavat/searchApi.js` with exported functions `searchPlans` and `paginateAllPlans`
- `searchPlans` implements 3-tier retry/fallback (A → B → C)
- `paginateAllPlans` is an async generator that yields paginated result pages
- Each run logs which strategy was used, total records, pages, new plans, and changed plans
- Token is refreshed every N pages to handle expiration

## Acceptance Criteria
- [ ] `searchPlans(params)` sends POST to `/rest/api/sv3/Search` with `searchEntity: 1`, `searchType: 1`, `dateLastStatusDate`, pagination params
- [ ] Strategy A: navigates to SV3 with query params, intercepts response via `page.waitForResponse()`
- [ ] Strategy B: falls back to `grecaptcha.execute()` token generation + direct API call
- [ ] Strategy C: falls back to SV4/1 per-plan navigation
- [ ] `paginateAllPlans(dateLastStatusDate)` iterates all pages via `fromResult`/`toResult` (20 per page)
- [ ] Logs: strategy used, total records, page count, new/changed plan counts
- [ ] Token refresh logic for pagination loops
