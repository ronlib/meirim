const controller = require('../controller/cron');
const crawlCadence = require('./crawlCadence');
const Log = require('./log');
const { report } = require('../../metrics');

const runMavatSearchCrawl = async () => {
	const STARTED_AT = Date.now();
	Log.info('[run_mavat_search] phase=crawl starting mavatSearch crawl');

	const config = crawlCadence.getCrawlConfig();
	Log.info(`[run_mavat_search] Crawl config: bufferDays=${config.bufferDays}, backfillSchedule=${config.backfillSchedule}, incrementalSchedule=${config.incrementalSchedule}`);

	const dateLastStatusDate = await crawlCadence.calculateDateLastStatusDate(config.bufferDays);
	Log.info(`[run_mavat_search] Mode: ${dateLastStatusDate === null ? 'BACKFILL (all plans)' : 'INCREMENTAL (since ' + dateLastStatusDate + ')'}`);

	const result = await controller.mavatSearch(dateLastStatusDate);
	if (result && result.errors === 0) {
		await crawlCadence.setLastSuccessfulCrawlDate();
	} else {
		Log.warn(`[run_mavat_search] last crawl date was NOT updated due to errors: ${result && result.errors}`);
	}
	const crawlElapsed = ((Date.now() - STARTED_AT) / 1000).toFixed(1);
	Log.info(`[run_mavat_search] phase=crawl mavatSearch completed in ${crawlElapsed}s: ${JSON.stringify(result)}`);

	// Geometry backfill runs UNCONDITIONALLY after the crawl (not gated on errors===0 or
	// counts.new > 0) so missing/placeholder geometry self-heals over time even when this
	// crawl had per-record errors or found nothing new. fetchIplanGeometry never throws
	// (it catches/logs internally and returns 0), but wrap defensively so a thrown
	// backfill can NEVER fail the overall crawl run or roll back the cadence update.
	try {
		const backfillStart = Date.now();
		Log.info('[run_mavat_search] phase=geometry-backfill starting');
		const backfilledCount = await controller.fetchIplanGeometry();
		const backfillElapsed = ((Date.now() - backfillStart) / 1000).toFixed(1);
		Log.info(`[run_mavat_search] phase=geometry-backfill updated=${backfilledCount} plans in ${backfillElapsed}s`);
		report({ metricName: 'fetchIplanGeometry', value: backfilledCount });
	} catch (e) {
		Log.error('[run_mavat_search] phase=geometry-backfill failed', e);
		report({ metricName: 'fetchIplanGeometry', value: 0, attributes: { result: 'failed' } });
	}
};

module.exports = { runMavatSearchCrawl };