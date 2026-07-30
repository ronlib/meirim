/**
 * building-permits - standalone scraper for Israeli municipal building permit
 * and construction site GIS layers. Currently: Tel Aviv-Yafo.
 *
 * This is the entire public surface. Nothing outside this folder should reach
 * into src/ directly, so the unit can be lifted into another repository (or
 * published as a package) unchanged. See CLAUDE.md for the rules that keep it
 * that way, and README.md for usage.
 */

const { crawl, isImminentConstruction } = require('./src/crawl');
const sources = require('./src/sources');
const schema = require('./src/schema');
const dedupe = require('./src/dedupe');
const normalize = require('./src/normalize');
const arcgis = require('./src/arcgis');
const defaults = require('./src/defaults');

module.exports = {
	// orchestration
	crawl,
	isImminentConstruction,

	// sources
	sources: sources.ALL,
	resolveSources: sources.resolve,
	listCities: sources.cities,

	// contract
	KIND: schema.KIND,
	PERMIT_STAGES: schema.PERMIT_STAGES,
	SITE_STAGES: schema.SITE_STAGES,
	STAGE_PERMIT_GRANTED: schema.STAGE_PERMIT_GRANTED,
	TRACKED_FIELDS: schema.TRACKED_FIELDS,

	// building blocks, for hosts that want to assemble their own pipeline
	dedupe,
	normalize,
	arcgis,
	defaults,
};
