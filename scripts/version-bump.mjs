#!/usr/bin/env node
// One command for a version bump of the workspace, and the check that every copy of the version agrees.
//
//   node scripts/version-bump.mjs <version>    sets the version everywhere (exact `@hac-d/*` specs included)
//   node scripts/version-bump.mjs --check      verifies that everything agrees with the root package.json; exit 1 otherwise
//
// Touched: the root package.json; every workspace package.json (its version and its exact `@hac-d/*` dependency specs);
// package-lock.json (top-level version, the root entry, each workspace entry and its `@hac-d/*` specs); CORE_VERSION in
// packages/core/src/index.ts; the report kit's default engine in packages/reports/src/content.mjs. JSON files are rewritten
// with npm's own formatting (two spaces, trailing newline), so the diff is the changed lines alone.
//
// Why the specs matter (v5.9, 2026-10-30): the workspace packages are not on the npm registry. A spec `"@hac-d/core": "0.5.0"`
// beside a package at 0.5.9 no longer matches the workspace, so a clean `npm ci` asks the registry and fails with 404 — the
// first CI run of v5.9 did exactly that. The local node_modules symlinks hide it; the check does not.
//
// The committed report pages keep the engine version of the run that produced them (the sidecar's provenance) until the set is
// regenerated, so `node packages/reports/test/reproduce.mjs` stays byte for byte after a bump.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = 'package-lock.json';
const CORE_INDEX = 'packages/core/src/index.ts';
const CONTENT = 'packages/reports/src/content.mjs';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const stringify = (obj) => JSON.stringify(obj, null, 2) + '\n';

/** Workspace directories (relative, forward slashes) from the root package.json patterns `dir/*` or exact paths. */
function workspaceDirs(rootPkg) {
  const dirs = [];
  for (const pattern of rootPkg.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(ROOT, parent))) continue;
      for (const name of readdirSync(join(ROOT, parent)).sort()) {
        const dir = join(parent, name);
        if (statSync(join(ROOT, dir)).isDirectory() && existsSync(join(ROOT, dir, 'package.json'))) dirs.push(dir);
      }
    } else if (existsSync(join(ROOT, pattern, 'package.json'))) {
      dirs.push(pattern);
    }
  }
  return dirs.map((d) => relative(ROOT, resolve(ROOT, d)).split('\\').join('/'));
}

/** Every place that holds a version: [{ file, path, get(), set(v) }] over the parsed documents. */
function sites() {
  const rootPkg = readJson('package.json');
  const dirs = workspaceDirs(rootPkg);
  const pkgs = Object.fromEntries(dirs.map((d) => [d, readJson(`${d}/package.json`)]));
  const names = new Set(Object.values(pkgs).map((p) => p.name));
  const lock = readJson(LOCK);
  const docs = { 'package.json': rootPkg, [LOCK]: lock, ...Object.fromEntries(dirs.map((d) => [`${d}/package.json`, pkgs[d]])) };
  const list = [];
  const prop = (file, obj, key, path) => list.push({ file, path, get: () => obj[key], set: (v) => { obj[key] = v; } });
  const deps = (file, obj, prefix) => {
    for (const field of DEP_FIELDS) {
      const block = obj?.[field];
      if (!block) continue;
      for (const name of Object.keys(block)) if (names.has(name)) prop(file, block, name, `${prefix}${field}.${name}`);
    }
  };
  prop('package.json', rootPkg, 'version', 'version');
  for (const d of dirs) {
    prop(`${d}/package.json`, pkgs[d], 'version', 'version');
    deps(`${d}/package.json`, pkgs[d], '');
  }
  prop(LOCK, lock, 'version', 'version');
  if (!lock.packages?.['']) throw new Error(`${LOCK}: no root entry (lockfileVersion ${lock.lockfileVersion})`);
  prop(LOCK, lock.packages[''], 'version', 'packages[""].version');
  for (const d of dirs) {
    const entry = lock.packages[d];
    if (!entry) throw new Error(`${LOCK}: no entry for workspace ${d}`);
    prop(LOCK, entry, 'version', `packages["${d}"].version`);
    deps(LOCK, entry, `packages["${d}"].`);
  }
  // Source constants: one regular expression each, exactly one match required.
  const constant = (file, re, label) => {
    const text = readText(file);
    const matches = [...text.matchAll(re)];
    if (matches.length !== 1) throw new Error(`${file}: expected one ${label}, found ${matches.length}`);
    list.push({
      file, path: label, text,
      get: () => matches[0][2],
      set(v) { this.text = text.replace(re, `$1${v}$3`); },
    });
  };
  constant(CORE_INDEX, /(export const CORE_VERSION = ')([^']*)(';)/g, 'CORE_VERSION');
  constant(CONTENT, /(^\s*engine: ')([^']*)(',)/gm, 'engine default');
  return { rootPkg, docs, list };
}

function check() {
  const { rootPkg, list } = sites();
  const want = rootPkg.version;
  const wrong = list.filter((s) => s.get() !== want);
  for (const s of wrong) console.log(`  ${s.file}: ${s.path} = ${s.get()}  (expected ${want})`);
  if (wrong.length) {
    console.log(`version check: ${wrong.length} of ${list.length} sites differ from ${want}; run \`node scripts/version-bump.mjs ${want}\``);
    process.exit(1);
  }
  console.log(`version check: ${list.length} sites agree on ${want}`);
}

function bump(version) {
  if (!VERSION_RE.test(version)) throw new Error(`not a version: ${version}`);
  const { docs, list } = sites();
  let changed = 0;
  for (const s of list) if (s.get() !== version) { s.set(version); changed++; }
  for (const [file, obj] of Object.entries(docs)) {
    const out = stringify(obj);
    if (out !== readText(file)) { writeFileSync(join(ROOT, file), out); console.log(`  wrote ${file}`); }
  }
  for (const s of list) if (s.text !== undefined && s.text !== readText(s.file)) { writeFileSync(join(ROOT, s.file), s.text); console.log(`  wrote ${s.file}`); }
  console.log(`version ${version}: ${changed} of ${list.length} sites changed`);
  if (changed) console.log('next: npm test, then regenerate the report set when its engine version should move; reproduce.mjs stays byte for byte until then');
}

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  console.log('usage: node scripts/version-bump.mjs <version> | --check');
  process.exit(arg ? 0 : 2);
}
if (arg === '--check') check();
else bump(arg);
