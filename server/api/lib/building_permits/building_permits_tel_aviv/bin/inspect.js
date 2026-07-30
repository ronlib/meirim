#!/usr/bin/env node
/**
 * Builds a single self-contained HTML report from a crawl output file, so the
 * data can be eyeballed for sanity: distributions, date ranges, a map, and a
 * sortable table.
 *
 * No dependencies, no network, no build step - the output is one HTML file that
 * opens straight in a browser and works offline. Map tiles are deliberately not
 * used (they would need the internet); geometry is drawn as inline SVG in
 * lon/lat space, which is enough to confirm the shapes sit where they should.
 *
 *   node bin/inspect.js ~/building_permits_sample/permits_1000_normalized.json
 *   node bin/inspect.js out.json --out report.html
 *
 * Accepts either a record array or a GeoJSON FeatureCollection (both formats
 * that `crawl --out` produces).
 */

const fs = require('fs');
const path = require('path');

/** Reads either output format back into canonical records. */
function readRecords(file) {
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (Array.isArray(raw)) return raw;
	if (raw && raw.type === 'FeatureCollection') {
		return raw.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
	}
	throw new Error(`${file} is neither a record array nor a GeoJSON FeatureCollection`);
}

/** Counts values of one field, most common first. */
function tally(records, field) {
	const counts = new Map();
	for (const record of records) {
		const key = record[field] === null || record[field] === undefined || record[field] === '' ? '(empty)' : String(record[field]);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** How many records have a non-empty value for each of these fields. */
function coverage(records, fields) {
	return fields.map((field) => {
		const filled = records.filter((r) => {
			const v = r[field];
			if (v === null || v === undefined || v === '') return false;
			if (Array.isArray(v)) return v.length > 0;
			return true;
		}).length;
		return { field, filled, pct: records.length ? Math.round((filled / records.length) * 100) : 0 };
	});
}

/** Every coordinate pair of a Polygon or MultiPolygon, flattened. */
function coordsOf(geometry) {
	if (!geometry) return [];
	if (geometry.type === 'Polygon') return geometry.coordinates.flat();
	if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
	if (geometry.type === 'Point') return [geometry.coordinates];
	return [];
}

/** Outer rings only, for drawing. */
function ringsOf(geometry) {
	if (!geometry) return [];
	if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
	if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly[0]);
	return [];
}

function bounds(records) {
	let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
	for (const record of records) {
		for (const [lon, lat] of coordsOf(record.geometry)) {
			if (lon < minLon) minLon = lon;
			if (lat < minLat) minLat = lat;
			if (lon > maxLon) maxLon = lon;
			if (lat > maxLat) maxLat = lat;
		}
	}
	return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null;
}

/** Sanity checks that would indicate a broken pipeline rather than odd data. */
function sanityChecks(records) {
	const checks = [];
	const push = (label, ok, detail) => checks.push({ label, ok, detail });

	const keys = records.map((r) => r.dedupeKey).filter(Boolean);
	push('every record has a dedupeKey', keys.length === records.length, `${keys.length}/${records.length}`);
	push('dedupeKeys are unique', new Set(keys).size === keys.length, `${new Set(keys).size} unique of ${keys.length}`);

	const withGeom = records.filter((r) => r.geometry);
	push('every record has geometry', withGeom.length === records.length, `${withGeom.length}/${records.length}`);

	const types = new Set(withGeom.map((r) => r.geometry.type));
	push(
		'geometry types are Polygon/MultiPolygon',
		[...types].every((t) => t === 'Polygon' || t === 'MultiPolygon'),
		[...types].join(', ') || 'none'
	);

	const outside = withGeom.filter((r) =>
		coordsOf(r.geometry).some(([lon, lat]) => !(lon > 34 && lon < 36 && lat > 29 && lat < 34))
	);
	push('all coordinates inside Israel (WGS84)', outside.length === 0, `${outside.length} outside`);

	const isoBad = [];
	for (const record of records) {
		for (const field of ['requestOpenedAt', 'permitGrantedAt', 'constructionStartedAt', 'supervisionStatusAt', 'worksApprovedAt', 'importedAt']) {
			const v = record[field];
			if (v && !/^\d{4}-\d{2}-\d{2}T/.test(v)) isoBad.push(`${record.dedupeKey}.${field}=${v}`);
		}
	}
	push('all dates are ISO-8601', isoBad.length === 0, isoBad.slice(0, 3).join('; ') || 'ok');

	const future = records.filter((r) => r.requestOpenedAt && r.requestOpenedAt > '2027');
	push('no absurd future request dates', future.length === 0, `${future.length} after 2027`);

	const raw = records.filter((r) => r.sourceFields && Object.keys(r.sourceFields).length > 0);
	push('raw sourceFields preserved', raw.length === records.length, `${raw.length}/${records.length}`);

	// Ordering invariant: stage and stageOrder must agree.
	const permitStages = ['בתהליך היתר', 'קיים היתר', 'בבניה', 'קיימת לפחות תעודת גמר אחת', 'קיים אכלוס'];
	const mismatched = records.filter(
		(r) => r.kind === 'building_permit' && r.stageOrder !== null && r.stageOrder !== undefined && permitStages[r.stageOrder] !== r.stage
	);
	push('stage matches stageOrder', mismatched.length === 0, `${mismatched.length} mismatched`);

	return checks;
}

const esc = (s) =>
	String(s === null || s === undefined ? '' : s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

/** Renders the geometry as inline SVG, in equirectangular projection. */
function renderMap(records, width = 900, height = 700) {
	const box = bounds(records);
	if (!box) return '<p class="muted">No geometry to draw.</p>';

	// Latitude correction so the city is not horizontally stretched.
	const midLat = (box.minLat + box.maxLat) / 2;
	const lonScale = Math.cos((midLat * Math.PI) / 180);

	const spanLon = (box.maxLon - box.minLon) * lonScale || 1e-6;
	const spanLat = box.maxLat - box.minLat || 1e-6;
	const pad = 10;
	const scale = Math.min((width - pad * 2) / spanLon, (height - pad * 2) / spanLat);

	const px = (lon) => pad + (lon - box.minLon) * lonScale * scale;
	// SVG y grows downward, latitude grows upward.
	const py = (lat) => height - pad - (lat - box.minLat) * scale;

	// Colour by lifecycle position so clusters are meaningful, not decorative.
	const colours = ['#8899a6', '#e8a33d', '#d1495b', '#3f8f5f', '#4a6fa5'];
	const colourFor = (record) => {
		const order = record.kind === 'building_permit' ? record.stageOrder : record.buildStageOrder;
		if (order === null || order === undefined) return '#bbb';
		return colours[Math.min(order, colours.length - 1)];
	};

	const shapes = records
		.filter((r) => r.geometry)
		.map((record) => {
			const fill = colourFor(record);
			const title = esc(`${record.address || record.dedupeKey} — ${record.stage || record.buildStage || ''}`);
			return ringsOf(record.geometry)
				.map((ring) => {
					const pts = ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join(' ');
					return `<polygon points="${pts}" fill="${fill}" fill-opacity="0.55" stroke="${fill}" stroke-width="0.6"><title>${title}</title></polygon>`;
				})
				.join('');
		})
		.join('\n');

	const legend = colours
		.map((c, i) => `<span class="key"><i style="background:${c}"></i>stage ${i}</span>`)
		.join('');

	return `
    <div class="mapwrap">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="permit locations">
        <rect width="${width}" height="${height}" fill="var(--map-bg)"/>
        ${shapes}
      </svg>
    </div>
    <p class="legend">${legend}</p>
    <p class="muted">Bounding box: lon ${box.minLon.toFixed(4)}–${box.maxLon.toFixed(4)}, lat ${box.minLat.toFixed(4)}–${box.maxLat.toFixed(4)}.
    Hover a shape for its address. Tel Aviv should appear as a recognisable coastal city outline; anything else means a projection problem.</p>`;
}

function barRows(entries, total, limit = 12) {
	return entries
		.slice(0, limit)
		.map(([label, n]) => {
			const pct = total ? (n / total) * 100 : 0;
			return `<tr><td class="lbl">${esc(label)}</td><td class="num">${n}</td>
        <td class="barcell"><span class="bar" style="width:${pct.toFixed(1)}%"></span></td>
        <td class="num muted">${pct.toFixed(1)}%</td></tr>`;
		})
		.join('');
}

function buildHtml({ file, records, permits, sites }) {
	const checks = sanityChecks(records);
	const failed = checks.filter((c) => !c.ok).length;

	const dateSpan = (field) => {
		const vals = records.map((r) => r[field]).filter(Boolean).sort();
		return vals.length ? `${vals[0].slice(0, 10)} → ${vals[vals.length - 1].slice(0, 10)}` : '—';
	};

	const permitCoverage = permits.length
		? coverage(permits, ['address', 'requestNumber', 'permitNumber', 'stage', 'housingUnits', 'requestOpenedAt', 'permitGrantedAt', 'constructionStartedAt', 'documentUrl', 'trackingFiles'])
		: [];
	const siteCoverage = sites.length
		? coverage(sites, ['address', 'trackingFile', 'supervisionStatus', 'buildStage', 'blockParcel', 'permitHolders', 'worksApprovedAt', 'archiveUrl'])
		: [];

	// Sample rows: the alert-relevant ones are the most useful to eyeball.
	const alertish = permits
		.filter((r) => r.constructionStartedAt)
		.sort((a, b) => String(b.constructionStartedAt).localeCompare(String(a.constructionStartedAt)))
		.slice(0, 40);

	const tableRows = (alertish.length ? alertish : records.slice(0, 40))
		.map((r) => `<tr>
      <td>${esc((r.constructionStartedAt || r.permitGrantedAt || r.worksApprovedAt || '').slice(0, 10))}</td>
      <td>${esc(r.stage || r.buildStage || '')}</td>
      <td class="num">${esc(r.housingUnits === null || r.housingUnits === undefined ? '' : r.housingUnits)}</td>
      <td>${esc(r.address || '')}</td>
      <td class="mono muted">${esc(r.groupKey || r.dedupeKey || '')}</td>
    </tr>`)
		.join('');

	const stageField = permits.length ? 'stage' : 'buildStage';
	const stageSource = permits.length ? permits : sites;

	return `<title>Building permits — data inspection</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1d21; --muted: #6b7280; --line: #e5e7eb;
    --card: #f9fafb; --accent: #3f6f9f; --map-bg: #f2f4f6;
    --ok: #2f7d4f; --bad: #c0392b;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#15181c; --fg:#e6e8ea; --muted:#9aa3ad; --line:#2b3038;
            --card:#1c2026; --accent:#7aa7d4; --map-bg:#1a1e24; --ok:#5fbf87; --bad:#e8756a; }
  }
  :root[data-theme="dark"] {
    --bg:#15181c; --fg:#e6e8ea; --muted:#9aa3ad; --line:#2b3038;
    --card:#1c2026; --accent:#7aa7d4; --map-bg:#1a1e24; --ok:#5fbf87; --bad:#e8756a;
  }
  :root[data-theme="light"] {
    --bg:#ffffff; --fg:#1a1d21; --muted:#6b7280; --line:#e5e7eb;
    --card:#f9fafb; --accent:#3f6f9f; --map-bg:#f2f4f6; --ok:#2f7d4f; --bad:#c0392b;
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width: 1000px; margin: 0 auto; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; letter-spacing:-.01em; }
  h2 { font-size:1.1rem; margin:2.5rem 0 .75rem; padding-bottom:.4rem; border-bottom:1px solid var(--line); }
  .sub { color:var(--muted); margin:0 0 1.5rem; font-size:.9rem; }
  .mono { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
  .muted { color:var(--muted); }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.75rem; }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.85rem 1rem; }
  .tile .v { font-size:1.5rem; font-weight:600; letter-spacing:-.02em; }
  .tile .k { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th,td { text-align:start; padding:.4rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; }
  td.num, th.num { text-align:end; font-variant-numeric:tabular-nums; }
  .lbl { max-width:22rem; }
  .barcell { width:40%; }
  .bar { display:block; height:9px; border-radius:2px; background:var(--accent); min-width:2px; }
  .scroll { overflow-x:auto; }
  .check { display:flex; gap:.6rem; align-items:baseline; padding:.35rem 0; border-bottom:1px solid var(--line); }
  .check .mark { font-weight:700; width:1.2rem; flex:none; }
  .ok .mark { color:var(--ok); } .bad .mark { color:var(--bad); }
  .mapwrap { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--map-bg); }
  svg { display:block; width:100%; height:auto; }
  .legend { display:flex; gap:1rem; flex-wrap:wrap; margin:.6rem 0 0; font-size:.82rem; color:var(--muted); }
  .key { display:inline-flex; align-items:center; gap:.35rem; }
  .key i { width:11px; height:11px; border-radius:2px; display:inline-block; }
  .banner { border-radius:8px; padding:.7rem 1rem; margin:1rem 0 0; border:1px solid var(--line); background:var(--card); }
</style>
<div class="wrap">
  <h1>Building permits — data inspection</h1>
  <p class="sub mono">${esc(file)}</p>

  <div class="tiles">
    <div class="tile"><div class="k">records</div><div class="v">${records.length}</div></div>
    <div class="tile"><div class="k">permits</div><div class="v">${permits.length}</div></div>
    <div class="tile"><div class="k">sites</div><div class="v">${sites.length}</div></div>
    <div class="tile"><div class="k">unique keys</div><div class="v">${new Set(records.map((r) => r.dedupeKey)).size}</div></div>
    <div class="tile"><div class="k">permits (grouped)</div><div class="v">${new Set(records.map((r) => r.groupKey)).size}</div></div>
    <div class="tile"><div class="k">with geometry</div><div class="v">${records.filter((r) => r.geometry).length}</div></div>
  </div>

  <div class="banner ${failed ? 'bad' : 'ok'}">
    <strong>${failed === 0 ? 'All sanity checks passed.' : `${failed} sanity check(s) failed.`}</strong>
    ${failed === 0 ? ' The data looks structurally sound.' : ' See the checks below — this suggests a pipeline problem, not merely unusual data.'}
  </div>

  <h2>Sanity checks</h2>
  ${checks.map((c) => `<div class="check ${c.ok ? 'ok' : 'bad'}"><span class="mark">${c.ok ? '✓' : '✗'}</span>
      <span>${esc(c.label)} <span class="muted mono">${esc(c.detail)}</span></span></div>`).join('')}

  <h2>Where the records are</h2>
  ${renderMap(records)}

  <h2>Lifecycle distribution</h2>
  <div class="scroll"><table>
    <thead><tr><th>${esc(stageField)}</th><th class="num">n</th><th></th><th class="num">%</th></tr></thead>
    <tbody>${barRows(tally(stageSource, stageField), stageSource.length)}</tbody>
  </table></div>

  ${permits.length ? `<h2>Field coverage — permits</h2>
  <div class="scroll"><table>
    <thead><tr><th>field</th><th class="num">filled</th><th></th><th class="num">%</th></tr></thead>
    <tbody>${permitCoverage.map((c) => `<tr><td class="lbl mono">${esc(c.field)}</td><td class="num">${c.filled}</td>
      <td class="barcell"><span class="bar" style="width:${c.pct}%"></span></td><td class="num muted">${c.pct}%</td></tr>`).join('')}</tbody>
  </table></div>` : ''}

  ${sites.length ? `<h2>Field coverage — construction sites</h2>
  <div class="scroll"><table>
    <thead><tr><th>field</th><th class="num">filled</th><th></th><th class="num">%</th></tr></thead>
    <tbody>${siteCoverage.map((c) => `<tr><td class="lbl mono">${esc(c.field)}</td><td class="num">${c.filled}</td>
      <td class="barcell"><span class="bar" style="width:${c.pct}%"></span></td><td class="num muted">${c.pct}%</td></tr>`).join('')}</tbody>
  </table></div>` : ''}

  <h2>Date ranges</h2>
  <div class="scroll"><table>
    <thead><tr><th>field</th><th>earliest → latest</th></tr></thead>
    <tbody>${['requestOpenedAt', 'permitGrantedAt', 'constructionStartedAt', 'permitExpiresAt', 'supervisionStatusAt', 'worksApprovedAt', 'importedAt']
		.map((f) => `<tr><td class="mono">${f}</td><td>${esc(dateSpan(f))}</td></tr>`).join('')}</tbody>
  </table></div>

  ${permits.length ? `<h2>Request types (top 12)</h2>
  <div class="scroll"><table>
    <thead><tr><th>sug_bakasha</th><th class="num">n</th><th></th><th class="num">%</th></tr></thead>
    <tbody>${barRows(tally(permits, 'requestType'), permits.length)}</tbody>
  </table></div>` : ''}

  <h2>${alertish.length ? 'Recent construction starts' : 'Sample records'}</h2>
  <p class="muted">${alertish.length ? 'The alert-relevant slice: permits with a construction-start date, newest first.' : 'First 40 records.'}</p>
  <div class="scroll"><table>
    <thead><tr><th>date</th><th>stage</th><th class="num">units</th><th>address</th><th>key</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div>

  <h2>How to read this</h2>
  <ul class="muted">
    <li>The map should look like Tel Aviv. If it is a smear or a single dot, geometry or projection is wrong.</li>
    <li>Hebrew text must render correctly everywhere; mojibake means an encoding problem.</li>
    <li>"unique keys" should equal "records". "permits (grouped)" is lower because multi-parcel permits share a group.</li>
    <li>Low coverage on <span class="mono">permitNumber</span> or <span class="mono">constructionStartedAt</span> is expected — many permits have not reached those stages.</li>
    <li>Coverage near 0% on <span class="mono">address</span> or <span class="mono">stage</span> would indicate a broken field mapping.</li>
  </ul>
</div>`;
}

function main() {
	const args = process.argv.slice(2);
	const file = args.find((a) => !a.startsWith('--'));
	if (!file) {
		console.error('usage: node bin/inspect.js <crawl-output.json> [--out report.html]');
		process.exit(1);
	}
	const outIdx = args.indexOf('--out');
	const out = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : file.replace(/\.(json|geojson)$/i, '') + '.report.html';

	const records = readRecords(file);
	if (!records.length) {
		console.error(`${file} contains no records`);
		process.exit(1);
	}
	const permits = records.filter((r) => r.kind === 'building_permit');
	const sites = records.filter((r) => r.kind === 'construction_site');

	const html = buildHtml({ file: path.resolve(file), records, permits, sites });
	fs.writeFileSync(out, html);

	const failed = sanityChecks(records).filter((c) => !c.ok);
	console.log(`inspected ${records.length} records (${permits.length} permits, ${sites.length} sites)`);
	console.log(`report: ${path.resolve(out)}`);
	if (failed.length) {
		console.log(`\n${failed.length} sanity check(s) FAILED:`);
		failed.forEach((c) => console.log(`  ✗ ${c.label} — ${c.detail}`));
		process.exitCode = 1;
	} else {
		console.log('all sanity checks passed');
	}
}

main();
