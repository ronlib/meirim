const puppeteer = require('puppeteer');
const Bluebird = require('bluebird');
const Log = require('../../lib/log');

const SV3_SEARCH_URL = 'https://mavat.iplan.gov.il/rest/api/sv3/Search';
const SV3_PAGE_URL = 'https://mavat.iplan.gov.il/SV3';
const PAGE_SIZE = 20;
const TOKEN_REFRESH_INTERVAL = 5;

let browser = null;
let page = null;
let currentStrategy = null;

const initBrowser = async () => {
	if (!browser) {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		});
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

		const responsePromise = p.waitForResponse(
			resp => resp.url().includes('rest/api/sv3/Search'),
			{ timeout: 20000 }
		);

		await p.goto(`${SV3_PAGE_URL}?${queryParams.toString()}`, {
			waitUntil: 'networkidle0',
			timeout: 15000
		});

		const response = await responsePromise;
		const data = await response.json();

		await p.close();
		currentStrategy = 'A';
		return data;
	} catch (e) {
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
			throw new Error('Failed to get reCAPTCHA token');
		}

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

		await p.close();
		currentStrategy = 'B';
		return response;
	} catch (e) {
		await p.close().catch(() => {});
		throw e;
	}
};

const strategyC = async (payload) => {
	Log.info('[searchApi] Strategy C: SV4/1 per-plan navigation fallback');
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

		await p.close();
		currentStrategy = 'C';
		return response;
	} catch (e) {
		await p.close().catch(() => {});
		throw e;
	}
};

const executeSearch = async (payload) => {
	const strategies = [strategyA, strategyB, strategyC];
	let lastError = null;

	for (const strategy of strategies) {
		try {
			const result = await strategy(payload);
			if (result && result[0] && result[0].result) {
				return result;
			}
			lastError = new Error('Strategy returned no results');
		} catch (e) {
			lastError = e;
			Log.warn(`[searchApi] Strategy failed: ${e.message}`);
		}
	}

	throw lastError || new Error('All search strategies exhausted');
};

const searchPlans = async (params) => {
	Log.info('[searchApi] searchPlans called', { params });
	const payload = buildSearchPayload(params);
	const data = await executeSearch(payload);
	const result = data[0]?.result;
	return {
		records: result?.dtResults || [],
		totalRecords: result?.intRecordsCount || 0,
		totalPages: result?.totalPages || 0,
		strategy: currentStrategy
	};
};

async function* paginateAllPlans(dateLastStatusDate) {
	let pageNum = 1;
	let totalFetched = 0;
	let totalRecords = Infinity;
	let tokenRefreshCounter = 0;

	while (totalFetched < totalRecords) {
		const fromResult = (pageNum - 1) * PAGE_SIZE + 1;
		const toResult = Math.min(pageNum * PAGE_SIZE, totalRecords);

		tokenRefreshCounter++;
		if (tokenRefreshCounter > TOKEN_REFRESH_INTERVAL) {
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
		}

		Log.info(`[searchApi] Page ${pageNum}: fetched ${result.records.length} records (total: ${totalFetched + result.records.length}/${totalRecords}), strategy: ${result.strategy}`);

		yield {
			records: result.records,
			page: pageNum,
			totalRecords,
			totalPages: result.totalPages,
			strategy: result.strategy
		};

		totalFetched += result.records.length;
		pageNum++;

		if (result.records.length === 0) break;
	}
}

module.exports = {
	searchPlans,
	paginateAllPlans,
};
