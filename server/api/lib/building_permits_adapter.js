'use strict';

const { KIND, TRACKED_FIELDS } = require('./building_permits/building_permits_tel_aviv');
const { Knex } = require('../service/database');

const PERMIT_TYPE_MARKER = 'היתר בניה';

function formatDate(isoString) {
	if (!isoString) return '';
	const d = new Date(isoString);
	return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function buildSummary(record) {
	const parts = [];
	if (record.stage) parts.push(`שלב: ${record.stage}`);
	if (record.requestType) parts.push(`סוג: ${record.requestType}`);
	if (record.housingUnits) parts.push(`יחידות דיור: ${record.housingUnits}`);
	if (record.permitGrantedAt) parts.push(`תאריך היתר: ${formatDate(record.permitGrantedAt)}`);
	if (record.constructionStartedAt) parts.push(`תחילת בנייה: ${formatDate(record.constructionStartedAt)}`);
	if (record.tama38 && record.tama38.applies) parts.push('תמ"א 38');
	return parts.join('\n') || '';
}

/**
 * Builds the `data` JSON blob stored in the plan table's `data` column.
 * Contains plan-compatible keys the frontend already reads, plus all
 * canonical permit fields for the adapter to reconstruct on loadKnown.
 */
function buildDataBlob(record) {
	const blob = {
		ENTITY_SUBTYPE_DESC: record.requestType || '',
		PL_NUMBER: record.dedupeKey,
		STATION_DESC: record.stage || '',
		LAST_UPDATE: record.importedAt,
		QUANTITY_DELTA_120: record.housingUnits || 0,
	};
	for (const [key, value] of Object.entries(record)) {
		if (key === 'geometry') continue;
		if (blob[key] === undefined) blob[key] = value;
	}
	return blob;
}

function recordToRow(record) {
	return {
		OBJECTID: parseInt(record.sourceId, 10) || 0,
		PL_NUMBER: record.dedupeKey,
		PL_NAME: record.address || record.title || '',
		plan_display_name: record.address || record.title || '',
		PLAN_COUNTY_NAME: record.cityName || '',
		PLAN_CHARACTOR_NAME: PERMIT_TYPE_MARKER,
		status: record.stage || '',
		goals_from_mavat: record.requestType || '',
		main_details_from_mavat: buildSummary(record),
		plan_url: record.documentUrl || record.archiveUrl || null,
		sent: 2,
		geo_search_filter: false,
		data: buildDataBlob(record),
	};
}

/**
 * Creates a store adapter that maps building-permit canonical records into
 * the existing `plan` table. This is the ONLY place where canonical field
 * names meet DB column names.
 *
 * @param {Object} Plan     Bookshelf Plan model (used for update path only)
 * @param {Object} log      logger with .info/.warn/.error
 * @param {Map}    sourcesByName  source registry keyed by source name
 */
module.exports = function createStore(Plan, log, sourcesByName) {
	return {
		async loadKnown(sourceName) {
			const source = sourcesByName ? sourcesByName.get(sourceName) : null;

			const rows = await Knex('plan')
				.select('PL_NUMBER', 'data')
				.where('PLAN_CHARACTOR_NAME', PERMIT_TYPE_MARKER);

			const known = new Map();
			for (const row of rows) {
				const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
				if (source && data.city && data.city !== source.city) continue;

				const tracked = {};
				const fields = TRACKED_FIELDS[data.kind || KIND.PERMIT] || [];
				for (const field of fields) {
					tracked[field] = data[field] !== undefined ? data[field] : null;
				}
				tracked.stageOrder = data.stageOrder !== undefined ? data.stageOrder : null;
				tracked.buildStageOrder = data.buildStageOrder !== undefined ? data.buildStageOrder : null;

				known.set(row.PL_NUMBER, tracked);
			}
			return known;
		},

		async save(record) {
			if (!record || !record.geometry) {
				log.warn(`skipping record without geometry: ${record && record.dedupeKey}`);
				return;
			}

			const row = recordToRow(record);
			row.geom = record.geometry;
			const plan = Plan.forge(row);
			await plan.save(null, { method: 'insert' });
		},

		async update(record, changes) {
			if (!record || !record.geometry) return;

			const existing = await Plan.forge({ PL_NUMBER: record.dedupeKey }).fetch();
			if (!existing) {
				return this.save(record);
			}

			const row = recordToRow(record);
			row.geom = record.geometry;
			existing.set(row);
			await existing.save();
		},

		async recordChange(change) {
			log.info(
				`status change: ${change.dedupeKey} ` +
				`${change.field}: ${change.from} → ${change.to}` +
				(change.advanced ? ' (advanced)' : '')
			);
		},
	};
};

module.exports.PERMIT_TYPE_MARKER = PERMIT_TYPE_MARKER;
