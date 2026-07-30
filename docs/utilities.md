# Utilities

Utilities are used to provide some platform functionality or fix some odd or missing data due to service interruptions, modifications etc.

The utilities live under the [server/bin](../server/bin) folder.

Most utilities require dependencies to be resolved and code to be configured as explained in the [main readme](../README.md).

## Send emails

The [send_emails](../server/bin/send_emails) utility is run at intervals and is used to send email alerts to users for new and updated plans. It queries the database for unsent plans, intersects their geometries with user alert areas and sends out emails if needed using an SMTP service according to the set configuration.

```bash
$ node bin/send_emails
```

## Serve

The [serve](../server/bin/serve) utility is used in production to serve our backend and frontend together on the same port using Express (reasons and specs further explained [here](./frontend.md#open-graph-tags) and [here](./backend.md#static-app-and-routes)).

```bash
$ npm run serve # or node bin/serve
```

## Complete mavat data

The [complete_mavat_data](../server/bin/complete_mavat_data) utility is used to repair missing data due to downtime, errors etc. or due to new data processing code being introduced. It is further explained [here](./crawler.md#crawling-process-data-pipeline).

```bash
$ node bin/complete_mavat_data
```

## SV3 search crawl

The [run_mavat_search](../server/bin/run_mavat_search) utility runs the Mavat SV3 search-based crawl, followed by an automatic geometry-backfill phase (both orchestrated by [`crawlPipeline.js`](../server/api/lib/crawlPipeline.js)). It automatically detects whether a backfill (fetch all plans) or incremental (fetch recently updated plans) run is needed based on database state and the last crawl date. The last crawl date is updated only when the full cycle finishes with zero errors (see [crawler cadence](./crawler.md#crawl-cadence)). The geometry backfill runs unconditionally after the crawl so missing/placeholder geometry self-heals over time.

```bash
$ node bin/run_mavat_search
```

## IPlan geometry fetch

The [run_iplan_geometry](../server/bin/run_iplan_geometry) utility fetches geometry from the IPlan ArcGIS service for plans that are missing geometry or MP_ID. Unlike the legacy `npm run crawl` (which does a full dump of all plans), this only queries per-plan for those that need it. The recurring geometry backfill now ALSO runs automatically as the geometry-backfill phase of `bin/run_mavat_search` / `bin/iplan` (via [`crawlPipeline.js`](../server/api/lib/crawlPipeline.js)), so this bin is now a manual/ops escape hatch for on-demand geometry repair (e.g. after an iPlan outage or to run backfill on a separate cadence).

```bash
$ node bin/run_iplan_geometry
```
