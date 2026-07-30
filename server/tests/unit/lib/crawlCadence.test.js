const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const { mockDatabase } = require('../../mock');
const { Knex } = require('../../../api/service/database');
const crawlCadence = require('../../../api/lib/crawlCadence');
const Log = require('../../../api/lib/log');

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('crawlCadence', function() {
	const tables = ['crawl_meta'];

	beforeEach(async function() {
		await mockDatabase.dropTables(tables);
		await mockDatabase.createTables(tables);
	});

	afterEach(async function() {
		await mockDatabase.dropTables(tables);
		sinon.restore();
	});

	describe('getLastCrawlDate', function() {
		it('returns value when present', async function() {
			await Knex('crawl_meta').insert({ key: 'last_successful_mavat_crawl', value: '15/03/2024' });
			const result = await crawlCadence.getLastCrawlDate();
			expect(result).to.equal('15/03/2024');
		});

		it('returns null when row missing', async function() {
			const result = await crawlCadence.getLastCrawlDate();
			expect(result).to.equal(null);
		});
	});

	describe('setLastSuccessfulCrawlDate', function() {
		it('inserts when key does not exist', async function() {
			await crawlCadence.setLastSuccessfulCrawlDate();
			const row = await Knex('crawl_meta').where({ key: 'last_successful_mavat_crawl' }).first();
			expect(row).to.exist;
			expect(row.value).to.match(/^\d{2}\/\d{2}\/\d{4}$/);
		});

		it('updates when key already exists', async function() {
			await Knex('crawl_meta').insert({ key: 'last_successful_mavat_crawl', value: '01/01/2000' });
			await crawlCadence.setLastSuccessfulCrawlDate();
			const row = await Knex('crawl_meta').where({ key: 'last_successful_mavat_crawl' }).first();
			expect(row.value).to.not.equal('01/01/2000');
			expect(row.value).to.match(/^\d{2}\/\d{2}\/\d{4}$/);
			const count = await Knex('crawl_meta').where({ key: 'last_successful_mavat_crawl' }).count('id as cnt').first();
			expect(Number(count.cnt)).to.equal(1);
		});

		it('logs info on success with date', async function() {
			const infoStub = sinon.stub(Log, 'info');
			await crawlCadence.setLastSuccessfulCrawlDate();
			const successLog = infoStub.getCalls().find(c =>
				typeof c.args[0] === 'string' && c.args[0].includes('Successfully set last crawl date')
			);
			expect(successLog).to.exist;
			expect(successLog.args[0]).to.match(/\d{2}\/\d{2}\/\d{4}/);
		});

		it('rethrows on failure after Log.error', async function() {
			const errorStub = sinon.stub(Log, 'error');
			await mockDatabase.dropTables(tables);
			await expect(crawlCadence.setLastSuccessfulCrawlDate()).to.be.rejected;
			expect(errorStub.called).to.equal(true);
		});
	});
});
