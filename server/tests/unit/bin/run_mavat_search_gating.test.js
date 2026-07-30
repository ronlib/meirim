const chai = require('chai');
const sinon = require('sinon');
const path = require('path');

const expect = chai.expect;

describe('run_mavat_search gating', function() {
	const binPath = path.resolve(__dirname, '../../../bin/run_mavat_search');
	let controller;
	let crawlCadence;
	let Log;
	let metrics;
	let setLastStub;
	let mavatSearchStub;
	let logWarnStub;
	let lastRunPromise;

	beforeEach(function() {
		controller = require('../../../api/controller/cron');
		crawlCadence = require('../../../api/lib/crawlCadence');
		Log = require('../../../api/lib/log');
		metrics = require('../../../metrics');

		lastRunPromise = null;

		sinon.stub(crawlCadence, 'getCrawlConfig').returns({
			bufferDays: 7,
			backfillSchedule: '0 0 2 * * 0',
			incrementalSchedule: '0 */6 * * *',
		});
		sinon.stub(crawlCadence, 'calculateDateLastStatusDate').resolves(null);
		setLastStub = sinon.stub(crawlCadence, 'setLastSuccessfulCrawlDate').resolves();
		mavatSearchStub = sinon.stub(controller, 'mavatSearch');
		logWarnStub = sinon.stub(Log, 'warn');
		sinon.stub(Log, 'info');
		sinon.stub(Log, 'error');
		sinon.stub(metrics, 'runAndReport').callsFake(({ func }) => {
			lastRunPromise = (async () => {
				try {
					await func();
				} catch (e) {
					return e;
				}
			})();
			return lastRunPromise;
		});
	});

	afterEach(function() {
		sinon.restore();
		delete require.cache[binPath];
	});

	async function loadAndRunBin() {
		delete require.cache[binPath];
		require(binPath);
		await new Promise(r => setImmediate(r));
		return lastRunPromise;
	}

	it('calls setLastSuccessfulCrawlDate when errors === 0', async function() {
		mavatSearchStub.resolves({ new: 1, changed: 0, unchanged: 0, errors: 0 });
		await loadAndRunBin();
		expect(setLastStub.calledOnce).to.equal(true);
	});

	it('does not call setLastSuccessfulCrawlDate when errors > 0', async function() {
		mavatSearchStub.resolves({ new: 0, changed: 0, unchanged: 0, errors: 3 });
		await loadAndRunBin();
		expect(setLastStub.called).to.equal(false);
		expect(logWarnStub.called).to.equal(true);
		const warnMsg = logWarnStub.getCalls().map(c => c.args[0]).join(' ');
		expect(warnMsg).to.match(/NOT updated/i);
	});

	it('does not call setLastSuccessfulCrawlDate when errors is missing', async function() {
		mavatSearchStub.resolves({ new: 1, changed: 0, unchanged: 0 });
		await loadAndRunBin();
		expect(setLastStub.called).to.equal(false);
		expect(logWarnStub.called).to.equal(true);
	});

	it('does not call setLastSuccessfulCrawlDate when mavatSearch throws', async function() {
		mavatSearchStub.rejects(new Error('catastrophic'));
		const result = await loadAndRunBin();
		expect(result).to.be.instanceOf(Error);
		expect(result.message).to.equal('catastrophic');
		expect(setLastStub.called).to.equal(false);
	});
});
