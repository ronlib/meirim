/**
 * Source: Tel Aviv-Yafo - אתרי בניה (active construction sites)
 *
 * Layer 499 of the IView2 MapServer. ~1,600 polygon features representing sites
 * under active supervision, with fine-grained on-site progress
 * (`status_pikuach`, 22 values) that the permits layer does not carry.
 *
 * This layer is current-state: it holds no per-stage date history beyond
 * `tr_status_pikuach` ("status as of"), so progression through the build stages
 * is only observable by diffing across crawls.
 *
 * Joins to tlv_building_permits via `tik_tipul` <-> `tik_tipul_1..5`, and more
 * loosely via `ms_tik_binyan` (building file id) on both layers.
 */

const { queryFeatures, validateFields } = require('../arcgis');
const { normalizeSite } = require('../normalize');
const { KIND } = require('../schema');

const SERVICE_URL = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer';
const LAYER_ID = 499;
const OID_FIELD = 'oid_site';

const CITY = 'tlv';
const CITY_NAME = 'תל אביב-יפו';

const REQUIRED_FIELDS = [
	'oid_site',
	'tik_tipul',
	'heterim',
	'status_pikuach',
	'tr_status_pikuach',
	'matzav_bniya',
	'tr_tchilat_avoda',
	'ktovet',
	'gush_chelka',
	'ms_tik_binyan',
	'date_import',
];

/**
 * `year` is not supported here: the layer has no request/permit year column.
 * `since` filters on the supervision-status date, i.e. sites whose status was
 * last updated recently - the closest thing to "recent activity" available.
 */
function buildWhere({ since } = {}) {
	if (since) return `tr_status_pikuach >= date '${since}'`;
	return '1=1';
}

/** Streams normalized ConstructionSite records. */
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
		const record = normalizeSite(feature, context);
		if (record) yield record;
	}
}

/** Parses already-fetched GeoJSON (used by fixture tests). */
function parse(geojson) {
	const features = (geojson && geojson.features) || [];
	const context = { city: CITY, cityName: CITY_NAME };
	return features.map((f) => normalizeSite(f, context)).filter(Boolean);
}

function validate({ http }) {
	return validateFields({ http, serviceUrl: SERVICE_URL, layerId: LAYER_ID, expected: REQUIRED_FIELDS });
}

module.exports = {
	name: 'tlv-construction-sites',
	kind: KIND.SITE,
	city: CITY,
	cityName: CITY_NAME,
	description: 'Tel Aviv-Yafo active construction sites under supervision (אתרי בניה)',
	serviceUrl: SERVICE_URL,
	layerId: LAYER_ID,
	requiredFields: REQUIRED_FIELDS,
	buildWhere,
	fetch,
	parse,
	validate,
};
