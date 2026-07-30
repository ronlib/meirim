# Task: Database Schema — Add `UPDATE_DATE` Column

## Description
Add a new `UPDATE_DATE` column to the plan database model to store Mavat's update timestamp from SV3 search results. This replaces the existing `LAST_UPDATE` logic for change detection.

## Expected Outcome
- A new `UPDATE_DATE` column (string/datetime) exists on the plan table/schema
- The column is populated during plan creation and updates from Mavat SV3 search results
- Existing `LAST_UPDATE` logic is replaced or supplemented by `UPDATE_DATE`
- Database migration scripts are created (if applicable)

## Acceptance Criteria
- [ ] Migration adds `UPDATE_DATE` column to the plan table
- [ ] Schema/model definition includes `UPDATE_DATE`
- [ ] Change-detection logic uses `UPDATE_DATE` instead of `LAST_UPDATE` (or `LAST_UPDATE` is removed)
- [ ] Backward-compatible — existing plans get `UPDATE_DATE` populated on next crawl
