/**
 * Orchestrator tests. The injected `http` returns fixture pages, so the whole
 * pipeline - paging, dedup, status diffing, alert selection - is exercised with
 * no network and no database.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
// See the note in normalize.test.js - keeps both test runners working.
const { describe, it } = require('node:test');

const { crawl, isImminentConstruction } = require('../src/crawl');
const { createMemoryStore, createSilentLog } = require('../src/defaults');
const { KIND, STAGE_PERMIT_GRANTED } = require('../src/schema');
const permitsSource = require('../src/sources/tlv_building_permits');
const sitesSource = require('../src/sources/tlv_construction_sites');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

/**
 * Fake http that serves layer metadata and one page of features, then reports
 * the transfer limit as not exceeded so paging terminates.
 */
function createFakeHttp({ featuresByLayer, metadataByLayer, onRequest } = {}) {
	const calls = [];
	const http = async (url) => {
		calls.push(url);
		if (onRequest) onRequest(url);
		const layer = (url.match(/MapServer\/(\d+)/) || [])[1];

		if (!url.includes('/query')) return metadataByLayer[layer];

		if (url.includes('returnCountOnly=true')) {
			return { count: (featuresByLayer[layer] || []).length };
		}

		const offset = Number((url.match(/resultOffset=(\d+)/) || [])[1] || 0);
		const size = Number((url.match(/resultRecordCount=(\d+)/) || [])[1] || 1000);
		const all = featuresByLayer[layer] || [];
		const page = all.slice(offset, offset + size);
		return {
			type: 'FeatureCollection',
			features: page,
			exceededTransferLimit: offset + page.length < all.length,
		};
	};
	http.calls = calls;
	return http;
}

const METADATA = { 772: fixture('layer_772_metadata.json'), 499: fixture('layer_499_metadata.json') };
const FEATURES = {
	772: fixture('tlv_building_permits.geojson').features,
	499: fixture('tlv_construction_sites.geojson').features,
};

const deps = (store, http) => ({ http, log: createSilentLog(), store });

describe('building_permits/crawl', () => {
	it('saves every record on a first, empty-store crawl', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		const store = createMemoryStore();
		const report = await crawl(deps(store, http), { sources: [permitsSource, sitesSource] });

		assert.strictEqual(report.totals.failures, 0);
		assert.strictEqual(report.totals.fetched, FEATURES[772].length + FEATURES[499].length);
		assert.strictEqual(report.totals.saved, report.totals.fetched);
		assert.strictEqual(report.totals.changes, 0, 'nothing to diff against on a first run');
		assert.strictEqual(store.all().length, report.totals.saved);
	});

	it('is idempotent: a second identical crawl saves nothing and finds no changes', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		const store = createMemoryStore();
		await crawl(deps(store, http), { sources: [permitsSource] });
		const report = await crawl(deps(store, http), { sources: [permitsSource] });

		assert.strictEqual(report.totals.saved, 0);
		assert.strictEqual(report.totals.changes, 0);
		assert.strictEqual(report.totals.duplicates, 0);
	});

	it('pages through more features than fit in one request', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		const store = createMemoryStore();
		const report = await crawl(deps(store, http), { sources: [permitsSource], pageSize: 2 });

		assert.strictEqual(report.totals.fetched, FEATURES[772].length, 'no features lost across pages');
		assert.strictEqual(report.totals.duplicates, 0, 'no features fetched twice');
		const queryCalls = http.calls.filter((u) => u.includes('/query')).length;
		assert.ok(queryCalls > 1, 'should have made several paged requests');
	});

	it('orders by the object id so paging is stable', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		await crawl(deps(createMemoryStore(), http), { sources: [permitsSource], pageSize: 2 });
		http.calls.filter((u) => u.includes('resultOffset')).forEach((url) => {
			assert.ok(url.includes('orderByFields=oid_permit'), `missing stable ordering: ${url}`);
		});
	});

	it('detects a permit advancing to granted and marks it as imminent construction', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		const store = createMemoryStore();
		await crawl(deps(store, http), { sources: [permitsSource] });

		// Rewind one stored permit to "in process" to simulate the previous crawl.
		const target = store.all().find((r) => r.kind === KIND.PERMIT);
		await store.save({ ...target, stage: 'בתהליך היתר', stageOrder: 0, constructionStartedAt: null });

		const report = await crawl(deps(store, http), { sources: [permitsSource] });
		assert.ok(report.totals.changes > 0, 'should detect the rewound fields');

		if (target.stage === STAGE_PERMIT_GRANTED) {
			assert.ok(report.imminentChanges.length > 0, 'reaching granted must raise an alert');
			assert.ok(report.imminentChanges.every((c) => c.advanced));
		}
	});

	it('classifies alert triggers correctly', () => {
		const granted = { kind: KIND.PERMIT, field: 'stage', to: STAGE_PERMIT_GRANTED, advanced: true };
		assert.strictEqual(isImminentConstruction(granted), true);

		// Advancing past granted is not the "about to start" signal.
		assert.strictEqual(isImminentConstruction({ ...granted, to: 'קיים אכלוס' }), false);
		// Backward movement (a data correction) is not an alert.
		assert.strictEqual(isImminentConstruction({ ...granted, advanced: false }), false);
		// Construction actually starting is.
		assert.strictEqual(
			isImminentConstruction({ kind: KIND.PERMIT, field: 'constructionStartedAt', to: '2026-02-16', advanced: true }),
			true
		);
		// Site-layer changes go down a different path.
		assert.strictEqual(isImminentConstruction({ kind: KIND.SITE, field: 'buildStage', advanced: true }), false);
	});

	it('writes nothing to the store on a dry run but still reports', async () => {
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
		const store = createMemoryStore();
		const report = await crawl(deps(store, http), { sources: [permitsSource], dryRun: true });

		assert.ok(report.totals.saved > 0, 'report still counts what would be saved');
		assert.strictEqual(store.all().length, 0, 'store untouched');
	});

	it('fails the source, not the run, when a layer drops an expected field', async () => {
		const brokenMetadata = {
			...METADATA,
			772: { ...METADATA[772], fields: METADATA[772].fields.filter((f) => f.name !== 'building_stage') },
		};
		const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: brokenMetadata });
		const report = await crawl(deps(createMemoryStore(), http), { sources: [permitsSource, sitesSource] });

		assert.strictEqual(report.totals.failures, 1);
		const failed = report.sources.find((s) => s.source === permitsSource.name);
		assert.match(failed.errors[0], /building_stage/);
		// the healthy source still ran
		const ok = report.sources.find((s) => s.source === sitesSource.name);
		assert.strictEqual(ok.errors.length, 0);
		assert.ok(ok.saved > 0);
	});

	it('surfaces an ArcGIS in-body error rather than treating it as an empty page', async () => {
		const http = async (url) => {
			if (!url.includes('/query')) return METADATA[772];
			return { error: { message: 'Unable to complete operation' } };
		};
		const report = await crawl(deps(createMemoryStore(), http), { sources: [permitsSource] });
		assert.strictEqual(report.totals.failures, 1);
		assert.match(report.sources[0].errors[0], /Unable to complete operation/);
	});

	it('rejects a crawl with no sources', async () => {
		await assert.rejects(
			() => crawl(deps(createMemoryStore(), createFakeHttp({ featuresByLayer: {}, metadataByLayer: {} })), { sources: [] }),
			/no sources/
		);
	});

	describe('area filtering', () => {
		const { spatialParams } = require('../src/arcgis');

		it('builds an envelope query from a bbox', () => {
			const params = spatialParams({ bbox: [34.77, 32.06, 34.78, 32.07] });
			assert.strictEqual(params.geometryType, 'esriGeometryEnvelope');
			assert.strictEqual(params.geometry, '34.77,32.06,34.78,32.07');
			assert.strictEqual(params.inSR, '4326');
			assert.strictEqual(params.spatialRel, 'esriSpatialRelIntersects');
		});

		it('builds a point-and-distance query from a center and radius', () => {
			const params = spatialParams({ center: [34.7749, 32.0754], radiusMeters: 300 });
			assert.strictEqual(params.geometryType, 'esriGeometryPoint');
			assert.strictEqual(params.distance, '300');
			assert.strictEqual(params.units, 'esriSRUnit_Meter');
			assert.deepStrictEqual(JSON.parse(params.geometry), {
				x: 34.7749,
				y: 32.0754,
				spatialReference: { wkid: 4326 },
			});
		});

		it('builds a polygon query from GeoJSON', () => {
			const ring = [[[34.77, 32.06], [34.78, 32.06], [34.78, 32.07], [34.77, 32.06]]];
			const params = spatialParams({ geometry: { type: 'Polygon', coordinates: ring } });
			assert.strictEqual(params.geometryType, 'esriGeometryPolygon');
			assert.deepStrictEqual(JSON.parse(params.geometry).rings, ring);
		});

		it('honours a containment relationship', () => {
			const params = spatialParams({ bbox: [0, 0, 1, 1], spatialRel: 'esriSpatialRelWithin' });
			assert.strictEqual(params.spatialRel, 'esriSpatialRelWithin');
		});

		it('returns null when no area is given, leaving the query unfiltered', () => {
			assert.strictEqual(spatialParams(undefined), null);
			assert.strictEqual(spatialParams(null), null);
		});

		it('rejects malformed areas before any request is made', () => {
			assert.throws(() => spatialParams({ bbox: [1, 2, 3] }), /four finite numbers/);
			assert.throws(() => spatialParams({ bbox: [1, 2, 3, NaN] }), /four finite numbers/);
			assert.throws(() => spatialParams({ center: [34.7, 32.0] }), /radiusMeters/);
			assert.throws(() => spatialParams({ center: [34.7, 32.0], radiusMeters: 0 }), /radiusMeters/);
			assert.throws(() => spatialParams({ center: ['a', 'b'], radiusMeters: 5 }), /\[lon, lat\]/);
			assert.throws(() => spatialParams({ geometry: { type: 'Point', coordinates: [1, 2] } }), /Polygon/);
			assert.throws(() => spatialParams({}), /bbox, center\+radiusMeters, geometry/);
		});

		it('passes the spatial parameters through to every paged request', async () => {
			const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
			await crawl(deps(createMemoryStore(), http), {
				sources: [permitsSource],
				area: { center: [34.7749, 32.0754], radiusMeters: 300 },
				pageSize: 2,
			});

			const queries = http.calls.filter((u) => u.includes('resultOffset'));
			assert.ok(queries.length > 1, 'expected several pages');
			queries.forEach((url) => {
				assert.ok(url.includes('geometryType=esriGeometryPoint'), `area lost on: ${url}`);
				assert.ok(url.includes('distance=300'));
				assert.ok(url.includes('units=esriSRUnit_Meter'));
			});
		});

		it('composes with attribute filters rather than replacing them', async () => {
			const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
			await crawl(deps(createMemoryStore(), http), {
				sources: [permitsSource],
				area: { bbox: [34.77, 32.06, 34.78, 32.07] },
				since: '2026-01-01',
			});

			const query = http.calls.find((u) => u.includes('resultOffset'));
			assert.ok(query.includes('geometryType=esriGeometryEnvelope'), 'area filter missing');
			assert.ok(/permission_date/.test(decodeURIComponent(query)), 'attribute filter missing');
		});

		it('fails the source instead of silently crawling everything on a bad area', async () => {
			const http = createFakeHttp({ featuresByLayer: FEATURES, metadataByLayer: METADATA });
			const store = createMemoryStore();
			const report = await crawl(deps(store, http), {
				sources: [permitsSource],
				area: { bbox: [1, 2, 3] },
			});

			assert.strictEqual(report.totals.failures, 1);
			assert.strictEqual(report.totals.saved, 0, 'must not fall back to an unfiltered crawl');
			assert.strictEqual(store.all().length, 0);
		});
	});

	describe('multi-city support', () => {
		const registry = require('../src/sources');
		const { permitKey, siteKey, permitGroupKey } = require('../src/dedupe');

		it('namespaces keys by city so two municipalities cannot collide', () => {
			// The same request number in two cities is two different permits.
			const props = { request_num: 20220582, oid_permit: 970 };
			assert.notStrictEqual(permitKey(props, 'tlv'), permitKey(props, 'haifa'));
			assert.ok(permitKey(props, 'haifa').startsWith('haifa-'));
			assert.notStrictEqual(permitGroupKey(props, 'tlv'), permitGroupKey(props, 'haifa'));
			assert.notStrictEqual(
				siteKey({ tik_tipul: '63-1', oid_site: 4 }, 'tlv'),
				siteKey({ tik_tipul: '63-1', oid_site: 4 }, 'ramat-gan')
			);
		});

		it('stamps every record with its city', () => {
			const records = permitsSource.parse(fixture('tlv_building_permits.geojson'));
			assert.ok(records.length > 0);
			records.forEach((record) => {
				assert.strictEqual(record.city, 'tlv');
				assert.strictEqual(record.cityName, 'תל אביב-יפו');
				assert.ok(record.dedupeKey.startsWith('tlv-'));
			});
		});

		it('every registered source declares the fields the registry relies on', () => {
			registry.ALL.forEach((source) => {
				assert.ok(source.name, 'source needs a name');
				assert.ok(source.city, `${source.name} needs a city code`);
				assert.ok(source.kind, `${source.name} needs a kind`);
				assert.strictEqual(typeof source.fetch, 'function', `${source.name} needs fetch()`);
			});
		});

		it('has unique source names', () => {
			const names = registry.ALL.map((s) => s.name);
			assert.strictEqual(new Set(names).size, names.length, 'duplicate source name');
		});

		it('selects sources by city code as well as by name', () => {
			const byCity = registry.resolve('tlv');
			assert.strictEqual(byCity.length, 2, 'tlv has two sources');
			byCity.forEach((s) => assert.strictEqual(s.city, 'tlv'));

			const byName = registry.resolve('tlv-building-permits');
			assert.deepStrictEqual(byName.map((s) => s.name), ['tlv-building-permits']);
		});

		it('does not return a source twice when a city and its source are both named', () => {
			const resolved = registry.resolve('tlv,tlv-building-permits');
			assert.strictEqual(new Set(resolved).size, resolved.length);
			assert.strictEqual(resolved.length, 2);
		});

		it('lists implemented cities', () => {
			const list = registry.cities();
			const tlv = list.find((c) => c.city === 'tlv');
			assert.ok(tlv, 'tlv should be listed');
			assert.strictEqual(tlv.sources.length, 2);
		});

		it('explains what is available when given an unknown selector', () => {
			assert.throws(() => registry.resolve('nowhere-city'), /unknown source or city/);
			assert.throws(() => registry.resolve('nowhere-city'), /Cities:/);
		});
	});

	describe('where clauses', () => {
		it('filters permits by request-opened year', () => {
			const where = permitsSource.buildWhere({ year: 2026 });
			assert.match(where, /open_request >= date '2026-01-01'/);
			assert.match(where, /open_request < date '2027-01-01'/);
		});

		it('filters permits on recent permit or construction activity', () => {
			const where = permitsSource.buildWhere({ since: '2026-01-01' });
			assert.match(where, /permission_date >= date '2026-01-01'/);
			assert.match(where, /tr_hathalat_bniya >= date '2026-01-01'/);
		});

		it('defaults to everything', () => {
			assert.strictEqual(permitsSource.buildWhere({}), '1=1');
			assert.strictEqual(sitesSource.buildWhere({}), '1=1');
		});

		it('filters sites on the supervision-status date', () => {
			assert.match(sitesSource.buildWhere({ since: '2026-01-01' }), /tr_status_pikuach >= date '2026-01-01'/);
		});
	});
});
