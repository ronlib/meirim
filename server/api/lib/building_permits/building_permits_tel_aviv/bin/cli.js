#!/usr/bin/env node
/**
 * Standalone CLI. Runs the scraper with no database and writes JSON/GeoJSON.
 *
 *   node bin/cli.js list
 *   node bin/cli.js validate
 *   node bin/cli.js crawl --source tlv-building-permits --max 50 --out permits.json
 *   node bin/cli.js crawl --since 2026-01-01 --out out.json --changes changes.json
 *   node bin/cli.js stats
 *
 * --state lets you diff across separate runs without a database: pass the
 * previous run's --out file and status changes are computed against it.
 */

const fs = require('fs');
const path = require('path');

const { crawl, resolveSources, listCities, defaults, arcgis, KIND } = require('../index');

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token.startsWith('--')) {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) args[key] = true;
			else {
				args[key] = next;
				i += 1;
			}
		} else args._.push(token);
	}
	return args;
}

const USAGE = `
building-permits - Israeli municipal building permit scraper

Usage: node bin/cli.js <command> [options]

Commands:
  crawl        Fetch records, detect status changes, write JSON
  list         List available sources
  validate     Check that upstream layers still expose the expected fields
  stats        Print upstream feature counts per source
  help

Options:
  --source <names>   Comma-separated source names, city codes, or 'all' (default: all)
  --year <YYYY>      Filter permits by request-opened year
  --since <DATE>     Only records with recent activity (YYYY-MM-DD)
  --bbox <W,S,E,N>   Only records intersecting this lon/lat envelope
  --near <LON,LAT>   Only records within --radius of this point
  --radius <METERS>  Radius for --near (default 500)
  --within           Require full containment instead of intersection
  --max <N>          Cap features fetched per source (useful for smoke tests)
  --page-size <N>    Features per request (default 1000, upstream max 2000)
  --out <file>       Write records as JSON (use .geojson for a FeatureCollection)
  --changes <file>   Write the detected status-change log as JSON
  --state <file>     Previous --out file, to diff against for status changes
  --geojson          Force GeoJSON FeatureCollection output
  --no-geometry      Strip geometry from output
  --dry-run          Do not write to the store (still reports)
  --quiet            Suppress progress logging
  --debug            Verbose per-request logging
`.trim();

/**
 * Builds the `area` option from CLI flags. Returns undefined when no area flag
 * was given, so the crawl stays unfiltered.
 */
function areaFromArgs(args) {
	const spatialRel = args.within ? 'esriSpatialRelWithin' : undefined;

	if (args.bbox) {
		const parts = String(args.bbox).split(',').map(Number);
		if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
			throw new Error('--bbox expects four comma-separated numbers: west,south,east,north');
		}
		return { bbox: parts, spatialRel };
	}

	if (args.near) {
		const parts = String(args.near).split(',').map(Number);
		if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
			throw new Error('--near expects two comma-separated numbers: lon,lat');
		}
		const radiusMeters = args.radius ? Number(args.radius) : 500;
		if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
			throw new Error('--radius expects a positive number of meters');
		}
		return { center: parts, radiusMeters, spatialRel };
	}

	if (args.radius) throw new Error('--radius requires --near');
	return undefined;
}

/** Wraps records as a GeoJSON FeatureCollection; geometry-less records are kept. */
function toFeatureCollection(records) {
	return {
		type: 'FeatureCollection',
		features: records.map((record) => {
			const { geometry, ...properties } = record;
			return { type: 'Feature', geometry: geometry || null, properties };
		}),
	};
}

function writeOut(file, records, { geojson, stripGeometry }) {
	let payload = records;
	if (stripGeometry) {
		payload = records.map((record) => {
			const rest = { ...record };
			delete rest.geometry;
			return rest;
		});
	}
	const useGeojson = geojson || /\.geojson$/i.test(file);
	const body = useGeojson ? toFeatureCollection(payload) : payload;
	fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(body, null, 2));
	return { file, count: records.length, format: useGeojson ? 'geojson' : 'json' };
}

/** Reads a previous --out file (either format) back into records for diffing. */
function readState(file) {
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (Array.isArray(raw)) return raw;
	if (raw && raw.type === 'FeatureCollection') {
		return raw.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
	}
	throw new Error(`--state file ${file} is neither a record array nor a FeatureCollection`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const command = args._[0] || 'help';

	if (command === 'help' || args.help) {
		console.log(USAGE);
		return;
	}

	const log = args.quiet ? defaults.createSilentLog() : defaults.createLog({ debug: Boolean(args.debug) });
	const http = defaults.createHttp({ log });

	if (command === 'list') {
		for (const { city, cityName, sources } of listCities()) {
			console.log(`${city}${cityName ? ` (${cityName})` : ''} — ${sources.length} source(s)`);
			for (const name of sources) {
				const source = resolveSources(name)[0];
				const where = source.serviceUrl ? `layer ${source.layerId} @ ${source.serviceUrl}` : '(non-ArcGIS source)';
				console.log(`  ${source.name}\n    ${source.description}\n    ${where}`);
			}
			console.log();
		}
		console.log('Select with --source <source-name|city|all>');
		return;
	}

	const selected = resolveSources(args.source || 'all');
	const area = areaFromArgs(args);

	if (command === 'validate') {
		let ok = true;
		for (const source of selected) {
			const missing = await source.validate({ http });
			if (missing.length) {
				ok = false;
				console.error(`FAIL ${source.name}: missing fields ${missing.join(', ')}`);
			} else console.log(`OK   ${source.name}: all ${source.requiredFields.length} expected fields present`);
		}
		process.exitCode = ok ? 0 : 1;
		return;
	}

	if (command === 'stats') {
		// One tiny request per source. Use this to size a crawl before running it.
		for (const source of selected) {
			const where = source.buildWhere({ year: args.year ? Number(args.year) : undefined, since: args.since });
			const total = await arcgis.count({
				http,
				serviceUrl: source.serviceUrl,
				layerId: source.layerId,
				where,
				area,
			});
			const scope = [
				area ? 'area-filtered' : null,
				where === '1=1' ? null : 'attribute-filtered',
			].filter(Boolean).join(', ') || 'unfiltered';
			console.log(`${source.name}: ${total} features upstream (${scope})`);
		}
		return;
	}

	if (command !== 'crawl') {
		console.error(`unknown command '${command}'\n\n${USAGE}`);
		process.exitCode = 1;
		return;
	}

	const seed = args.state ? readState(args.state) : [];
	if (seed.length) log.info(`loaded ${seed.length} records from ${args.state} for change detection`);
	const store = defaults.createMemoryStore({ seed });

	const startedAt = new Date().toISOString();
	const report = await crawl(
		{ http, log, store },
		{
			sources: selected,
			year: args.year ? Number(args.year) : undefined,
			since: args.since,
			area,
			maxFeatures: args.max ? Number(args.max) : undefined,
			pageSize: args['page-size'] ? Number(args['page-size']) : undefined,
			dryRun: Boolean(args['dry-run']),
		}
	);
	report.startedAt = startedAt;
	report.finishedAt = new Date().toISOString();

	const records = store.all();

	if (args.out) {
		const written = writeOut(args.out, records, {
			geojson: Boolean(args.geojson),
			stripGeometry: Boolean(args['no-geometry']),
		});
		log.info(`wrote ${written.count} records to ${written.file} (${written.format})`);
	}

	if (args.changes) {
		fs.mkdirSync(path.dirname(path.resolve(args.changes)), { recursive: true });
		fs.writeFileSync(args.changes, JSON.stringify(store.changeLog(), null, 2));
		log.info(`wrote ${store.changeLog().length} status changes to ${args.changes}`);
	}

	// Summary to stdout, so `| jq` works even when --out is used.
	const permits = records.filter((r) => r.kind === KIND.PERMIT);
	const sites = records.filter((r) => r.kind === KIND.SITE);
	console.log(
		JSON.stringify(
			{
				startedAt: report.startedAt,
				finishedAt: report.finishedAt,
				totals: report.totals,
				sources: report.sources,
				counts: { permits: permits.length, sites: sites.length },
				imminentConstruction: report.imminentChanges.map((c) => ({
					dedupeKey: c.dedupeKey,
					field: c.field,
					from: c.from,
					to: c.to,
					address: c.record && c.record.address,
				})),
			},
			null,
			2
		)
	);

	if (report.totals.failures > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error && error.stack ? error.stack : error);
	process.exit(1);
});
