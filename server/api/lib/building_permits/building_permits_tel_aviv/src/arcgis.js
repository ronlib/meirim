/**
 * Minimal ArcGIS REST client. No SDK, no dependencies - the query API is a
 * handful of query-string parameters and we only need `query`.
 *
 * Everything here is generic to ArcGIS MapServer/FeatureServer layers, so this
 * file is reusable for any other Israeli municipal GIS layer (most of them are
 * ArcGIS) without touching the Tel Aviv specifics in sources/.
 */

const DEFAULT_PAGE_SIZE = 1000; // layers advertise maxRecordCount 2000; stay well under

/** Builds a `.../MapServer/<layerId>` base URL. */
function layerUrl(serviceUrl, layerId) {
	return `${serviceUrl.replace(/\/+$/, '')}/${layerId}`;
}

/** WGS84. The layers store EPSG:2039 but accept and return 4326 on request. */
const WGS84 = 4326;

/**
 * Translates an area filter into ArcGIS spatial query parameters.
 *
 * Filtering server-side matters: a 300m radius returns ~145 features instead of
 * 10,561, so an area-scoped crawl is a single small request.
 *
 * Accepts one of:
 *   {bbox: [west, south, east, north]}          - lon/lat envelope
 *   {center: [lon, lat], radiusMeters: 500}     - point + radius
 *   {geometry: <GeoJSON Polygon>}               - arbitrary polygon
 *
 * `spatialRel` defaults to intersects, which is what "a permit touching this
 * area" means; pass 'esriSpatialRelWithin' for strict containment.
 *
 * @returns {Object|null} params to merge into a query, or null when no area given
 */
function spatialParams(area) {
	if (!area) return null;

	const spatialRel = area.spatialRel || 'esriSpatialRelIntersects';

	if (area.bbox) {
		const [west, south, east, north] = area.bbox;
		if ([west, south, east, north].some((n) => !Number.isFinite(n))) {
			throw new Error('area.bbox must be four finite numbers: [west, south, east, north]');
		}
		return {
			geometry: `${west},${south},${east},${north}`,
			geometryType: 'esriGeometryEnvelope',
			inSR: String(WGS84),
			spatialRel,
		};
	}

	if (area.center) {
		const [lon, lat] = area.center;
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
			throw new Error('area.center must be [lon, lat]');
		}
		if (!Number.isFinite(area.radiusMeters) || area.radiusMeters <= 0) {
			throw new Error('area.center requires a positive area.radiusMeters');
		}
		return {
			geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: WGS84 } }),
			geometryType: 'esriGeometryPoint',
			inSR: String(WGS84),
			distance: String(area.radiusMeters),
			units: 'esriSRUnit_Meter',
			spatialRel,
		};
	}

	if (area.geometry) {
		const geom = area.geometry;
		if (!geom.type || geom.type !== 'Polygon' || !Array.isArray(geom.coordinates)) {
			throw new Error('area.geometry must be a GeoJSON Polygon');
		}
		// GeoJSON rings -> Esri rings; the coordinate arrays are compatible.
		return {
			geometry: JSON.stringify({ rings: geom.coordinates, spatialReference: { wkid: WGS84 } }),
			geometryType: 'esriGeometryPolygon',
			inSR: String(WGS84),
			spatialRel,
		};
	}

	throw new Error('area must specify one of: bbox, center+radiusMeters, geometry');
}

/**
 * Fetch a layer's metadata (fields, geometry type, capabilities).
 * Useful for validating that a source's assumptions still hold - see
 * `validateFields` below.
 */
async function describeLayer({ http, serviceUrl, layerId }) {
	return http(`${layerUrl(serviceUrl, layerId)}?f=json`);
}

/**
 * Assert that every field the source depends on still exists upstream.
 * ArcGIS layers get re-published and renamed; failing loudly here beats
 * silently writing rows full of nulls.
 *
 * @returns {string[]} names of missing fields (empty when all present)
 */
async function validateFields({ http, serviceUrl, layerId, expected }) {
	const meta = await describeLayer({ http, serviceUrl, layerId });
	const present = new Set((meta.fields || []).map((f) => f.name));
	return expected.filter((name) => !present.has(name));
}

/** Returns the total feature count matching `where` (and `area`, if given). */
async function count({ http, serviceUrl, layerId, where = '1=1', area }) {
	const params = new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' });
	const spatial = spatialParams(area);
	if (spatial) Object.entries(spatial).forEach(([k, v]) => params.set(k, v));

	const body = await http(`${layerUrl(serviceUrl, layerId)}/query?${params}`);
	if (body.error) {
		throw new Error(`ArcGIS error counting layer ${layerId}: ${body.error.message || JSON.stringify(body.error)}`);
	}
	return body.count;
}

/**
 * Page through a layer, yielding GeoJSON features.
 *
 * `f=geojson` is deliberate: the service stores ITM / EPSG:2039 but reprojects
 * to WGS84 lon/lat on the way out, which spares us a projection dependency.
 *
 * Ordering by the OID field is required for stable pagination - without an
 * explicit order, ArcGIS does not guarantee that offsets are consistent
 * between requests, and rows can be skipped or duplicated.
 *
 * @yields {Object} GeoJSON Feature
 */
async function* queryFeatures({
	http,
	log,
	serviceUrl,
	layerId,
	where = '1=1',
	area,
	orderByFields,
	outFields = '*',
	pageSize = DEFAULT_PAGE_SIZE,
	returnGeometry = true,
	maxFeatures = Infinity,
}) {
	let offset = 0;
	let emitted = 0;
	// Computed once: an invalid area should throw before any request is made.
	const spatial = spatialParams(area);

	for (;;) {
		const params = new URLSearchParams({
			where,
			outFields,
			returnGeometry: String(returnGeometry),
			resultOffset: String(offset),
			resultRecordCount: String(Math.min(pageSize, maxFeatures - emitted)),
			f: 'geojson',
		});
		if (orderByFields) params.set('orderByFields', orderByFields);
		if (spatial) Object.entries(spatial).forEach(([k, v]) => params.set(k, v));

		const url = `${layerUrl(serviceUrl, layerId)}/query?${params}`;
		const body = await http(url);

		// ArcGIS reports errors with HTTP 200 and an `error` object in the body.
		if (body.error) {
			throw new Error(`ArcGIS error on layer ${layerId}: ${body.error.message || JSON.stringify(body.error)}`);
		}

		const features = body.features || [];
		if (log) log.debug(`layer ${layerId}: fetched ${features.length} features at offset ${offset}`);
		for (const feature of features) {
			yield feature;
			emitted += 1;
		}

		const exceeded = body.exceededTransferLimit || (body.properties && body.properties.exceededTransferLimit);
		if (features.length === 0 || emitted >= maxFeatures || !exceeded) break;
		offset += features.length;
	}
}

/** Collects `queryFeatures` into an array. Convenience for small layers/tests. */
async function queryAll(options) {
	const out = [];
	for await (const feature of queryFeatures(options)) out.push(feature);
	return out;
}

/**
 * ArcGIS date fields come back as epoch milliseconds (numbers). Some
 * date-ish fields in these layers are typed as String upstream and hold
 * dd/mm/yyyy text instead; those are passed through untouched by normalize.js.
 *
 * @returns {string|null} ISO-8601 UTC string
 */
function esriDateToIso(value) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'number') return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parses the `date_import` format used by these layers ("30/07/2026 00:59:34").
 * Treated as Asia/Jerusalem wall-clock time but stored without offset
 * conversion - it is a provenance marker, not something we compute against.
 */
function importStampToIso(value) {
	if (!value || typeof value !== 'string') return null;
	const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
	if (!m) return null;
	const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
	return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
}

module.exports = {
	DEFAULT_PAGE_SIZE,
	WGS84,
	layerUrl,
	spatialParams,
	describeLayer,
	validateFields,
	count,
	queryFeatures,
	queryAll,
	esriDateToIso,
	importStampToIso,
};
