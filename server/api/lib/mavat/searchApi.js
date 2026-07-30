const puppeteer = require('puppeteer');
const fs = require('fs');
const Bluebird = require('bluebird');
const Log = require('../../lib/log');

process.on('unhandledRejection', (reason) => {
	Log.warn('[searchApi] Suppressed unhandled rejection', { error: reason?.message });
});

const SV3_SEARCH_URL = 'https://mavat.iplan.gov.il/rest/api/sv3/Search';
const SV3_PAGE_URL = 'https://mavat.iplan.gov.il/SV3';
const PAGE_SIZE = 20;
const TOKEN_REFRESH_INTERVAL = 5;

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const PUPPETEER_LAUNCH_OPTS = {
	headless: true,
	args: ['--no-sandbox', '--disable-setuid-sandbox'],
	...(fs.existsSync(CHROMIUM_PATH) ? { executablePath: CHROMIUM_PATH } : {}),
};

let browser = null;
let page = null;
let currentStrategy = null;

const initBrowser = async () => {
	if (!browser) {
		Log.info('[searchApi] Launching chrome', { executablePath: PUPPETEER_LAUNCH_OPTS.executablePath || 'bundled' });
		browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTS);
	}
	return browser;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const buildSearchPayload = (params) => {
	const payload = {
		searchEntity: 1,
		searchType: 1,
		searchMethod: params.searchMethod || 2
	};
	if (params.plNumber) {
		payload.plNumber = params.plNumber;
	}
	if (params.dateLastStatusDate) {
		payload.dateLastStatusDate = params.dateLastStatusDate;
	}
	if (params.fromResult !== undefined) {
		payload.fromResult = params.fromResult;
	}
	if (params.toResult !== undefined) {
		payload.toResult = params.toResult;
	}
	if (params._page !== undefined) {
		payload._page = params._page;
	}
	Log.info(`[searchApi] Built search payload`, payload);
	return payload;
};

const strategyA = async (payload) => {
	Log.info('[searchApi] Strategy A: page navigation with response intercept');
	const b = await initBrowser();
	const p = await b.newPage();

	try {
		const queryParams = new URLSearchParams();
		queryParams.set('searchEntity', payload.searchEntity);
		queryParams.set('searchType', payload.searchType);
		if (payload.dateLastStatusDate) {
			queryParams.set('dateLastStatusDate', payload.dateLastStatusDate);
		}
		if (payload.plNumber) {
			queryParams.set('plNumber', payload.plNumber);
		}

		const url = `${SV3_PAGE_URL}?${queryParams.toString()}`;
		Log.info(`[searchApi] Strategy A: navigating to ${url}`);

		const responsePromise = p.waitForResponse(
			resp => resp.url().includes('rest/api/sv3/Search'),
			{ timeout: 20000 }
		);

		await p.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

		const response = await responsePromise;
		const data = await response.json();

		const recordsCount = data?.[0]?.result?.dtResults?.length || 0;
		const totalRecords = data?.[0]?.result?.intRecordsCount || 0;
		Log.info(`[searchApi] Strategy A succeeded: ${recordsCount} records (total: ${totalRecords})`);

		await p.close();
		currentStrategy = 'A';
		return data;
	} catch (e) {
		Log.warn(`[searchApi] Strategy A failed: ${e.message}`);
		await p.close().catch(() => {});
		throw e;
	}
};

const strategyB = async (payload) => {
	Log.info('[searchApi] Strategy B: grecaptcha.execute() with direct API call');
	const b = await initBrowser();
	const p = await b.newPage();

	try {
		await p.goto('https://mavat.iplan.gov.il', {
			waitUntil: 'networkidle0',
			timeout: 15000
		});
		await sleep(2000);

		const token = await p.evaluate(() => {
			return new Promise((resolve) => {
				if (typeof grecaptcha === 'undefined') {
					resolve(null);
					return;
				}
				grecaptcha.ready(() => {
					grecaptcha.execute('6LfTzdkUAAAAAH2mPpGQIdt1q-p8QENhwAMsWCMR', { action: 'submit' })
						.then(resolve)
						.catch(() => resolve(null));
				});
			});
		});

		if (!token) {
			Log.warn('[searchApi] Strategy B: failed to get reCAPTCHA token (grecaptcha undefined or execute rejected)');
			throw new Error('Failed to get reCAPTCHA token');
		}
		Log.info('[searchApi] Strategy B: reCAPTCHA token obtained, calling SV3 API');

		const response = await p.evaluate(async (pl, tk) => {
			const resp = await fetch(SV3_SEARCH_URL, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
					'g-recaptcha-response': tk
				},
				body: JSON.stringify(pl)
			});
			return resp.json();
		}, payload, token);

		const recordsCount = response?.[0]?.result?.dtResults?.length || 0;
		const totalRecords = response?.[0]?.result?.intRecordsCount || 0;
		Log.info(`[searchApi] Strategy B succeeded: ${recordsCount} records (total: ${totalRecords})`);

		await p.close();
		currentStrategy = 'B';
		return response;
	} catch (e) {
		Log.warn(`[searchApi] Strategy B failed: ${e.message}`);
		await p.close().catch(() => {});
		throw e;
	}
};

const strategyC = async (payload) => {
	Log.info(`[searchApi] Strategy C: SV4/1 per-plan navigation fallback for plNumber=${payload.plNumber}`);
	if (!payload.plNumber) {
		throw new Error('Strategy C requires a specific plNumber');
	}

	const b = await initBrowser();
	const p = await b.newPage();

	try {
		const searchPayload = buildSearchPayload({
			plNumber: payload.plNumber,
			searchMethod: 2
		});

		Log.info(`[searchApi] Strategy C: calling SV3 API for ${payload.plNumber}`);
		const response = await p.evaluate(async (pl) => {
			const resp = await fetch(SV3_SEARCH_URL, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				body: JSON.stringify(pl)
			});
			return resp.json();
		}, searchPayload);

		const recordsCount = response?.[0]?.result?.dtResults?.length || 0;
		Log.info(`[searchApi] Strategy C succeeded for ${payload.plNumber}: ${recordsCount} records`);

		await p.close();
		currentStrategy = 'C';
		return response;
	} catch (e) {
		Log.warn(`[searchApi] Strategy C failed for ${payload.plNumber}: ${e.message}`);
		await p.close().catch(() => {});
		throw e;
	}
};

const executeSearch = async (payload) => {
	const STARTED_AT = Date.now();
	const strategyNames = ['A (page nav)', 'B (recaptcha token)', 'C (per-plan fallback)'];
	const strategies = [strategyA, strategyB, strategyC];
	let lastError = null;

	for (let i = 0; i < strategies.length; i++) {
		const strategyLabel = strategyNames[i];
		const t0 = Date.now();
		try {
			const result = await strategies[i](payload);
			if (result && result[0] && result[0].result) {
				const elapsed = Date.now() - t0;
				Log.info(`[searchApi] Strategy ${strategyLabel} succeeded in ${elapsed}ms, total records: ${result[0].result.intRecordsCount}`);
				return result;
			}
			lastError = new Error(`Strategy ${strategyLabel} returned no results`);
			Log.warn(`[searchApi] Strategy ${strategyLabel} returned no results (${Date.now() - t0}ms)`);
		} catch (e) {
			lastError = e;
			Log.warn(`[searchApi] Strategy ${strategyLabel} failed after ${Date.now() - t0}ms: ${e.message}`);
		}
	}

	Log.error(`[searchApi] All ${strategies.length} search strategies exhausted after ${Date.now() - STARTED_AT}ms`);
	throw lastError || new Error('All search strategies exhausted');
};

const searchPlans = async (params) => {
	Log.info('[searchApi] searchPlans called', { params });
	const payload = buildSearchPayload(params);
	const data = await executeSearch(payload);
	const result = data[0]?.result;
	const records = result?.dtResults || [];
	const totalRecords = result?.intRecordsCount || 0;
	const totalPages = result?.totalPages || 0;

	const latestUpdate = records.length > 0
		? records.reduce((latest, r) => !latest || r.UPDATE_DATE > latest ? r.UPDATE_DATE : latest, null)
		: null;

	Log.info(`[searchApi] searchPlans result: ${records.length} records returned, total: ${totalRecords}, pages: ${totalPages}, strategy: ${currentStrategy}, latest UPDATE_DATE: ${latestUpdate}`);

	return {
		records,
		totalRecords,
		totalPages,
		strategy: currentStrategy,
		latestUpdateDate: latestUpdate,
	};
};

async function* paginateAllPlans(dateLastStatusDate) {
	const STARTED_AT = Date.now();
	let pageNum = 1;
	let totalFetched = 0;
	let totalRecords = Infinity;
	let tokenRefreshCounter = 0;
	let latestUpdateDate = null;

	Log.info(`[searchApi] paginateAllPlans starting — dateLastStatusDate=${dateLastStatusDate}, pageSize=${PAGE_SIZE}`);

	while (totalFetched < totalRecords) {
		const fromResult = (pageNum - 1) * PAGE_SIZE + 1;
		const toResult = Math.min(pageNum * PAGE_SIZE, totalRecords);

		tokenRefreshCounter++;
		if (tokenRefreshCounter > TOKEN_REFRESH_INTERVAL) {
			Log.info(`[searchApi] Token refresh triggered after ${TOKEN_REFRESH_INTERVAL} pages, closing browser page`);
			tokenRefreshCounter = 1;
			if (page) {
				await page.close().catch(() => {});
				page = null;
			}
		}

		const result = await searchPlans({
			dateLastStatusDate,
			fromResult,
			toResult,
			_page: pageNum
		});

		if (pageNum === 1) {
			totalRecords = result.totalRecords;
			Log.info(`[searchApi] First page complete — total records to fetch: ${totalRecords}, total pages: ${result.totalPages}`);
		}

		if (result.latestUpdateDate && (!latestUpdateDate || result.latestUpdateDate > latestUpdateDate)) {
			latestUpdateDate = result.latestUpdateDate;
		}

		Log.info(`[searchApi] Page ${pageNum}/${result.totalPages}: fetched ${result.records.length} records (running total: ${totalFetched + result.records.length}/${totalRecords}), strategy: ${result.strategy}`);

		yield {
			records: result.records,
			page: pageNum,
			totalRecords,
			totalPages: result.totalPages,
			strategy: result.strategy
		};

		totalFetched += result.records.length;
		pageNum++;

		if (result.records.length === 0) {
			Log.info(`[searchApi] Page ${pageNum - 1} returned 0 records — stopping early (fetched ${totalFetched}/${totalRecords})`);
			break;
		}
	}

	const elapsed = ((Date.now() - STARTED_AT) / 1000).toFixed(1);
	Log.info(`[searchApi] paginateAllPlans complete — ${pageNum - 1} pages, ${totalFetched} records fetched in ${elapsed}s, latest UPDATE_DATE: ${latestUpdateDate}`);
}

module.exports = {
	searchPlans,
	paginateAllPlans,
};
