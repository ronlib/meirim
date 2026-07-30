# Crawler

The Meirim crawler is written in Javascript using [Puppeteer](https://pptr.dev).

The crawler code is currently mixed with the backend code which lives under the [server](../server) folder. Separating these is a pending task.

## Executing

To run the code after resolving dependencies and configuring as explained in the [main readme](../README.md), use:

```bash
$ npm run crawl
```

The crawling process will begin and write new and updated plan data throughout its run to the database. It can be stopped at any time using Ctrl+C (plans crawled up until this point will already be saved to the database).

## Crawling process (data pipeline)

The crawler follows a two-stage pipeline: **IPlan → Mavat**.

### Stage 1: IPlan (קווים כחולים / Kavim Kchulim)

First the crawler queries the [IPlan](https://www.iplan.gov.il) geospatial service (ArcGIS-based) for all statutory plans. This returns plan geometries (polygons), basic metadata (plan number, name, county, type, area), and most importantly the **MP_ID** — a unique identifier extracted from the plan URL pointing to the Mavat system (`https://mavat.iplan.gov.il/SV4/1/{MP_ID}/310`).

All geometries are reprojected from EPSG:3857 to [WGS84](https://en.wikipedia.org/wiki/World_Geodetic_System). The database is then queried for each plan; existing plans are checked against the `LAST_UPDATE` field to produce a set of new and updated plans.

The IPlan API client lives at [`server/api/lib/iplanApi.js`](../server/api/lib/iplanApi.js).

### Stage 2: Mavat (מבא"ת)

Each new or updated plan is then enriched with detailed data from **Mavat** (Ma'arechet Bav'a'ot Tichnun — the Israeli national planning application system). The MP_ID from IPlan is used to query the Mavat REST API (`https://mavat.iplan.gov.il/rest/api/SV4/1?mid={MP_ID}`) via Puppeteer (headless Chrome), as the API is geo-blocked from outside Israel.

Data fetched from Mavat includes:
- **Plan goals** (`goals_from_mavat`)
- **Plan description/instructions** (`main_details_from_mavat`)
- **Jurisdiction** information
- **Area changes** (quantity/land-use change data)
- **Plan status history**
- **Files** — PDFs, KMLs, DWGs, etc.
- **Chart data** parsed from plan instruction PDFs

If this is a new plan or the status field (`STATION`) has changed, the plan is marked for email notification, and the `send_emails` process picks it up and alerts subscribers.

The Mavat scraper lives at [`server/api/lib/mavat/index.js`](../server/api/lib/mavat/index.js).

### Linking mechanism: MP_ID

The **MP_ID** is the critical link between the two systems. IPlan provides it from the plan's Mavat URL, and the Mavat scraper uses it to look up the corresponding detailed record. This allows the pipeline to operate: IPlan supplies the "skeleton" (geometry + basic metadata), and Mavat supplies the "flesh" (rich details, documents, status history).

A utility at [`server/bin/complete_mavat_data`](../server/bin/complete_mavat_data) can backfill missing Mavat data for existing plans that may not have been enriched.

## Caveats

### New Mavat website

A new Mavat website at `https://mavat.iplan.gov.il` (referred to internally as "new Mavat") has been released, alongside a REST API. The old Mavat site at `http://mavat.moin.gov.il` is being phased out. The new site makes more data available and includes a plan search endpoint that may eventually reduce reliance on IPlan for plan discovery.
