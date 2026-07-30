const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('crawlPipeline.runMavatSearchCrawl', function() {
	let controller;
	let crawlCadence;
	let Log;
	let metrics;
	let runMavatSearchCrawl;
	let setLastStub;
	let mavatSearchStub;
	let fetchGeomStub;
	let reportStub;

	beforeEach(function() {
		controller = require('../../../api/controller/cron');
		crawlCadence = require('../../../api/lib/crawlCadence');
		Log = require('../../../api/lib/log');
		metrics = require('../../../metrics');

		sinon.stub(crawlCadence, 'getCrawlConfig').returns({
			bufferDays: 7,
			backfillSchedule: '0 0 2 * * 0',
			incrementalSchedule: '0 */6 * * *',
		});
		sinon.stub(crawlCadence, 'calculateDateLastStatusDate').resolves(null);
		setLastStub = sinon.stub(crawlCadence, 'setLastSuccessfulCrawlDate').resolves();
		mavatSearchStub = sinon.stub(controller, 'mavatSearch');
		fetchGeomStub = sinon.stub(controller, 'fetchIplanGeometry').resolves(0);
		sinon.stub(Log, 'info');
		sinon.stub(Log, 'warn');
		sinon.stub(Log, 'error');
		reportStub = sinon.stub(metrics, 'report').resolves();

		const pipeline = require('../../../api/lib/crawlPipeline');
		runMavatSearchCrawl = pipeline.runMavatSearchCrawl;
	});

	afterEach(function() {
		sinon.restore();
		delete require.cache[require.resolve('../../../api/lib/crawlPipeline')];
	});

	it('calls setLastSuccessfulCrawlDate and fetchIplanGeometry when errors === 0', async function() {
		mavatSearchStub.resolves({ new: 1, changed: 0, unchanged: 0, errors: 0 });
		await runMavatSearchCrawl();
		expect(setLastStub.calledOnce).to.equal(true);
		expect(fetchGeomStub.calledOnce).to.equal(true);
	});

	it('does not call setLastSuccessfulCrawlDate when errors > 0 but STILL calls fetchIplanGeometry', async function() {
		mavatSearchStub.resolves({ new: 0, changed: 0, unchanged: 0, errors: 3 });
		await runMavatSearchCrawl();
		expect(setLastStub.called).to.equal(false);
		expect(fetchGeomStub.calledOnce).to.equal(true);
	});

	it('still runs fetchIplanGeometry when crawl found zero new/changed plans', async function() {
		mavatSearchStub.resolves({ new: 0, changed: 0, unchanged: 5, errors: 0 });
		await runMavatSearchCrawl();
		expect(setLastStub.calledOnce).to.equal(true);
		expect(fetchGeomStub.calledOnce).to.equal(true);
	});

	it('does not crash the run when fetchIplanGeometry throws and reports failed metric', async function() {
		mavatSearchStub.resolves({ new: 1, changed: 0, unchanged: 0, errors: 0 });
		fetchGeomStub.rejects(new Error('backfill boom'));
		await expect(runMavatSearchCrawl()).to.be.fulfilled;
		expect(setLastStub.calledOnce).to.equal(true);
		expect(fetchGeomStub.calledOnce).to.equal(true);
		const failedCall = reportStub.getCalls().find(c => {
			const a = c.args[0];
			return a && a.metricName === 'fetchIplanGeometry' && a.attributes && a.attributes.result === 'failed';
		});
		expect(failedCall).to.not.equal(undefined);
	});

	it('rejects when mavatSearch throws and does NOT call setLast or fetchIplanGeometry', async function() {
		mavatSearchStub.rejects(new Error('catastrophic'));
		await expect(runMavatSearchCrawl()).to.be.rejectedWith('catastrophic');
		expect(setLastStub.called).to.equal(false);
		expect(fetchGeomStub.called).to.equal(false);
	});
});