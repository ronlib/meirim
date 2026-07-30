const expect = require('chai').expect;
const sinon = require('sinon');
const { mockDatabase } = require('../../mock');
const { Plan } = require('../../../api/model');
const iplanApi = require('../../../api/lib/iplanApi');
const Log = require('../../../api/lib/log');

const tables = ['alert', 'plan', 'notification', 'person', 'plan_person', 'tag', 'plan_tag'];
const PLACEHOLDER = { type: 'Point', coordinates: [0, 0] };
const POLYGON = {
	type: 'Polygon',
	coordinates: [[[35.0, 32.0], [35.1, 32.0], [35.1, 32.1], [35.0, 32.1], [35.0, 32.0]]]
};
const PREDICATE = '(geom IS NULL OR ST_AsText(geom) = \'POINT(0 0)\' OR MP_ID IS NULL OR MP_ID = \'\')';

const buildPlan = (geom, plNumber) => ({
	OBJECTID: 0,
	MP_ID: '9999999',
	PL_NUMBER: plNumber,
	PL_NAME: 'TEST',
	PLAN_COUNTY_NAME: 'TEST',
	PLAN_CHARACTOR_NAME: 'TEST',
	data: 'TEST',
	geom,
	sent: 0,
	geo_search_filter: false,
	rating: 0,
	views: 0,
	erosion_views: 0
});

describe('fetchIplanGeometry placeholder (Null Island) handling', function() {
	let sinonSandbox;
	let cronController;
	let warnStub;

	beforeEach(async function() {
		await mockDatabase.createTables(tables);
		sinonSandbox = sinon.createSandbox();
		warnStub = sinonSandbox.spy(Log, 'warn');
		sinonSandbox.stub(iplanApi, 'getPlanGeometry').resolves(null);
		cronController = require('../../../api/controller/cron');
	});

	afterEach(async function() {
		sinonSandbox.restore();
		await mockDatabase.dropTables(tables);
	});

	it('exposes the PLACEHOLDER_GEOM constant equal to POINT(0 0)', function() {
		expect(cronController.PLACEHOLDER_GEOM).to.eql(PLACEHOLDER);
	});

	it('selects a plan written with the placeholder geom (writer/backfill contract)', async function() {
		const plan = new Plan(buildPlan(PLACEHOLDER, 'TEST-NULL-ISLAND'));
		await plan.save();
		const planId = plan.id;

		const successCount = await cronController.fetchIplanGeometry();
		expect(successCount).to.eql(0);

		const warnArgs = warnStub.getCalls().map(c => c.args.join(' '));
		expect(warnArgs.some(s => s.includes('TEST-NULL-ISLAND'))).to.eql(true,
			'fetchIplanGeometry should have selected and processed the placeholder plan');

		const { models } = await Plan.query(qb => qb.whereRaw(PREDICATE)).fetchAll();
		const selectedIds = models.map(m => m.id);
		expect(selectedIds).to.include(planId);
	});

	it('does not select a plan with a real polygon geometry', async function() {
		const plan = new Plan(buildPlan(POLYGON, 'TEST-POLYGON'));
		await plan.save();
		const planId = plan.id;

		const { models } = await Plan.query(qb => qb.whereRaw(PREDICATE)).fetchAll();
		const selectedIds = models.map(m => m.id);
		expect(selectedIds).to.not.include(planId);
	});

	it('browse excludes placeholder POINT(0 0) plans from the general list', async function() {
		const { PlanController } = require('../../../api/controller');
		await new Plan(buildPlan(PLACEHOLDER, 'TEST-NULL-ISLAND')).save();
		await new Plan(buildPlan(POLYGON, 'TEST-POLYGON')).save();

		const req = {
			session: { person: { id: 1, admin: 1 } },
			query: {}
		};
		const collection = await PlanController.browse(req);
		const numbers = collection.models.map(m => m.attributes.PL_NUMBER);
		expect(numbers).to.not.include('TEST-NULL-ISLAND');
		expect(numbers).to.include('TEST-POLYGON');
	});

	it('browse excludes placeholder POINT(0 0) plans from the distancePoint geo-search', async function() {
		const { PlanController } = require('../../../api/controller');
		await new Plan(buildPlan(PLACEHOLDER, 'TEST-NULL-ISLAND')).save();
		await new Plan(buildPlan(POLYGON, 'TEST-POLYGON')).save();

		const req = {
			session: { person: { id: 1, admin: 1 } },
			query: { distancePoint: '0,0' }
		};
		const collection = await PlanController.browse(req);
		const numbers = collection.models.map(m => m.attributes.PL_NUMBER);
		expect(numbers).to.not.include('TEST-NULL-ISLAND');
	});
});