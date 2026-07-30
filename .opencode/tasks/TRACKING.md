# Task Tracking

**Updated**: 2026-07-30

## Tasks

### [01-database-schema-update-date.md](./01-database-schema-update-date.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Add `UPDATE_DATE` column to plan DB model, replacing `LAST_UPDATE` for change detection |
| **ACs Met** | 4 / 4 |
| **Dependencies** | None |

### [02-search-api-module.md](./02-search-api-module.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Create `searchApi.js` with 3-tier reCAPTCHA strategy (A → B → C) for SV3 search |
| **ACs Met** | 6 / 6 |
| **Dependencies** | None |

### [03-export-search-api-from-mavat-index.md](./03-export-search-api-from-mavat-index.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Wire `searchApi.js` into `mavat/index.js` as a re-export |
| **ACs Met** | 4 / 4 |
| **Dependencies** | 02-search-api-module |

### [04-refactor-iplan-api.md](./04-refactor-iplan-api.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Strip `iplanApi.js` to minimal `getPlanGeometry(planNumber)`, remove bulk full-dump from crawl path |
| **ACs Met** | 4 / 4 |
| **Dependencies** | None |

### [05-refactor-cron-controller.md](./05-refactor-cron-controller.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Split `iplan()` into `mavatSearch()` and `fetchIplanGeometry()`; use `UPDATE_DATE` for change detection |
| **ACs Met** | 7 / 7 |
| **Dependencies** | 01, 02, 03, 04 |

### [06-crawl-cadence-logic.md](./06-crawl-cadence-logic.md)
| | |
|---|---|
| **Status** | 🟢 Complete |
| **Description** | Implement initial backfill (all plans) and incremental crawl (buffer-based) modes |
| **ACs Met** | 5 / 5 |
| **Dependencies** | 05 |

---

**Legend**: 🔴 Not Started | 🟡 In Progress | 🟢 Complete

### Progress Summary
- **Total Tasks**: 6
- **Completed**: 6
- **In Progress**: 0
- **Not Started**: 0
