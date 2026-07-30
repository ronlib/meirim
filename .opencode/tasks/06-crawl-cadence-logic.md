# Task: Implement Crawl Cadence — Initial Backfill + Incremental Crawl

## Description
Implement two crawl modes:
- **Initial backfill**: `dateLastStatusDate: null` — fetches all ~2042 plans (103 pages at 20/page). Run once to populate any plans not yet in DB.
- **Incremental crawl**: `dateLastStatusDate: <lastCrawlDate minus 7 days>` — lightweight, only returns plans with status changes since the buffer date. Can run multiple times daily.

The cadence should be configurable via environment variables or cron schedule.

## Expected Outcome
- A configuration or mode switch determines backfill vs. incremental behavior
- Backfill mode sets `dateLastStatusDate` to `null` (or a very early date) and fetches all plans
- Incremental mode calculates `dateLastStatusDate` from the stored last-crawl timestamp minus a 7-day buffer
- The 7-day buffer is configurable
- The cron schedule allows backfill to run once and incremental to run multiple times daily

## Acceptance Criteria
- [ ] Backfill mode returns all plans (~2042, ~103 pages)
- [ ] Incremental mode uses `lastCrawlDate - 7 days` as `dateLastStatusDate`
- [ ] Configurable buffer days (env var or constant)
- [ ] Cron schedule distinguishes between backfill and incremental runs
- [ ] Backfill is designed to run once (guard against accidental re-runs)
