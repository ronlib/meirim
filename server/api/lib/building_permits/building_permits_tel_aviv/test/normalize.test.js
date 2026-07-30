/**
 * Fixture-based parser tests. No network: fixtures are real responses captured
 * from the live layers (see README for how to refresh them).
 *
 * These tests are the durable asset of this unit - they encode what the source's
 * fields actually mean. Keep them passing across any rewrite.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
// Imported rather than assumed as globals, so the suite runs under both
// `node --test` (no install needed) and the host project's mocha.
const { describe, it } = require('node:test');

const { normalizePermit, normalizeSite, hebrewBool, stageOrder, intOrNull, str } = require('../src/normalize');
const { permitKey, permitGroupKey, siteKey, partitionByKey, diffStatus } = require('../src/dedupe');
const { PERMIT_STAGES, SITE_STAGES, KIND } = require('../src/schema');
const { esriDateToIso, importStampToIso } = require('../src/arcgis');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

/** First coordinate of a Polygon or MultiPolygon, for range assertions. */
function firstCoordinate(geometry) {
	return geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0][0] : geometry.coordinates[0][0];
}

describe('building_permits/normalize', () => {
	describe('helpers', () => {
		it('treats blank strings as null', () => {
			assert.strictEqual(str('  '), null);
			assert.strictEqual(str(''), null);
			assert.strictEqual(str(null), null);
			assert.strictEqual(str(' 63-1-2022 '), '63-1-2022');
		});

		it('maps the source zero sentinel to null only when asked', () => {
			assert.strictEqual(intOrNull(0), 0);
			assert.strictEqual(intOrNull(0, { zeroIsNull: true }), null);
			assert.strictEqual(intOrNull('', { zeroIsNull: true }), null);
			assert.strictEqual(intOrNull(20240134), 20240134);
		});

		it('parses the Hebrew boolean encoding', () => {
			assert.strictEqual(hebrewBool('כן'), true);
			assert.strictEqual(hebrewBool('לא'), false);
			assert.strictEqual(hebrewBool(''), null);
			assert.strictEqual(hebrewBool('maybe'), null);
		});

		it('places values on the lifecycle ladders', () => {
			assert.strictEqual(stageOrder(PERMIT_STAGES, 'בתהליך היתר'), 0);
			assert.strictEqual(stageOrder(PERMIT_STAGES, 'קיים אכלוס'), 4);
			assert.strictEqual(stageOrder(PERMIT_STAGES, 'nonsense'), null);
			// '' is a real value in the sites layer and must not be "unknown"
			assert.strictEqual(stageOrder(SITE_STAGES, ''), 0);
			assert.strictEqual(stageOrder(SITE_STAGES, null), 0);
		});

		it('converts Esri epoch-ms dates and rejects string dates', () => {
			assert.strictEqual(esriDateToIso(1546332540000), '2019-01-01T08:49:00.000Z');
			assert.strictEqual(esriDateToIso(null), null);
			assert.strictEqual(esriDateToIso(''), null);
			// date-typed-as-string fields must not be silently coerced
			assert.strictEqual(esriDateToIso('01/01/2019'), null);
		});

		it('parses the date_import provenance stamp', () => {
			assert.strictEqual(importStampToIso('30/07/2026 00:59:34'), '2026-07-30T00:59:34Z');
			assert.strictEqual(importStampToIso('30/07/2026'), '2026-07-30T00:00:00Z');
			assert.strictEqual(importStampToIso('garbage'), null);
			assert.strictEqual(importStampToIso(''), null);
		});
	});

	describe('permits (layer 772)', () => {
		const features = fixture('tlv_building_permits.geojson').features;
		// The city context is what a source module supplies; see sources/*.js.
		const TLV = { city: 'tlv', cityName: 'תל אביב-יפו' };
		const records = features.map((f) => normalizePermit(f, TLV));

		it('normalizes every fixture feature', () => {
			assert.ok(features.length > 0, 'fixture should not be empty');
			assert.strictEqual(records.filter(Boolean).length, features.length);
		});

		it('preserves every raw attribute under sourceFields', () => {
			records.forEach((record, i) => {
				const raw = features[i].properties;
				assert.deepStrictEqual(record.sourceFields, raw);
				// nothing is dropped, even fields we do not type
				Object.keys(raw).forEach((key) => assert.ok(key in record.sourceFields, `${key} missing`));
			});
		});

		it('emits WGS84 GeoJSON geometry inside Israel', () => {
			records.filter((r) => r.geometry).forEach((record) => {
				// Measured on a 1000-record sample: ~99.5% Polygon, ~0.5% MultiPolygon.
				assert.ok(
					['Polygon', 'MultiPolygon'].includes(record.geometry.type),
					`unexpected geometry type ${record.geometry.type}`
				);
				const [lon, lat] = firstCoordinate(record.geometry);
				// Tel Aviv is ~34.7E, 32.0N. ITM coordinates would be ~180000, 660000.
				assert.ok(lon > 34 && lon < 36, `lon ${lon} not in Israel - is the source still reprojecting?`);
				assert.ok(lat > 29 && lat < 34, `lat ${lat} not in Israel`);
			});
		});

		it('exposes the embedded permit timeline as ISO dates', () => {
			const withGrant = records.filter((r) => r.permitGrantedAt);
			assert.ok(withGrant.length > 0, 'fixture was captured with permission_date set');
			withGrant.forEach((record) => {
				assert.match(record.permitGrantedAt, /^\d{4}-\d{2}-\d{2}T/);
				assert.ok(!Number.isNaN(Date.parse(record.permitGrantedAt)));
			});
		});

		it('keeps stage and stageOrder consistent', () => {
			records.forEach((record) => {
				if (record.stageOrder === null) return;
				assert.strictEqual(PERMIT_STAGES[record.stageOrder], record.stage);
			});
		});

		it('sets kind and a stable key shape', () => {
			records.forEach((record) => {
				assert.strictEqual(record.kind, KIND.PERMIT);
				assert.match(record.dedupeKey, /^tlv-permit-/);
				assert.ok(record.groupKey && record.dedupeKey.startsWith(record.groupKey));
			});
		});

		it('normalizes the tama38 flags into booleans', () => {
			records.forEach((record) => {
				[record.tama38.applies, record.tama38.isNew, record.tama38.isAddition].forEach((v) => {
					assert.ok(v === true || v === false || v === null);
				});
			});
		});

		it('returns null for a feature with no object id', () => {
			assert.strictEqual(normalizePermit({ properties: {} }), null);
			assert.strictEqual(normalizePermit({}), null);
		});

		it('falls back to a placeholder city when none is supplied', () => {
			// Guards against a source forgetting to pass its city: keys stay
			// well-formed and obviously wrong rather than silently claiming 'tlv'.
			const record = normalizePermit(features[0]);
			assert.strictEqual(record.city, 'unknown');
			assert.ok(record.dedupeKey.startsWith('unknown-'));
		});

		it('passes multi-part geometry through intact', () => {
			// ~0.5% of permits are MultiPolygon (a permit whose parcels are not
			// contiguous). Geometry must not be flattened or truncated to the
			// first ring - a host writing a GEOMETRY column has to accept both.
			const multi = fixture('tlv_building_permits_multipolygon.geojson').features;
			assert.ok(multi.length > 0, 'fixture should contain multipolygon features');

			multi.map(normalizePermit).forEach((record, i) => {
				assert.strictEqual(record.geometry.type, 'MultiPolygon');
				assert.deepStrictEqual(record.geometry, multi[i].geometry, 'geometry must be untouched');
				assert.ok(record.geometry.coordinates.length > 1, 'should retain every part');
				const [lon, lat] = firstCoordinate(record.geometry);
				assert.ok(lon > 34 && lon < 36 && lat > 29 && lat < 34);
			});
		});
	});

	describe('construction sites (layer 499)', () => {
		const features = fixture('tlv_construction_sites.geojson').features;
		const TLV = { city: 'tlv', cityName: 'תל אביב-יפו' };
		const records = features.map((f) => normalizeSite(f, TLV));

		it('normalizes every fixture feature', () => {
			assert.ok(features.length > 0);
			assert.strictEqual(records.filter(Boolean).length, features.length);
		});

		it('preserves every raw attribute', () => {
			records.forEach((record, i) => {
				assert.deepStrictEqual(record.sourceFields, features[i].properties);
			});
		});

		it('keeps buildStage and buildStageOrder consistent', () => {
			records.forEach((record) => {
				if (record.buildStageOrder === null) return;
				assert.strictEqual(SITE_STAGES[record.buildStageOrder], record.buildStage || '');
			});
		});

		it('exposes the tracking file that joins to the permits layer', () => {
			const withFile = records.filter((r) => r.trackingFile);
			assert.ok(withFile.length > 0, 'sites should carry tik_tipul');
			withFile.forEach((record) => assert.match(record.dedupeKey, /^tlv-site-file-/));
		});

		it('returns null for a feature with no object id', () => {
			assert.strictEqual(normalizeSite({ properties: {} }), null);
		});
	});

	describe('source field expectations still match the layer metadata', () => {
		// Guards against the upstream layer being republished with renamed fields.
		const cases = [
			['tlv_building_permits', 'layer_772_metadata.json', require('../src/sources/tlv_building_permits')],
			['tlv_construction_sites', 'layer_499_metadata.json', require('../src/sources/tlv_construction_sites')],
		];

		cases.forEach(([label, metaFile, source]) => {
			it(`${label}: every required field exists in the captured schema`, () => {
				const present = new Set(fixture(metaFile).fields.map((f) => f.name));
				const missing = source.requiredFields.filter((name) => !present.has(name));
				assert.deepStrictEqual(missing, [], `missing: ${missing.join(', ')}`);
			});
		});
	});
});

describe('building_permits/dedupe', () => {
	it('separates multi-parcel polygons of one permit but groups them', () => {
		// Real case from the layer: request 20160426 appears at oid 915 and 916.
		const a = { request_num: 20160426, oid_permit: 915 };
		const b = { request_num: 20160426, oid_permit: 916 };
		assert.notStrictEqual(permitKey(a), permitKey(b), 'polygons must not collapse');
		assert.strictEqual(permitGroupKey(a), permitGroupKey(b), 'same permit must share a group');
	});

	it('falls back through permit number to object id', () => {
		assert.strictEqual(permitKey({ request_num: 0, permission_num: 20240134, oid_permit: 7 }, 'tlv'), 'tlv-permit-num-20240134-7');
		assert.strictEqual(permitKey({ request_num: 0, permission_num: 0, oid_permit: 7 }, 'tlv'), 'tlv-permit-oid-7');
	});

	it('keys sites on the supervision file', () => {
		assert.strictEqual(siteKey({ tik_tipul: ' 63-1-2022-0316 ', oid_site: 4 }, 'tlv'), 'tlv-site-file-63-1-2022-0316-4');
		assert.strictEqual(siteKey({ tik_tipul: '', oid_site: 4 }, 'tlv'), 'tlv-site-oid-4');
	});

	it('splits records into fresh and existing', () => {
		const records = [{ dedupeKey: 'a' }, { dedupeKey: 'b' }, { dedupeKey: 'a' }];
		const { fresh, existing, duplicates } = partitionByKey(records, new Set(['b']));
		assert.deepStrictEqual(fresh.map((r) => r.dedupeKey), ['a']);
		assert.deepStrictEqual(existing.map((r) => r.dedupeKey), ['b']);
		assert.strictEqual(duplicates, 1, 'repeat within one run signals pagination drift');
	});

	describe('diffStatus', () => {
		const base = {
			kind: KIND.PERMIT,
			dedupeKey: 'k',
			stage: 'בתהליך היתר',
			stageOrder: 0,
			requestStage: '1',
			progress: 7,
			permitNumber: null,
			permitGrantedAt: null,
			constructionStartedAt: null,
		};

		it('reports nothing when there is no stored version', () => {
			assert.deepStrictEqual(diffStatus(base, null), []);
		});

		it('reports nothing when nothing tracked changed', () => {
			assert.deepStrictEqual(diffStatus(base, { ...base }), []);
		});

		it('flags forward movement along the ladder as advanced', () => {
			const now = { ...base, stage: 'קיים היתר', stageOrder: 1 };
			const [change] = diffStatus(now, base);
			assert.strictEqual(change.field, 'stage');
			assert.strictEqual(change.to, 'קיים היתר');
			assert.strictEqual(change.advanced, true);
		});

		it('does not flag backward movement as advanced', () => {
			const before = { ...base, stage: 'בבניה', stageOrder: 2 };
			const now = { ...base, stage: 'קיים היתר', stageOrder: 1 };
			const [change] = diffStatus(now, before);
			assert.strictEqual(change.advanced, false);
		});

		it('treats a newly appearing date as advancement', () => {
			const now = { ...base, constructionStartedAt: '2026-02-16T00:00:00.000Z' };
			const change = diffStatus(now, base).find((c) => c.field === 'constructionStartedAt');
			assert.ok(change);
			assert.strictEqual(change.advanced, true);
		});

		it('treats null and empty string as the same value', () => {
			const now = { ...base, requestStage: '' };
			const stored = { ...base, requestStage: null };
			assert.deepStrictEqual(diffStatus(now, stored), []);
		});

		it('tracks the site fields for site records', () => {
			const site = { kind: KIND.SITE, dedupeKey: 's', supervisionStatus: 'גמר יסודות', buildStage: 'גמר יסודות', buildStageOrder: 5, worksApprovedAt: null };
			const stored = { ...site, supervisionStatus: 'תחילת עבודות', buildStage: 'תחילת עבודות', buildStageOrder: 3 };
			const fields = diffStatus(site, stored).map((c) => c.field).sort();
			assert.deepStrictEqual(fields, ['buildStage', 'supervisionStatus']);
		});
	});
});
