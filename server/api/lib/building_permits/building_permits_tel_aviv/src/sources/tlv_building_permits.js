/**
 * Source: Tel Aviv-Yafo - בקשות והיתרי בניה (building permit requests & permits)
 *
 * Layer 772 of the IView2 MapServer. ~10,500 polygon features, one per permit
 * request, each carrying its own embedded date timeline (request opened ->
 * permit granted -> construction started), which is what makes retroactive
 * history possible without snapshotting.
 */

const { queryFeatures, validateFields } = require('../arcgis');
const { normalizePermit } = require('../normalize');
const { KIND } = require('../schema');

const SERVICE_URL = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer';
const LAYER_ID = 772;
const OID_FIELD = 'oid_permit';

/** Namespaces this city's dedupe keys; must be unique across sources. */
const CITY = 'tlv';
const CITY_NAME = 'תל אביב-יפו';

/** Fields the normalizer depends on; checked against the live layer by `validate`. */
const REQUIRED_FIELDS = [
	'oid_permit',
	'request_num',
	'permission_num',
	'permission_date',
	'open_request',
	'expiry_date',
	'tr_hathalat_bniya',
	'building_stage',
	'request_stage',
	'progress',
	'addresses',
	'ms_tik_binyan',
	'date_import',
];

/**
 * Builds an ArcGIS `where` clause from crawl options.
 *
 * Note on `year`: the source has no single "year" column, so a year filter is
 * expressed against the request-opened date. `since` filters on activity that
 * matters for alerting - a permit granted or construction started recently -
 * rather than on when the request was first opened, which can be years back.
 */
function buildWhere({ year, since } = {}) {
	const clauses = [];
	if (year) {
		clauses.push(`open_request >= date '${year}-01-01' AND open_request < date '${Number(year) + 1}-01-01'`);
	}
	if (since) {
		clauses.push(`(permission_date >= date '${since}' OR tr_hathalat_bniya >= date '${since}')`);
	}
	return clauses.length ? clauses.join(' AND ') : '1=1';
}

/**
 * Streams normalized BuildingPermit records.
 * @param {Object}   deps
 * @param {Function} deps.http
 * @param {Object}   [deps.log]
 * @param {Object}   [options] {year, since, maxFeatures, pageSize}
 */
async function* fetch({ http, log }, options = {}) {
	const features = queryFeatures({
		http,
		log,
		serviceUrl: SERVICE_URL,
		layerId: LAYER_ID,
		where: buildWhere(options),
		area: options.area,
		orderByFields: OID_FIELD,
		pageSize: options.pageSize,
		maxFeatures: options.maxFeatures,
	});

	const context = { city: CITY, cityName: CITY_NAME };
	for await (const feature of features) {
		const record = normalizePermit(feature, context);
		if (record) yield record;
	}
}

/** Parses already-fetched GeoJSON (used by fixture tests). */
function parse(geojson) {
	const features = (geojson && geojson.features) || [];
	const context = { city: CITY, cityName: CITY_NAME };
	return features.map((f) => normalizePermit(f, context)).filter(Boolean);
}

/** Confirms the upstream layer still exposes the fields we read. */
function validate({ http }) {
	return validateFields({ http, serviceUrl: SERVICE_URL, layerId: LAYER_ID, expected: REQUIRED_FIELDS });
}

module.exports = {
	name: 'tlv-building-permits',
	kind: KIND.PERMIT,
	city: CITY,
	cityName: CITY_NAME,
	description: 'Tel Aviv-Yafo building permit requests and granted permits (בקשות והיתרי בניה)',
	serviceUrl: SERVICE_URL,
	layerId: LAYER_ID,
	requiredFields: REQUIRED_FIELDS,
	buildWhere,
	fetch,
	parse,
	validate,
};
