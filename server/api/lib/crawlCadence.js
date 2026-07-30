const moment = require('moment');
const Log = require('./log');

const BACKFILL_BUFFER_KEY = 'crawl:backfill_complete';
const LAST_CRAWL_KEY = 'crawl:last_crawl_date';

const DEFAULT_BUFFER_DAYS = 7;

const getLastCrawlDate = async () => {
	const { Knex } = require('../service/database');
	try {
		const row = await Knex('plan').max('UPDATE_DATE as max_update').first();
		return row?.max_update || null;
	} catch (e) {
		Log.warn('[crawlCadence] Could not determine last crawl date', e.message);
		return null;
	}
};

const isBackfillComplete = async () => {
	const { Knex } = require('../service/database');
	try {
		const count = await Knex('plan').count('id as cnt').first();
		return (count?.cnt || 0) > 0;
	} catch (e) {
		return false;
	}
};

const calculateDateLastStatusDate = async (bufferDays) => {
	const buf = bufferDays || DEFAULT_BUFFER_DAYS;
	const backfillDone = await isBackfillComplete();

	if (!backfillDone) {
		Log.info('[crawlCadence] Backfill not yet complete — will fetch all plans');
		return null;
	}

	const lastDate = await getLastCrawlDate();
	if (!lastDate) {
		Log.info('[crawlCadence] No previous crawl date found — fetching all plans');
		return null;
	}

	const bufferDate = moment(lastDate).subtract(buf, 'days').format('YYYY-MM-DD');
	Log.info(`[crawlCadence] Incremental crawl: dateLastStatusDate=${bufferDate} (last: ${lastDate}, buffer: ${buf}d)`);
	return bufferDate;
};

const getCrawlConfig = () => {
	const Config = require('./config');
	const schedule = Config.get('services.schedule') || {};
	return {
		bufferDays: Config.get('crawl.bufferDays') || DEFAULT_BUFFER_DAYS,
		backfillSchedule: schedule.backfillCrawl || '0 0 2 * * 0',
		incrementalSchedule: schedule.incrementalCrawl || '0 */6 * * *',
	};
};

module.exports = {
	calculateDateLastStatusDate,
	isBackfillComplete,
	getLastCrawlDate,
	getCrawlConfig,
	DEFAULT_BUFFER_DAYS,
};
