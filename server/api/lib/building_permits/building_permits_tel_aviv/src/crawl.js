/**
 * The orchestrator. Takes all side effects as injected dependencies so this
 * module - and everything it imports - stays free of any host application's
 * database, config and logging.
 *
 * Dependency contract:
 *   http(url)                  -> Promise<Object>   parsed JSON body
 *   log.{debug,info,warn,error}(msg)
 *   store.loadKnown(sourceName) -> Promise<Map<string, Object>|Set<string>>
 *                                  stored records (or bare keys) by dedupe key
 *   store.save(record)          -> Promise<void>
 *   store.update(record, changes) -> Promise<void>   optional; falls back to save
 *   store.recordChange(change)  -> Promise<void>     optional
 *
 * Defaults for all of these live in defaults.js, so the scraper runs standalone
 * with no database at all.
 */

const { partitionByKey, diffStatus } = require('./dedupe');
const { STAGE_PERMIT_GRANTED, KIND } = require('./schema');

/**
 * Is this change the "construction is imminent nearby" signal?
 *
 * Two triggers, both meaningful for notifying residents in advance:
 *   - a permit advancing to קיים היתר (granted; work can begin)
 *   - a construction-start date appearing
 * Deliberately narrow: a permit that has existed for years and only now flips
 * to granted is exactly the case a new-rows-only crawler would miss.
 */
function isImminentConstruction(change) {
	if (change.kind !== KIND.PERMIT) return false;
	if (change.field === 'stage') return change.advanced && change.to === STAGE_PERMIT_GRANTED;
	if (change.field === 'constructionStartedAt') return change.advanced;
	return false;
}

/**
 * Runs one or more sources end to end.
 *
 * @param {Object} deps  {http, log, store}
 * @param {Object} options
 * @param {Array<Object>} options.sources    source modules to run
 * @param {number} [options.year]            filter (permits source only)
 * @param {string} [options.since]           YYYY-MM-DD activity filter
 * @param {Object} [options.area]            spatial filter; see arcgis.spatialParams
 * @param {number} [options.maxFeatures]     cap fetched features per source
 * @param {number} [options.pageSize]
 * @param {boolean} [options.validate=true]  verify upstream fields before crawling
 * @param {boolean} [options.dryRun=false]   never call store.save/update
 * @returns {Promise<Object>} summary report
 */
async function crawl(deps, options) {
	const { http, log, store } = deps;
	const {
		sources,
		year,
		since,
		area,
		maxFeatures,
		pageSize,
		validate = true,
		dryRun = false,
	} = options;

	if (!sources || !sources.length) throw new Error('crawl: no sources given');

	const report = {
		startedAt: null, // stamped by the caller; this module stays time-free for testability
		sources: [],
		totals: { fetched: 0, saved: 0, updated: 0, changes: 0, imminent: 0, duplicates: 0, failures: 0 },
		imminentChanges: [],
	};

	for (const source of sources) {
		const summary = {
			source: source.name,
			kind: source.kind,
			fetched: 0,
			saved: 0,
			updated: 0,
			changes: 0,
			imminent: 0,
			duplicates: 0,
			errors: [],
		};

		try {
			if (validate && source.validate) {
				const missing = await source.validate({ http });
				if (missing.length) {
					throw new Error(
						`upstream layer ${source.layerId} is missing expected fields: ${missing.join(', ')}. ` +
						'The source schema changed - update sources/ and normalize.js before trusting a crawl.'
					);
				}
			}

			const known = await store.loadKnown(source.name);
			const knownIsMap = known instanceof Map;

			// Fetch fully before writing: the partition/diff step needs to know
			// what arrived in this run to detect intra-run duplicate keys.
			const records = [];
			for await (const record of source.fetch({ http, log }, { year, since, area, maxFeatures, pageSize })) {
				records.push(record);
			}
			summary.fetched = records.length;
			log.info(`${source.name}: fetched ${records.length} records`);

			const { fresh, existing, duplicates } = partitionByKey(records, known);
			summary.duplicates = duplicates;

			for (const record of fresh) {
				if (!dryRun) await store.save(record);
				summary.saved += 1;
			}

			for (const record of existing) {
				const stored = knownIsMap ? known.get(record.dedupeKey) : null;
				const changes = stored ? diffStatus(record, stored) : [];

				if (changes.length) {
					summary.changes += changes.length;
					for (const change of changes) {
						if (!dryRun && store.recordChange) await store.recordChange(change);
						if (isImminentConstruction(change)) {
							summary.imminent += 1;
							report.imminentChanges.push(change);
						}
					}
				}

				// Refresh the stored row whenever anything changed, so geometry and
				// the long free-text fields stay current even without a tracked change.
				if (!dryRun && (changes.length || !knownIsMap)) {
					if (store.update) await store.update(record, changes);
					else await store.save(record);
					summary.updated += 1;
				}
			}

			log.info(
				`${source.name}: ${summary.saved} new, ${summary.updated} updated, ` +
				`${summary.changes} status changes, ${summary.imminent} imminent-construction alerts`
			);
		} catch (error) {
			summary.errors.push(error.message || String(error));
			report.totals.failures += 1;
			log.error(`${source.name} failed: ${error.message || error}`);
		}

		report.sources.push(summary);
		for (const key of ['fetched', 'saved', 'updated', 'changes', 'imminent', 'duplicates']) {
			report.totals[key] += summary[key];
		}
	}

	return report;
}

module.exports = { crawl, isImminentConstruction };
