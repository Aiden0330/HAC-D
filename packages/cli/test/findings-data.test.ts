/**
 * v6.3 `hacd findings --data` with the sidecar bundle file the web app's Report tab downloads (results, mechanisms, provenance,
 * studies and records in one JSON): rendered from the committed sidecar of docs/backup/ascend-allocation wrapped as a bundle, the
 * Findings page equals the committed docs/ASCEND_ALLOCATION_FINDINGS_950.html byte for byte (the folder form is what
 * packages/reports/test/reproduce.mjs checks).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const MAIN = join(here, '..', 'src', 'main.ts');
const hacd = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: REPO });
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('hacd findings --data <bundle.json>', () => {
  it('renders the Findings page of a record from the bundle exactly as from the sidecar folder', () => {
    const DATA = join(REPO, 'docs', 'backup', 'ascend-allocation');
    const mechanisms = json(join(DATA, 'mechanisms.json'));
    const studyDir = mechanisms.source?.dir ? join(REPO, mechanisms.source.dir) : join(REPO, 'docs', 'backup', 'arch-mechanism-shapley');
    const studyFile = existsSync(join(DATA, 'native950.json')) ? join(DATA, 'native950.json') : join(studyDir, 'native950.json');
    const bundle = { results: json(join(DATA, 'results.json')), mechanisms, provenance: json(join(DATA, 'provenance.json')), studies: { native950: json(studyFile) }, records: json(join(DATA, 'records.json')) };
    const dir = mkdtempSync(join(tmpdir(), 'hacd-findings-data-'));
    const file = join(dir, 'native950-findings-data.json');
    writeFileSync(file, JSON.stringify(bundle));
    const r = hacd(['findings', '--data', file, '--record', 'native950', '--out', join(dir, 'out'), '--no-methodology']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('written');
    const got = readFileSync(join(dir, 'out', 'ASCEND_ALLOCATION_FINDINGS_950.html'), 'utf8');
    expect(got).toBe(readFileSync(join(REPO, 'docs', 'ASCEND_ALLOCATION_FINDINGS_950.html'), 'utf8'));
  }, 120_000);
  it('refuses a bundle without provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-findings-data-'));
    const file = join(dir, 'x.json');
    writeFileSync(file, JSON.stringify({ results: {}, mechanisms: {} }));
    const r = hacd(['findings', '--data', file, '--out', join(dir, 'out')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no provenance');
  });
});
