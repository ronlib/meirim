/**
 * Guards the property that makes this unit portable: nothing inside it may
 * import anything from outside its own folder.
 *
 * Without this test the coupling creeps back within a month - someone adds
 * `require('../../service/database')` for one quick fix and the unit can no
 * longer be lifted into another repository. Host-specific wiring belongs in an
 * adapter *outside* this folder; see README.md and CLAUDE.md.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const ROOT = path.join(__dirname, '..');

/** All .js files in this unit. */
function jsFiles(dir = ROOT, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) jsFiles(full, found);
		else if (entry.name.endsWith('.js')) found.push(full);
	}
	return found;
}

/**
 * Strips comments so that documentation *about* a forbidden import - including
 * the examples in this file's own header - is not mistaken for one.
 * Crude but sufficient: this unit has no regex or string literals containing
 * comment delimiters.
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Extracts every require() target from a source file. */
function requiresOf(file) {
	const source = stripComments(fs.readFileSync(file, 'utf8'));
	const targets = [];
	const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
	let match;
	while ((match = re.exec(source)) !== null) targets.push(match[1]);
	return targets;
}

const NODE_BUILTINS = new Set(['assert', 'fs', 'path', 'url', 'util', 'events', 'stream', 'crypto', 'os', 'node:test']);

describe('building_permits/isolation', () => {
	const files = jsFiles();

	it('contains the files it is supposed to', () => {
		assert.ok(files.length >= 10, `expected the unit to have several modules, found ${files.length}`);
	});

	it('never imports from outside this folder', () => {
		const violations = [];

		for (const file of files) {
			for (const target of requiresOf(file)) {
				if (!target.startsWith('.')) continue; // bare specifiers checked below
				const resolved = path.resolve(path.dirname(file), target);
				if (!resolved.startsWith(ROOT)) {
					violations.push(`${path.relative(ROOT, file)} -> ${target}`);
				}
			}
		}

		assert.deepStrictEqual(
			violations,
			[],
			`relative imports escaping the unit:\n  ${violations.join('\n  ')}\n` +
			'Host-specific code belongs in an adapter outside this folder.'
		);
	});

	it('has no third-party runtime dependencies', () => {
		const violations = [];

		for (const file of files) {
			for (const target of requiresOf(file)) {
				if (target.startsWith('.')) continue;
				const builtin = NODE_BUILTINS.has(target) || target.startsWith('node:');
				if (!builtin) violations.push(`${path.relative(ROOT, file)} -> ${target}`);
			}
		}

		assert.deepStrictEqual(
			violations,
			[],
			`third-party imports found:\n  ${violations.join('\n  ')}\n` +
			'This unit is intentionally dependency-free so it ports without an install.'
		);
	});

	it('declares no dependencies in package.json, matching the code', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		assert.deepStrictEqual(pkg.dependencies, {});
		assert.deepStrictEqual(pkg.devDependencies, {});
	});

	it('ships the documentation a port depends on', () => {
		['README.md', 'CLAUDE.md', 'package.json', 'index.js'].forEach((name) => {
			assert.ok(fs.existsSync(path.join(ROOT, name)), `${name} is missing`);
		});
	});

	it('carries its own fixtures, so tests need no network after a move', () => {
		const dir = path.join(ROOT, 'test', 'fixtures');
		assert.ok(fs.existsSync(dir), 'test/fixtures is missing');
		const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.geojson'));
		assert.ok(fixtures.length >= 4, `expected the captured fixtures, found ${fixtures.length}`);
	});

	it('is runnable straight from the folder after a copy', () => {
		// The entry points a new host (or a fresh clone) relies on. If any of these
		// paths change, README's move instructions are wrong.
		['index.js', 'bin/cli.js', 'bin/inspect.js', 'src/crawl.js', 'src/sources/index.js'].forEach((rel) => {
			assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is missing`);
		});

		const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
		assert.strictEqual(pkg.main, 'index.js');
		assert.ok(pkg.scripts && pkg.scripts.test, 'package.json needs a test script');
		// Node built-in `fetch` is what makes the unit dependency-free; a host on an
		// older runtime must inject its own `http`.
		assert.ok(pkg.engines && pkg.engines.node, 'package.json should state its Node requirement');
	});
});
