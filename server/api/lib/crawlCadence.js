const moment = require('moment');
const Log = require('./log');

const BACKFILL_BUFFER_KEY = 'crawl:backfill_complete';
const LAST_CRAWL_KEY = 'crawl:last_crawl_date';

const DEFAULT_BUFFER_DAYS = 7;

const getLastCrawlDate = async () => {
	Log.info('[crawlCadence] Querying max UPDATE_DATE from plan table');
	const { Knex } = require('../service/database');
	try {
		const row = await Knex('plan').max('UPDATE_DATE as max_update').first();
		const maxUpdate = row?.max_update || null;
		Log.info(`[crawlCadence] Last crawl date from DB: ${maxUpdate || 'none'}`);
		return maxUpdate;
	} catch (e) {
		Log.warn(`[crawlCadence] Could not determine last crawl date: ${e.message}`, { stack: e.stack });
		return null;
	}
};

const isBackfillComplete = async () => {
	Log.info('[crawlCadence] Checking if backfill was previously completed');
	const { Knex } = require('../service/database');
	try {
		const count = await Knex('plan').count('id as cnt').first();
		const planCount = count?.cnt || 0;
		Log.info(`[crawlCadence] Existing plans in DB: ${planCount}`);
		return planCount > 0;
	} catch (e) {
		Log.warn(`[crawlCadence] isBackfillComplete query failed: ${e.message}`, { stack: e.stack });
		return false;
	}
};

const calculateDateLastStatusDate = async (bufferDays) => {
	const buf = bufferDays || DEFAULT_BUFFER_DAYS;
	Log.info(`[crawlCadence] calculateDateLastStatusDate called with bufferDays=${buf}`);
	const backfillDone = await isBackfillComplete();

	if (!backfillDone) {
		Log.info(`[crawlCadence] Mode: BACKFULL — no existing plans, will fetch all`);
		return null;
	}

	const lastDate = await getLastCrawlDate();
	if (!lastDate) {
		Log.info(`[crawlCadence] Mode: BACKFULL — lastDate is null, will fetch all`);
		return null;
	}

	const bufferDate = moment(lastDate, 'DD/MM/YYYY').subtract(buf, 'days').format('YYYY-MM-DD');
	Log.info(`[crawlCadence] Mode: INCREMENTAL — dateLastStatusDate=${bufferDate} (max in DB: ${lastDate}, buffer: ${buf}d)`);
	return bufferDate;
};

const getCrawlConfig = () => {
	const Config = require('./config');
	const schedule = Config.get('services.schedule') || {};
	const config = {
		bufferDays: Config.get('crawl.bufferDays') || DEFAULT_BUFFER_DAYS,
		backfillSchedule: schedule.backfillCrawl || '0 0 2 * * 0',
		incrementalSchedule: schedule.incrementalCrawl || '0 */6 * * *',
	};
	Log.info(`[crawlCadence] Crawl config loaded`, config);
	return config;
};

module.exports = {
	calculateDateLastStatusDate,
	isBackfillComplete,
	getLastCrawlDate,
	getCrawlConfig,
	DEFAULT_BUFFER_DAYS,
};
