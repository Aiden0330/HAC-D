/**
 * v6.4 `hacd scenario …`: the project workflow a program or a model runs — new → set (geometry, target) → fit → mechanisms →
 * show → report — on the real CLI at reduced settings, the report's files and manifest, and the bundle and sidecar re-rendering
 * the same page byte for byte with `hacd findings --data`; the errors name the allowed values; a project bundle keeps its settings.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const MAIN = join(here, '..', 'src', 'main.ts');
const hacd = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, cwd: REPO });
const json = (s: string) => JSON.parse(s);

describe('hacd scenario', () => {
  it('new → set → fit → mechanisms → show → report; the bundle and the sidecar re-render the same page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-scenario-'));
    const f = join(dir, 'project.json');
    let r = hacd(['scenario', 'new', '--template', 'a950-ub2', '--npus', '10000', '--id', 'acme-950-demo', '--name', 'ACME 950 demo', '--out', f, '--json']);
    expect(r.status, r.stderr).toBe(0);
    expect(json(r.stdout).summary).toMatchObject({ id: 'acme-950-demo', template: 'a950-ub2', npus: 10000 });
    r = hacd(['scenario', 'set', f, '--set', 'topology.superpod.nodesPerRack=9', 'targets.operational=0.985', '--json']);
    expect(r.status, r.stderr).toBe(0);
    expect(json(r.stdout).changed).toEqual(['topology.superpod.nodesPerRack', 'targets.operational']);
    r = hacd(['scenario', 'fit', f, '--set', 'CORE-hard=500', '--json']);
    expect(r.status, r.stderr).toBe(0);
    expect(json(r.stdout).summary.fit.overrides['CORE-hard']).toMatchObject({ fit: 500 });
    r = hacd(['scenario', 'mechanisms', f, '--apply', 'D-HARD:detectSeconds=20', '--remove', 'R-ELASTIC', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const m = json(r.stdout);
    expect(m.changed).toEqual(['-R-ELASTIC', '+D-HARD']);
    expect(m.summary.mechanisms.find((x: { id: string }) => x.id === 'D-HARD').parameters.detectSeconds).toBe(20);
    r = hacd(['scenario', 'show', f, '--json']);
    expect(r.status).toBe(0);
    const sum = json(r.stdout).summary;
    expect(sum.topology.superpod.nodesPerRack).toBe(9);
    expect(sum.mechanisms.map((x: { id: string }) => x.id)).not.toContain('R-ELASTIC');
    expect(sum.kpi.aOp).toBeGreaterThan(0.9);
    // the text form prints the same facts
    r = hacd(['scenario', 'show', f]);
    expect(r.stdout).toContain('template a950-ub2 · 10,000 NPUs');
    expect(r.stdout).toContain('8 NPUs × 9 nodes × 16 compute');
    expect(r.stdout).toContain('CORE-hard 500 (library');
    expect(r.stdout).toContain('D-HARD{');
    r = hacd(['scenario', 'report', f, '--out', join(dir, 'out'), '--trials', '40', '--permutations', '8', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const man = json(r.stdout);
    expect(man.status).toBe('ok');
    expect(man.kpi).toHaveLength(1);
    expect(man.kpi[0].scale).toBe(10000);
    expect(man.kpi[0].today.aOp).toBeGreaterThan(0.9);
    expect(man.kpi[0].recommended.mechanisms).toBeInstanceOf(Array);
    expect(man.files.findings).toMatch(/ASCEND_ALLOCATION_FINDINGS_ACME-950-DEMO\.html$/);
    for (const p of [man.files.findings, man.files.methodology, man.files.bundle, join(man.files.data, 'results.json'), join(man.files.data, 'records.json'), join(man.files.data, 'acme-950-demo.json')]) expect(existsSync(p), p).toBe(true);
    const html = readFileSync(man.files.findings, 'utf8');
    expect(html).toContain('<svg class="viz topo"');
    expect(html).toContain('hacd scenario report');
    expect(html).not.toMatch(/\bNaN\b/);
    r = hacd(['findings', '--data', man.files.bundle, '--out', join(dir, 'out2'), '--no-methodology']);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'out2', 'ASCEND_ALLOCATION_FINDINGS_ACME-950-DEMO.html'), 'utf8')).toBe(html);
    r = hacd(['findings', '--data', man.files.data, '--out', join(dir, 'out3'), '--no-methodology']);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'out3', 'ASCEND_ALLOCATION_FINDINGS_ACME-950-DEMO.html'), 'utf8')).toBe(html);
  }, 300_000);

  it('new --record: the public record’s scenario with the default set’s baseline (the web’s built-in projects)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-scenario-'));
    const f = join(dir, 'r.json');
    const r = hacd(['scenario', 'new', '--record', 'a3server', '--npus', '100000', '--id', 'acme-a3-pw', '--name', 'ACME A3 (pw)', '--out', f, '--json']);
    expect(r.status, r.stderr).toBe(0);
    const sum = json(r.stdout).summary;
    expect(sum).toMatchObject({ id: 'acme-a3-pw', name: 'ACME A3 (pw)', template: 'a3-ub384', npus: 100000 });
    expect(sum.topology.superpod).toMatchObject({ computeRacks: 1, commRacks: 0, nodesPerRack: 4 });
    expect(sum.topology.nvlinkDomainGpus).toBe(8);
    expect(sum.mechanisms.map((m: { id: string }) => m.id).sort()).toEqual(['C-FAST', 'D-SDC', 'R-ELASTIC', 'R-PROCESS', 'R-REPLAY', 'R-SDC']);
    expect(hacd(['scenario', 'new', '--record', 'nope', '--npus', '1000', '--out', join(dir, 'x.json')]).status).toBe(1);
  }, 120_000);

  it('errors name what is allowed; a project bundle keeps its settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-scenario-'));
    const f = join(dir, 'p.json');
    expect(hacd(['scenario', 'new', '--template', 'a950-ub2', '--npus', '1000', '--out', f]).status).toBe(0);
    let r = hacd(['scenario', 'set', f, '--set', 'topology.superpod.bogus=1']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown field 'topology.superpod.bogus'");
    r = hacd(['scenario', 'fit', f, '--set', 'NOPE-hard=1']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown fault type');
    r = hacd(['scenario', 'mechanisms', f, '--apply', 'D-HARD:nope=1']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no parameter 'nope'");
    r = hacd(['scenario', 'show']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('a project file is required');
    r = hacd(['scenario', 'fields', f, '--json']);
    expect(r.status).toBe(0);
    const v = json(r.stdout);
    expect(v.fields.some((x: { path: string }) => x.path === 'topology.superpod.nodesPerRack')).toBe(true);
    expect(v.classes.some((x: { id: string }) => x.id === 'CORE-hard')).toBe(true);
    // a bundle: the web's export form
    const b = join(dir, 'p.hacd.json');
    writeFileSync(b, JSON.stringify({ version: 'hacd-project-1', scenario: json(readFileSync(f, 'utf8')), settings: { topology: { tab: 'hardware', carry: true } } }));
    r = hacd(['scenario', 'set', b, '--set', 'npus=2000', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const back = json(readFileSync(b, 'utf8'));
    expect(back.version).toBe('hacd-project-1');
    expect(back.settings.topology.tab).toBe('hardware');
    expect(back.scenario.workload.nGpus).toBe(2000);
  }, 120_000);
});
