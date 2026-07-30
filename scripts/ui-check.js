/*
 * Headless-browser UI error checker (raw Chrome DevTools Protocol, no puppeteer).
 *
 * Collects: uncaught exceptions, console errors/warnings, failed network
 * requests, HTTP >= 400 responses, plus a leaflet-specific DOM inspection.
 *
 * Usage
 * -----
 * In the container (preferred, see .opencode/skills/run-in-docker/SKILL.md):
 *   docker exec -w /app meirim-dev node scripts/ui-check.js [url]
 *
 * On the host (the 2GB Docker VM cannot fit chromium + webpack-dev-server at
 * the same time -- chromium gets webpack OOM-killed):
 *   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/ui-check.js [url]
 *
 * Why CDP instead of puppeteer: the repo's puppeteer is 22.x, whose bundled
 * @puppeteer/browsers pulls an old yargs that crashes on node >= 20 ESM
 * resolution. `ws` + CDP works on every node version we have.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const WebSocket = require(path.join(REPO, 'node_modules/ws'));

const URL_TO_CHECK = process.argv[2] || 'http://localhost:3000/plans/';
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';
const PORT = Number(process.env.CDP_PORT || 9333);
const SETTLE_MS = Number(process.env.UI_CHECK_WAIT || 15000);

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trunc = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s || '');

function getJSON(urlPath) {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
			let d = '';
			res.on('data', (c) => (d += c));
			res.on('end', () => {
				try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
			});
		}).on('error', reject);
	});
}

async function waitForDevTools(timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try { return await getJSON('/json/version'); } catch (e) { /* retry */ }
		if (Date.now() > deadline) throw new Error('Chrome DevTools endpoint never came up');
		await sleep(300);
	}
}

class CDP {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.handlers = [];
		ws.on('message', (raw) => {
			const msg = JSON.parse(raw.toString());
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
			} else if (msg.method) {
				this.handlers.forEach((h) => h(msg.method, msg.params));
			}
		});
	}

	on(fn) { this.handlers.push(fn); }

	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
			}, 60000);
		});
	}

	async evaluate(expression) {
		const r = await this.send('Runtime.evaluate', {
			expression: `(() => { ${expression} })()`,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
		return r.result.value;
	}
}

(async () => {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-check-'));
	log(`launching chrome: ${CHROME_PATH}`);
	const chrome = spawn(CHROME_PATH, [
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--no-sandbox',
		'--disable-setuid-sandbox',
		'--disable-dev-shm-usage',
		'--disable-gpu',
		'--disable-extensions',
		'--window-size=1440,1200',
		'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	chrome.stderr.on('data', () => {});

	const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} };
	process.on('exit', cleanup);

	const version = await waitForDevTools();
	log(`chrome up: ${version.Browser}`);

	// Open a fresh tab and attach
	const target = await getJSON(`/json/new?${encodeURIComponent('about:blank')}`).catch(() => null);
	const list = await getJSON('/json/list');
	const page = target || list.find((t) => t.type === 'page');
	const cdp = new CDP(await new Promise((resolve, reject) => {
		const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
		ws.on('open', () => resolve(ws));
		ws.on('error', reject);
	}));

	const consoleErrors = [];
	const consoleWarnings = [];
	const pageErrors = [];
	const failedRequests = [];
	const badResponses = [];
	const requests = new Map();
	const imageHosts = {};

	const fmtArgs = (args = []) => args.map((a) => {
		if (a.type === 'string') return a.value;
		if ('value' in a) return JSON.stringify(a.value);
		if (a.description) return a.description;
		return a.className || a.type;
	}).join(' ');

	cdp.on((method, p) => {
		switch (method) {
			case 'Runtime.exceptionThrown': {
				const d = p.exceptionDetails || {};
				const stack = (d.stackTrace && d.stackTrace.callFrames || [])
					.slice(0, 8)
					.map((f) => `      at ${f.functionName || '<anon>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
					.join('\n');
				pageErrors.push(`${(d.exception && (d.exception.description || d.exception.value)) || d.text}\n${stack}`);
				break;
			}
			case 'Runtime.consoleAPICalled': {
				const where = (p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0]) || {};
				const entry = {
					text: fmtArgs(p.args),
					where: where.url ? `${where.url}:${where.lineNumber + 1}:${where.columnNumber + 1}` : '',
				};
				if (p.type === 'error' || p.type === 'assert') consoleErrors.push(entry);
				else if (p.type === 'warning') consoleWarnings.push(entry);
				break;
			}
			case 'Log.entryAdded': {
				const e = p.entry || {};
				const entry = { text: `[${e.source}] ${e.text}`, where: e.url ? `${e.url}:${e.lineNumber || 0}` : '' };
				if (e.level === 'error') consoleErrors.push(entry);
				else if (e.level === 'warning') consoleWarnings.push(entry);
				break;
			}
			case 'Network.requestWillBeSent': {
				requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type });
				break;
			}
			case 'Network.responseReceived': {
				const r = requests.get(p.requestId) || {};
				r.type = p.type || r.type;
				if (p.type === 'Image') {
					let h = 'data:';
					if (!/^data:/.test(p.response.url)) { try { h = new URL(p.response.url).host; } catch (e) { h = '?'; } }
					imageHosts[h] = (imageHosts[h] || 0) + 1;
				}
				if (p.response.status >= 400) {
					badResponses.push({ status: p.response.status, url: p.response.url, type: p.type, requestId: p.requestId });
				}
				break;
			}
			case 'Network.loadingFailed': {
				const r = requests.get(p.requestId) || {};
				if (!p.canceled) failedRequests.push({ url: r.url || '?', method: r.method || '?', type: p.type || r.type, error: p.errorText });
				break;
			}
			default: break;
		}
	});

	await cdp.send('Runtime.enable');
	await cdp.send('Log.enable');
	await cdp.send('Network.enable');
	await cdp.send('Page.enable');
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

	console.log(`\n=== Loading ${URL_TO_CHECK} ===`);
	const nav = await cdp.send('Page.navigate', { url: URL_TO_CHECK });
	if (nav.errorText) log(`NAVIGATION ERROR: ${nav.errorText}`);
	log(`settling for ${SETTLE_MS}ms…`);
	await sleep(SETTLE_MS);
	log('inspecting DOM…');

	// Pull response bodies for the failures
	for (const r of badResponses) {
		try {
			const b = await cdp.send('Network.getResponseBody', { requestId: r.requestId });
			r.body = trunc((b.body || '').replace(/\s+/g, ' '), 300);
		} catch (e) { r.body = '(body unavailable)'; }
	}

	const maps = await cdp.evaluate(`
		const out = [];
		document.querySelectorAll('.leaflet-container').forEach((el, i) => {
			const r = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			const grab = (sel) => [...el.querySelectorAll(sel)].map((img) => ({
				src: (img.getAttribute('src') || '').slice(0, 120),
				complete: img.complete,
				naturalWidth: img.naturalWidth,
				cls: img.className,
			}));
			out.push({
				index: i,
				size: { w: Math.round(r.width), h: Math.round(r.height) },
				background: cs.backgroundColor,
				tilePaneLayers: el.querySelectorAll('.leaflet-tile-pane .leaflet-layer').length,
				tiles: grab('img.leaflet-tile'),
				nonTileImgs: grab('img:not(.leaflet-tile)'),
			});
		});
		return out;
	`).catch((e) => ({ error: e.message }));

	const snapshot = await cdp.evaluate(`
		const root = document.getElementById('root') || document.body;
		return {
			title: document.title,
			url: location.href,
			leafletContainers: document.querySelectorAll('.leaflet-container').length,
			brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
			totalImgs: document.images.length,
			textSample: (root.innerText || '').trim().slice(0, 300),
		};
	`).catch((e) => ({ error: e.message }));

	try {
		const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
		fs.writeFileSync(path.join(REPO, 'scripts/ui-check.png'), Buffer.from(shot.data, 'base64'));
		log('screenshot -> scripts/ui-check.png');
	} catch (e) { log(`screenshot failed: ${e.message}`); }

	const section = (title, items, fmt) => {
		console.log(`\n----- ${title} (${items.length}) -----`);
		items.forEach((it, i) => console.log(`${i + 1}. ${fmt(it)}`));
	};

	section('UNCAUGHT PAGE ERRORS', pageErrors, (e) => e);
	section('CONSOLE ERRORS', consoleErrors, (e) => `${trunc(e.text, 500)}${e.where ? `\n     at ${e.where}` : ''}`);
	section('CONSOLE WARNINGS', consoleWarnings, (e) => `${trunc(e.text, 400)}${e.where ? `\n     at ${e.where}` : ''}`);
	section('FAILED REQUESTS', failedRequests, (r) => `[${r.type}] ${r.method} ${r.url} -> ${r.error}`);
	section('HTTP >= 400', badResponses, (r) => `${r.status} [${r.type}] ${r.url}\n     ${r.body}`);

	console.log(`\n----- IMAGE RESPONSES BY HOST -----\n${JSON.stringify(imageHosts, null, 2)}`);
	console.log(`\n----- LEAFLET MAPS -----\n${JSON.stringify(maps, null, 2)}`);
	console.log(`\n----- SNAPSHOT -----\n${JSON.stringify(snapshot, null, 2)}`);

	cdp.ws.close();
	cleanup();
	process.exit(0);
})().catch((e) => {
	console.error('FATAL', e);
	process.exit(1);
});
