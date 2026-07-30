/**
 * Source registry. Adding a municipality means adding module(s) here and
 * registering them below - crawl.js, dedupe.js and the CLI are source-agnostic.
 *
 * A source module is any object shaped like:
 *
 *   {
 *     name: 'city-entity',        // unique; how the CLI selects it
 *     kind: KIND.PERMIT | KIND.SITE,
 *     city: 'tlv',               // namespaces dedupe keys; unique per municipality
 *     cityName: 'תל אביב-יפו',
 *     description: '...',
 *     requiredFields: [...],      // upstream fields the parser depends on
 *     buildWhere(options),        // -> attribute filter (source's own query language)
 *     async *fetch(deps, options),// -> yields canonical records
 *     parse(rawPayload),          // -> canonical records, for fixture tests
 *     validate(deps),             // -> [] or names of missing fields
 *   }
 *
 * Only `fetch` is required by the crawler; the rest make it testable and
 * selectable. Sources need not be ArcGIS - a city serving HTML or Excel just
 * implements `fetch` differently and normalizes to the same canonical shape.
 * `serviceUrl`/`layerId` are ArcGIS-specific conveniences, not part of the
 * contract.
 */

const tlvBuildingPermits = require('./tlv_building_permits');
const tlvConstructionSites = require('./tlv_construction_sites');

const ALL = [tlvBuildingPermits, tlvConstructionSites];

const BY_NAME = new Map(ALL.map((source) => [source.name, source]));

/** Municipality code -> its sources. */
const BY_CITY = ALL.reduce((map, source) => {
	const list = map.get(source.city) || [];
	list.push(source);
	return map.set(source.city, list);
}, new Map());

/** Every municipality currently implemented. */
function cities() {
	return [...BY_CITY.keys()].map((city) => ({
		city,
		cityName: (BY_CITY.get(city)[0] || {}).cityName || null,
		sources: BY_CITY.get(city).map((s) => s.name),
	}));
}

/**
 * Resolves a selector to source modules. Accepts, in order of precedence:
 *   'all'                     every source
 *   a city code ('tlv')       every source for that municipality
 *   a source name             that one source
 * and comma-separated combinations of the above.
 *
 * @param {string|string[]} [selector='all']
 * @returns {Array<Object>}
 */
function resolve(selector = 'all') {
	const names = Array.isArray(selector)
		? selector
		: String(selector).split(',').map((s) => s.trim()).filter(Boolean);

	if (!names.length || names.includes('all')) return [...ALL];

	const out = [];
	for (const name of names) {
		if (BY_CITY.has(name)) {
			out.push(...BY_CITY.get(name));
			continue;
		}
		const source = BY_NAME.get(name);
		if (!source) {
			throw new Error(
				`unknown source or city '${name}'. ` +
				`Sources: ${[...BY_NAME.keys()].join(', ')}. ` +
				`Cities: ${[...BY_CITY.keys()].join(', ')}. Or 'all'.`
			);
		}
		out.push(source);
	}
	// De-duplicate, since a city and one of its sources may both be named.
	return [...new Set(out)];
}

module.exports = {
	ALL,
	BY_NAME,
	BY_CITY,
	cities,
	resolve,
	tlvBuildingPermits,
	tlvConstructionSites,
};
