/**
 * v6.1 `hacd ingest run`: the whole input pipeline as one call for a program or an on-prem model (docs/markdown/AGENT_OPERATOR.md).
 * Spawns the real CLI on the example worksheets of `hacd ingest template`: the ok path (worksheets → validate → dry-run → diff →
 * findings with run.json + SUMMARY.md, exit 0) and the needs-input path (a public id → exit 2, the issue named in the manifest).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = join(here, '..', 'src', 'main.ts');
const hacd = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: join(here, '..', '..', '..') });
const template = (kind: string) => { const r = hacd(['ingest', 'template', kind]); expect(r.status).toBe(0); return r.stdout; };

describe('hacd ingest run', () => {
  it('runs worksheets → validate → dry-run → diff → findings in one call and writes run.json + SUMMARY.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-run-'));
    mkdirSync(join(dir, 'ws'));
    writeFileSync(join(dir, 'ws', 'topology.md'), template('topology'));
    writeFileSync(join(dir, 'ws', 'mechanisms.md'), template('mechanisms'));
    const r = hacd(['ingest', 'run', '--worksheets', join(dir, 'ws'), '--staging', join(dir, 'staging'), '--before-record', 'native950', '--scales', '10000', '--trials', '40', '--permutations', '10', '--out', join(dir, 'out'), '--json']);
    expect(r.status).toBe(0);
    const m = JSON.parse(readFileSync(join(dir, 'out', 'run.json'), 'utf8'));
    expect(m.status).toBe('ok');
    expect(m.steps.map((s: { name: string }) => s.name)).toEqual(['worksheets', 'validate', 'dry-run', 'diff', 'findings']);
    expect(m.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
    expect(m.inputs.record.id).toBe('internal-example-950');
    expect(m.inputs.set.id).toBe('example-mechanisms-delta');
    expect(m.kpi).toHaveLength(1);
    expect(m.kpi[0].scale).toBe(10000);
    expect(m.kpi[0].aOp).toBeGreaterThan(0.99);
    expect(m.report.files).toContain('ASCEND_ALLOCATION_FINDINGS_INTERNAL-EXAMPLE-950.html');
    expect(existsSync(join(dir, 'out', 'report', 'data', 'results.json'))).toBe(true);
    expect(readdirSync(join(dir, 'out', 'delta'))).toContain('delta.html');
    expect(m.promoted).toEqual([]);
    const summary = readFileSync(join(dir, 'out', 'SUMMARY.md'), 'utf8');
    expect(summary).toContain('# hacd ingest run — ok (exit 0)');
    expect(summary).toContain('internal-example-950');
    // the --json echo on stdout is the manifest
    const echoed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(echoed.status).toBe('ok');
  });

  it('stops with exit 2 and names the issue when a worksheet carries a public id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-run-bad-'));
    mkdirSync(join(dir, 'ws'));
    writeFileSync(join(dir, 'ws', 'topology.md'), template('topology').replace(/^id: internal-example-950$/m, 'id: native950'));
    const r = hacd(['ingest', 'run', '--worksheets', join(dir, 'ws'), '--staging', join(dir, 'staging'), '--scales', '10000', '--trials', '40', '--out', join(dir, 'out')]);
    expect(r.status).toBe(2);
    const m = JSON.parse(readFileSync(join(dir, 'out', 'run.json'), 'utf8'));
    expect(m.status).toBe('needs-input');
    expect(m.steps.map((s: { name: string }) => s.name)).toEqual(['worksheets', 'validate']);
    const errors = m.steps[1].issues.filter((i: { level: string }) => i.level === 'error');
    expect(errors.map((i: { code: string }) => i.code)).toContain('id-collision');
    expect(errors[0].path).toContain('record.id');
    expect(m.report).toBeNull();
    expect(m.nextAction.en).toMatch(/fix the worksheet row/);
  });

  it('prints the operator protocol and the tool manifest', () => {
    const en = hacd(['ingest', 'protocol', '--lang', 'en']);
    expect(en.status).toBe(0);
    expect(en.stdout).toContain('hacd ingest run');
    const tools = hacd(['ingest', 'protocol', '--tools']);
    expect(tools.status).toBe(0);
    const j = JSON.parse(tools.stdout);
    expect(j.tools.map((t: { name: string }) => t.name)).toContain('hacd_ingest_run');
  });
});
