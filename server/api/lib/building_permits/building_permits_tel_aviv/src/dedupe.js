/**
 * Dedup keys and change detection.
 *
 * Why not just the OID: `oid_permit` / `oid_site` are ArcGIS object ids. They
 * are stable *while* a layer keeps its underlying table, but a full republish
 * of the layer can renumber them. Keys therefore prefer the municipality's own
 * business identifiers and fall back to the OID only when those are absent.
 *
 * The consequence to keep in mind: a key must identify "the same real-world
 * permit across crawls", because status-change detection - the whole point of
 * this scraper - compares records sharing a key.
 */

const { TRACKED_FIELDS } = require('./schema');

/**
 * Fallback municipality prefix. Every key is namespaced by municipality so that
 * two cities cannot collide: Tel Aviv request 20220582 and some other city's
 * request 20220582 are different permits, and a shared table must keep them
 * apart. Sources pass their own `cityCode` (see sources/*.js).
 */
const DEFAULT_CITY = 'unknown';

/**
 * Key for a permit request.
 *
 * Measured against the live layer: 10,561 features carry only 8,921 distinct
 * `request_num` values. A permit spanning several parcels is published as one
 * feature per polygon, with otherwise identical attributes. Keying on
 * `request_num` alone would therefore collapse ~1,600 real geometries.
 *
 * So the key is request number + OID: the request number is the stable business
 * identifier and stays greppable/joinable, while the OID separates the polygons
 * of one request. `groupKey` below recovers the request-level grouping.
 *
 * The tradeoff accepted here: if the layer is ever fully republished and OIDs
 * are renumbered, these keys change and rows re-appear as new. That is
 * detectable (a crawl reporting ~10k "new" records) and preferable to silently
 * discarding geometry on every ordinary run.
 */
function permitKey(props, city = DEFAULT_CITY) {
	const request = props.request_num;
	const oid = props.oid_permit;
	if (request !== null && request !== undefined && Number(request) !== 0) {
		return `${city}-permit-req-${request}-${oid}`;
	}
	// Fall back to the granted permit number, then the OID alone.
	const permit = props.permission_num;
	if (permit !== null && permit !== undefined && Number(permit) !== 0) {
		return `${city}-permit-num-${permit}-${oid}`;
	}
	return `${city}-permit-oid-${oid}`;
}

/**
 * Request-level grouping key, ignoring which polygon a feature is. Use it to
 * collapse the multi-parcel features of one permit - notably so an alert fires
 * once per permit rather than once per parcel.
 */
function permitGroupKey(props, city = DEFAULT_CITY) {
	const request = props.request_num;
	if (request !== null && request !== undefined && Number(request) !== 0) {
		return `${city}-permit-req-${request}`;
	}
	const permit = props.permission_num;
	if (permit !== null && permit !== undefined && Number(permit) !== 0) {
		return `${city}-permit-num-${permit}`;
	}
	return `${city}-permit-oid-${props.oid_permit}`;
}

/**
 * Key for a construction site. `tik_tipul` (תיק טיפול) is the supervision file
 * number and is what layer 772 references in its tik_tipul_1..5 columns, so it
 * doubles as the join key between the two layers.
 *
 * Same multi-polygon caveat as permits, so the OID is included; `siteGroupKey`
 * recovers the file-level grouping.
 */
function siteKey(props, city = DEFAULT_CITY) {
	const file = props.tik_tipul;
	if (file !== null && file !== undefined && String(file).trim() !== '') {
		return `${city}-site-file-${String(file).trim()}-${props.oid_site}`;
	}
	return `${city}-site-oid-${props.oid_site}`;
}

/** File-level grouping key for sites, ignoring which polygon a feature is. */
function siteGroupKey(props, city = DEFAULT_CITY) {
	const file = props.tik_tipul;
	if (file !== null && file !== undefined && String(file).trim() !== '') {
		return `${city}-site-file-${String(file).trim()}`;
	}
	return `${city}-site-oid-${props.oid_site}`;
}

/**
 * Splits freshly scraped records into new ones and ones already stored.
 *
 * @param {Array<Object>} records normalized records
 * @param {Set<string>|Map<string,Object>} known keys (or key -> stored record)
 * @returns {{fresh: Array<Object>, existing: Array<Object>, duplicates: number}}
 */
function partitionByKey(records, known) {
	const has = (key) => (known instanceof Map ? known.has(key) : known.has(key));
	const fresh = [];
	const existing = [];
	const seenThisRun = new Set();
	let duplicates = 0;

	for (const record of records) {
		if (seenThisRun.has(record.dedupeKey)) {
			// Keys include the source OID, so a repeat within one crawl is not the
			// ordinary multi-parcel case - it means the same feature was fetched
			// twice, i.e. pagination drifted. Keep the first and count it so the
			// report surfaces the anomaly.
			duplicates += 1;
			continue;
		}
		seenThisRun.add(record.dedupeKey);
		if (has(record.dedupeKey)) existing.push(record);
		else fresh.push(record);
	}

	return { fresh, existing, duplicates };
}

/** Normalizes a value for comparison so null/''/undefined are one thing. */
function comparable(value) {
	if (value === null || value === undefined || value === '') return null;
	return value;
}

/**
 * Compares a scraped record against its stored version and reports changes to
 * the fields worth tracking for that kind.
 *
 * `advanced` distinguishes "moved forward along the lifecycle" from "changed at
 * all", which is what an alert should key on: a permit reaching קיים היתר means
 * construction is imminent, while a data correction is noise.
 *
 * @param {Object} scraped normalized record
 * @param {Object} stored  previously stored record; only tracked fields plus
 *                         the *Order fields need to be present
 * @returns {Array<import('./schema').StatusChange>}
 */
function diffStatus(scraped, stored) {
	if (!stored) return [];
	const fields = TRACKED_FIELDS[scraped.kind] || [];
	const orderField = scraped.kind === 'building_permit' ? 'stageOrder' : 'buildStageOrder';
	const stageField = scraped.kind === 'building_permit' ? 'stage' : 'buildStage';

	const changes = [];
	for (const field of fields) {
		const from = comparable(stored[field]);
		const to = comparable(scraped[field]);
		if (from === to) continue;

		let advanced;
		if (field === stageField) {
			const before = stored[orderField];
			const after = scraped[orderField];
			advanced = Number.isInteger(before) && Number.isInteger(after) ? after > before : to !== null;
		} else {
			// For dates and numbers, gaining a value or increasing counts as progress.
			advanced = from === null ? to !== null : to !== null && to > from;
		}

		changes.push({
			dedupeKey: scraped.dedupeKey,
			kind: scraped.kind,
			field,
			from: stored[field] === undefined ? null : stored[field],
			to: scraped[field] === undefined ? null : scraped[field],
			advanced: Boolean(advanced),
			record: scraped,
		});
	}
	return changes;
}

module.exports = {
	DEFAULT_CITY,
	permitKey,
	permitGroupKey,
	siteKey,
	siteGroupKey,
	partitionByKey,
	diffStatus,
};
