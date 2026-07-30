/**
 * Default implementations of the injected dependencies, so the scraper is
 * runnable with nothing but Node - no database, no host config.
 *
 * A host application (Meirim, or whatever replaces it) supplies its own `store`
 * and typically its own `log`; `http` is usually fine as is.
 */

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JSON fetcher with timeout and bounded exponential-backoff retry.
 * Uses global fetch (Node 18+), so there is no runtime dependency.
 *
 * Retries only transient failures: network errors, timeouts, 429 and 5xx. A 4xx
 * other than 429 means our request is wrong and retrying cannot help.
 */
function createHttp({ timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, log } = {}) {
	return async function http(url) {
		let lastError;

		for (let attempt = 0; attempt <= retries; attempt += 1) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetch(url, {
					signal: controller.signal,
					headers: { Accept: 'application/json' },
				});

				if (!response.ok) {
					const retryable = response.status === 429 || response.status >= 500;
					const error = new Error(`HTTP ${response.status} for ${url}`);
					if (!retryable) throw error;
					lastError = error;
				} else {
					return await response.json();
				}
			} catch (error) {
				// A non-retryable HTTP error must not be swallowed by the retry loop.
				if (/^HTTP (4\d\d)/.test(error.message) && !error.message.startsWith('HTTP 429')) throw error;
				lastError = error;
			} finally {
				clearTimeout(timer);
			}

			if (attempt < retries) {
				const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
				if (log) log.warn(`request failed (${lastError.message}); retrying in ${delay}ms`);
				await sleep(delay);
			}
		}

		throw lastError;
	};
}

/** Console logger. `debug` is silent unless BUILDING_PERMITS_DEBUG is set. */
function createLog({ debug = Boolean(process.env.BUILDING_PERMITS_DEBUG), prefix = '[building-permits]' } = {}) {
	const emit = (stream, level, args) => stream(`${prefix} ${level}`, ...args);
	return {
		debug: (...args) => (debug ? emit(console.log, 'debug', args) : undefined),
		info: (...args) => emit(console.log, 'info', args),
		warn: (...args) => emit(console.warn, 'warn', args),
		error: (...args) => emit(console.error, 'error', args),
	};
}

/** Discards everything. For tests and dry runs. */
function createSilentLog() {
	const noop = () => {};
	return { debug: noop, info: noop, warn: noop, error: noop };
}

/**
 * In-memory store. Keeps records in a Map so status diffing works within a
 * process, and exposes the collected records for a CLI to serialize.
 *
 * Seed it with previously exported records to diff across separate runs
 * without a database - which is how the CLI's --state flag works.
 */
function createMemoryStore({ seed = [] } = {}) {
	const records = new Map();
	const changes = [];

	for (const record of seed) {
		if (record && record.dedupeKey) records.set(record.dedupeKey, record);
	}

	return {
		async loadKnown() {
			return records;
		},
		async save(record) {
			records.set(record.dedupeKey, record);
		},
		async update(record) {
			records.set(record.dedupeKey, record);
		},
		async recordChange(change) {
			// Omit the embedded record to keep exported change logs readable.
			const rest = { ...change };
			delete rest.record;
			changes.push(rest);
		},
		// Not part of the store contract; used by the CLI to write results out.
		all() {
			return [...records.values()];
		},
		changeLog() {
			return changes;
		},
	};
}

module.exports = {
	createHttp,
	createLog,
	createSilentLog,
	createMemoryStore,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_RETRIES,
};
