/**
 * v6.1 `hacd ingest operate` with the mock on-prem model (docs/markdown/AGENT_OPERATOR.md §8): the reference host runs the mock
 * (scripts/mock-onprem-model.mjs, an OpenAI-compatible server with scripted answers) on the synthetic pilot inputs of
 * test/fixtures/pilot — the ok path (documents → worksheets → run → report), the deliberate-error path (a public id, an unknown
 * class, an empty source: fixed by the fix table in two rounds) and the unfixable path (an unknown count row: reported, not
 * worked around). Reduced settings (10k NPUs, 40 windows, 10 permutations); the real pilot uses the report preset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const MAIN = join(here, '..', 'src', 'main.ts');
const FIX = join(here, 'fixtures', 'pilot');
const hacd = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: REPO });
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const copyDir = (from: string, to: string) => { mkdirSync(to, { recursive: true }); for (const f of readdirSync(from)) copyFileSync(join(from, f), join(to, f)); };

let mock: ChildProcess;
let url = '';

beforeAll(async () => {
  mock = spawn(process.execPath, [join(REPO, 'scripts', 'mock-onprem-model.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('mock model did not start')), 15_000);
    mock.stdout!.on('data', (d: Buffer) => { const m = /listening (\S+)/.exec(d.toString()); if (m) { clearTimeout(t); resolve(m[1]); } });
    mock.on('exit', (code) => reject(new Error(`mock model exited with ${code}`)));
  });
});
afterAll(() => { mock?.kill(); });

const REDUCED = ['--before-record', 'a3server', '--scales', '10000', '--trials', '40', '--permutations', '10', '--lang', 'en', '--max-steps', '40'];

describe('hacd ingest operate with the mock on-prem model', () => {
  it('ok path: four documents → worksheets → one run → report, final message in the required format', () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-operate-ok-'));
    const docs = ['acme-a3-design-note-2026q3.md', 'acme-fit-2026q3.csv', 'acme-koujing-mapping-2026q3.csv', 'acme-mechanisms-2026q3.md'].flatMap((f) => ['--docs', join(FIX, 'internal', f)]);
    const r = hacd(['ingest', 'operate', '--base-url', url, '--model', 'mock-onprem', '--work', work, ...docs, '--brief', join(FIX, 'internal', 'brief.md'), ...REDUCED]);
    expect(r.stderr).toContain('final:');
    expect(r.status).toBe(0);
    // the final message: status, the run command, the KPI table, the warnings, the paths — nothing invented
    expect(r.stdout).toMatch(/^status: ok\n/);
    expect(r.stdout).toContain('run: hacd ingest run --worksheets');
    expect(r.stdout).toContain('KPI (SUMMARY.md):');
    expect(r.stdout).toMatch(/\| 10000 \| \d+\.\d+ % \/ \d+\.\d+ % \|/);
    expect(r.stdout).toContain('unresolved issues: none');
    expect(r.stdout).toContain('(acme-fit-2026q3.json: override.rates.OPT-hard@roce.fit, implausible)');
    expect(r.stdout).toContain(`paths: run.json ${join(work, 'out')}/run.json`);
    // the host's record of the session
    const res = readJson(join(work, 'operator-result.json'));
    expect(res.stopped).toBe('final');
    expect(res.lastRun).toEqual({ status: 'ok', exitCode: 0 });
    expect(res.writes.every((p: string) => p.startsWith(join(work, 'ws') + '/'))).toBe(true);
    expect(res.writes.map((p: string) => p.slice(work.length + 1)).sort()).toEqual(['ws/koujing-mapping.md', 'ws/mechanisms.md', 'ws/topology.md']);
    const cmds = res.commands as string[][];
    expect(cmds.map((c) => c.slice(0, 2).join(' '))).toEqual(['ingest template', 'ingest template', 'ingest import-fit', 'ingest normalize', 'ingest extract', 'ingest run']);
    expect(cmds.every((c) => !c.includes('--force') && !c.includes('--promote') && !c.includes('--data'))).toBe(true);
    expect(existsSync(join(work, 'operator-log.jsonl'))).toBe(true);
    // the pipeline's own manifest and outputs
    const m = readJson(join(work, 'out', 'run.json'));
    expect(m.status).toBe('ok');
    expect(m.steps.map((s: { name: string }) => s.name)).toEqual(['worksheets', 'validate', 'dry-run', 'diff', 'findings']);
    expect(m.inputs.record.id).toBe('acme-a3-2026q3');
    expect(m.inputs.rates.id).toBe('acme-fit-2026q3');
    expect(m.inputs.set.id).toBe('acme-mech-2026q3');
    expect(m.kpi).toHaveLength(1);
    expect(m.kpi[0].scale).toBe(10000);
    expect(m.report.files).toContain('ASCEND_ALLOCATION_FINDINGS_ACME-A3-2026Q3.html');
    expect(m.delta.files).toContain('delta.html');
    // the records the worksheets became: the invented geometry, the normalised override, the mechanism delta
    const rec = readJson(join(work, 'staging', 'records', 'acme-a3-2026q3.json'));
    expect(rec.template).toBe('a3-ub384');
    expect(rec.family).toBe('910C');
    expect(rec.superpod).toMatchObject({ base: 'cloudmatrix384', npusPerNode: 8, cpusPerNode: 4, nodesPerRack: 3, computeRacks: 1, commRacks: 0, l2PerSubPlane: 0, linksPerL1: 0 });
    expect(rec.domainNpus).toBe(8);
    expect(rec.scaleOut).toMatchObject({ portsPerNpu: 2, planes: 2, radix: 128, oversubscription: 1, transceiversPerLink: 2 });
    expect(rec.layers).toEqual({ superpod: { unit: 'nodes', npus: 8 }, cabinet: { npus: 24 }, node: { npus: 8 } });
    expect(rec.provenance['superpod.nodesPerRack']).toMatchObject({ confidence: 'vendor', note: 'A cabinet holds 3 servers' });
    const rates = readJson(join(work, 'staging', 'fault-rates', 'acme-fit-2026q3.json'));
    expect(Object.keys(rates.rates)).toHaveLength(14);
    expect(rates.rates['MEMT-hard']).toMatchObject({ unit: 'npu', fit: 384, confidence: 'derived' });
    expect(rates.rates['OPT-hard@roce'].fit).toBe(120);
    const set = readJson(join(work, 'staging', 'mechanism-sets', 'acme-mech-2026q3.json'));
    expect(set.parameters['D-HARD'].detectSeconds).toBe(20);
    expect(set.parameters['R-REPLAY'].success).toBe(0.92);
    // extraction: every card grounded, none disputed
    expect(readJson(join(work, 'ws', 'extract', 'disputed.json'))).toEqual([]);
    expect(readJson(join(work, 'ws', 'extract', 'rejected.json'))).toEqual([]);
    expect(readJson(join(work, 'ws', 'extract', 'cards.json'))).toHaveLength(21);
  });

  it('deliberate errors: an empty source, a public id and an unknown class are fixed by the fix table in two rounds', () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-operate-err-'));
    copyDir(join(FIX, 'errors', 'ws'), join(work, 'ws'));
    const r = hacd(['ingest', 'operate', '--base-url', url, '--model', 'mock-onprem', '--work', work, '--docs', join(FIX, 'internal', 'acme-fit-2026q3.csv'), '--brief', join(FIX, 'errors', 'brief.md'), ...REDUCED]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^status: ok\n/);
    const res = readJson(join(work, 'operator-result.json'));
    const runs = (res.commands as string[][]).filter((c) => c[1] === 'run');
    expect(runs).toHaveLength(3);
    expect((res.commands as string[][]).some((c) => c[1] === 'fields' && c[2] === 'fault-rates')).toBe(true);
    expect(res.writes.every((p: string) => p.startsWith(join(work, 'ws') + '/'))).toBe(true);
    const topo = readFileSync(join(work, 'ws', 'topology.md'), 'utf8');
    expect(topo).toContain('\nid: acme-a3-2026q3\n');
    expect(topo).not.toContain('id: a3server');
    const rates = readFileSync(join(work, 'ws', 'fault-rates.md'), 'utf8');
    expect(rates).toContain('| MEMT-hard');
    expect(rates).not.toContain('HBM-hard');
    expect(rates).toMatch(/\| POWER-hard +\| cabinet +\| 6000 +\| acme-fit-2026q3\.csv \(data owner's worksheet\)/);
    // the stale staged record of the public id is gone (the run cleans the previous conversion's outputs)
    expect(readdirSync(join(work, 'staging', 'records'))).toEqual(['acme-a3-2026q3.json']);
    expect(readJson(join(work, 'out', 'run.json')).status).toBe('ok');
  });

  it('an error the fix table does not resolve is reported with its path and code; nothing is written or promoted', () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-operate-unfix-'));
    copyDir(join(FIX, 'unfixable', 'ws'), join(work, 'ws'));
    const r = hacd(['ingest', 'operate', '--base-url', url, '--model', 'mock-onprem', '--work', work, '--brief', join(FIX, 'unfixable', 'brief.md'), ...REDUCED]);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/^status: needs-input/);
    expect(r.stdout).toContain('unresolved issues: (acme-a3-2026q3.json: record.countOverrides.foo, unknown-count-row)');
    const res = readJson(join(work, 'operator-result.json'));
    expect(res.lastRun).toEqual({ status: 'needs-input', exitCode: 2 });
    expect(res.writes).toEqual([]);
    expect((res.commands as string[][]).filter((c) => c[1] === 'run')).toHaveLength(1);
  });

  it('project workflow: the model changes the topology, a FIT and the mechanisms of a project and produces its report through the host', () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-operate-project-'));
    const task = ['Project workflow: template a950-ub2, npus 10000, id acme-950-demo, name "ACME 950 demo".', 'Set: topology.superpod.nodesPerRack=9; targets.operational=0.985', 'FIT: CORE-hard=500', 'Mechanisms: apply D-HARD:detectSeconds=20; remove R-ELASTIC', 'Report: scales 10000; trials 40; permutations 8'].join('\n');
    const r = hacd(['ingest', 'operate', '--base-url', url, '--model', 'mock-onprem', '--work', work, '--lang', 'en', '--max-steps', '20', '--task', task]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^status: ok\n/);
    expect(r.stdout).toMatch(/mechanisms applied: .*D-HARD/);
    expect(r.stdout).not.toMatch(/mechanisms applied: .*R-ELASTIC/);
    expect(r.stdout).toContain('changes: (topology.superpod.nodesPerRack, 9, task); (targets.operational, 0.985, task); (fit CORE-hard, 500, task); (apply D-HARD:detectSeconds=20, task); (remove R-ELASTIC, task)');
    expect(r.stdout).toMatch(/\| 10000 \| \d+\.\d+ % \/ \d+\.\d+ % \|/);
    const res = readJson(join(work, 'operator-result.json'));
    expect(res.stopped).toBe('final');
    expect((res.commands as string[][]).map((c) => c.slice(0, 2).join(' '))).toEqual(['scenario new', 'scenario fields', 'scenario set', 'scenario fit', 'scenario mechanisms', 'scenario show', 'scenario report']);
    expect(res.lastRun).toEqual({ status: 'ok', exitCode: 0 });
    // the model wrote no file itself: HAC-D wrote the project and the report
    expect(res.writes).toEqual([]);
    const p = readJson(join(work, 'project', 'acme-950-demo.json'));
    expect(p.topology.superpod.nodesPerRack).toBe(9);
    expect(p.targets.operational).toBe(0.985);
    expect(p.mechanisms.applied['D-HARD'].parameters.detectSeconds).toBe(20);
    expect(p.mechanisms.applied['R-ELASTIC']).toBeUndefined();
    expect(existsSync(join(work, 'out', 'ASCEND_ALLOCATION_FINDINGS_ACME-950-DEMO.html'))).toBe(true);
    expect(existsSync(join(work, 'out', 'acme-950-demo-findings-data.json'))).toBe(true);
  });

  it('refuses to start without the endpoint, the model or the work folder', () => {
    const r = hacd(['ingest', 'operate', '--model', 'x']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage: hacd ingest operate');
  });
});
