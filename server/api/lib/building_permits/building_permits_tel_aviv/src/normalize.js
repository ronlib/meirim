/**
 * Maps raw ArcGIS GeoJSON features onto the canonical shapes in schema.js.
 *
 * Rule: every raw attribute is preserved under `sourceFields`, verbatim. Typed
 * top-level fields exist for what we filter, alert and join on; anything not
 * yet understood stays available for later analysis without a re-crawl.
 */

const { KIND, PERMIT_STAGES, SITE_STAGES } = require('./schema');
const { esriDateToIso, importStampToIso } = require('./arcgis');
const { permitKey, permitGroupKey, siteKey, siteGroupKey, DEFAULT_CITY } = require('./dedupe');

/** Trims strings, converts '' and whitespace-only to null. */
function str(value) {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed === '' ? null : trimmed;
}

/** Integers where the source uses 0 as "absent" (permit/building numbers). */
function intOrNull(value, { zeroIsNull = false } = {}) {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	if (zeroIsNull && n === 0) return null;
	return n;
}

/** Source encodes booleans as the Hebrew words כן / לא. */
function hebrewBool(value) {
	const s = str(value);
	if (s === null) return null;
	if (s === 'כן') return true;
	if (s === 'לא') return false;
	return null;
}

/** Position on a lifecycle ladder, or null when the value is unrecognised. */
function stageOrder(ladder, value) {
	const idx = ladder.indexOf(value === null || value === undefined ? '' : String(value).trim());
	return idx === -1 ? null : idx;
}

/** tik_tipul_1..5 -> array of the non-empty ones. */
function trackingFiles(props) {
	return [1, 2, 3, 4, 5]
		.map((i) => str(props[`tik_tipul_${i}`]))
		.filter(Boolean);
}

/**
 * Normalizes one feature from a Tel Aviv-style permits layer.
 *
 * @param {Object} feature GeoJSON feature
 * @param {Object} [context] {city, cityName} - identifies the municipality so
 *        records from several cities can share one table without key collisions.
 * @returns {import('./schema').BuildingPermit|null} null when unusable
 */
function normalizePermit(feature, context = {}) {
	const props = (feature && feature.properties) || {};
	const sourceId = props.oid_permit;
	if (sourceId === null || sourceId === undefined) return null;

	const stage = str(props.building_stage);
	const city = context.city || DEFAULT_CITY;

	return {
		kind: KIND.PERMIT,
		city,
		cityName: context.cityName || null,
		sourceId: String(sourceId),
		dedupeKey: permitKey(props, city),
		// Shared by all polygons of one multi-parcel permit; group on this to
		// alert once per permit instead of once per parcel.
		groupKey: permitGroupKey(props, city),

		requestNumber: intOrNull(props.request_num),
		permitNumber: intOrNull(props.permission_num, { zeroIsNull: true }),
		title: str(props.koteret),

		stage,
		stageOrder: stageOrder(PERMIT_STAGES, stage),
		progress: intOrNull(props.progress),
		requestStage: str(props.request_stage),

		requestType: str(props.sug_bakasha),
		requestContent: str(props.tochen_bakasha),
		licensingTrack: str(props.maslul_rishuy),
		sourceClass: str(props.sivug_makor),

		address: str(props.addresses),
		buildingFileId: intOrNull(props.ms_tik_binyan, { zeroIsNull: true }),
		buildingCode: intOrNull(props.building_num, { zeroIsNull: true }),
		housingUnits: intOrNull(props.yechidot_diyur),
		trackingFiles: trackingFiles(props),

		tama38: {
			applies: hebrewBool(props.sw_tama_38),
			isNew: hebrewBool(props.sw_tama_38_chadash),
			isAddition: hebrewBool(props.sw_tama_38_tosefet),
		},

		relief: {
			areaAdditionPercent: str(props.hakala_tosefet_achuz_shetach),
			unitsIncreasePercent: str(props.hakala_yd_hagdala_achuz),
			unitsRequested: str(props.hakala_yd_mevukash),
			unitsAllowed: str(props.hakala_yd_mutar),
			text: str(props.hakala_melel),
			reasoning: str(props.hakala_nimuk),
		},

		// Real Esri date fields (epoch ms) - the embedded, retroactive timeline.
		requestOpenedAt: esriDateToIso(props.open_request),
		permitGrantedAt: esriDateToIso(props.permission_date),
		permitExpiresAt: esriDateToIso(props.expiry_date),
		constructionStartedAt: esriDateToIso(props.tr_hathalat_bniya),

		// Typed as String upstream despite the name; kept raw rather than guessed at.
		completedAt: str(props.finished),
		occupancyAt: str(props.occupation),

		documentUrl: str(props.url_hadmaya),
		completionCertificateNote: str(props.heara_teudat_gmar),
		classified: intOrNull(props.protected) === 1,

		importedAt: importStampToIso(props.date_import),
		geometry: (feature && feature.geometry) || null,
		sourceFields: props,
	};
}

/**
 * Normalizes one feature from a Tel Aviv-style construction-sites layer.
 *
 * @param {Object} feature GeoJSON feature
 * @param {Object} [context] {city, cityName}
 * @returns {import('./schema').ConstructionSite|null}
 */
function normalizeSite(feature, context = {}) {
	const props = (feature && feature.properties) || {};
	const sourceId = props.oid_site;
	if (sourceId === null || sourceId === undefined) return null;

	const buildStage = str(props.matzav_bniya);
	const city = context.city || DEFAULT_CITY;

	return {
		kind: KIND.SITE,
		city,
		cityName: context.cityName || null,
		sourceId: String(sourceId),
		dedupeKey: siteKey(props, city),
		// Shared by all polygons of one supervision file.
		groupKey: siteGroupKey(props, city),

		trackingFile: str(props.tik_tipul),
		permitsInFile: str(props.heterim),

		supervisionStatus: str(props.status_pikuach),
		supervisionStatusAt: esriDateToIso(props.tr_status_pikuach),
		buildStage,
		buildStageOrder: stageOrder(SITE_STAGES, buildStage),
		worksApprovedAt: esriDateToIso(props.tr_tchilat_avoda),

		landUse: str(props.shimush),
		permitHolders: str(props.baalei_heter),
		licensingTrack: str(props.sivug),
		requestType: str(props.sug_bakasha),
		requestContent: str(props.tochen_bakasha),

		address: str(props.ktovet),
		buildingFileId: intOrNull(props.ms_tik_binyan, { zeroIsNull: true }),
		blockParcel: str(props.gush_chelka),
		nightWorkPermit: str(props.ishurei_laila),
		archiveUrl: str(props.url_archion_tik),

		importedAt: importStampToIso(props.date_import),
		geometry: (feature && feature.geometry) || null,
		sourceFields: props,
	};
}

module.exports = {
	normalizePermit,
	normalizeSite,
	// exported for tests
	str,
	intOrNull,
	hebrewBool,
	stageOrder,
};
