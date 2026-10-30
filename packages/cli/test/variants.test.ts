/**
 * v5.9 `hacd findings --variants`: the budget of the records under alternative mechanism sets (the checkpoint-policy variants
 * C-YOUNG / C-MEM) is written to results.json as `variants` and rendered as Appendix A of the Findings page; the main tables are
 * unchanged. One record at one scale with few windows and the committed Shapley study reused.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const MAIN = join(here, '..', 'src', 'main.ts');
const hacd = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: REPO });

describe('hacd findings --variants', () => {
  it('writes the appendix variants to the sidecar and renders Appendix A', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-variants-'));
    const studyDir = join(REPO, 'docs', 'backup', 'arch-mechanism-shapley');
    const r = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--study-dir', studyDir, '--reuse-studies', '--variants', 'remap-latest-2026-10--young,remap-latest-2026-10--cmem', '--out', dir, '--no-methodology']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('variant remap-latest-2026-10--young a3server 10000');
    const results = JSON.parse(readFileSync(join(dir, 'data', 'results.json'), 'utf8'));
    expect(results.variants.map((v: { id: string }) => v.id)).toEqual(['remap-latest-2026-10--young', 'remap-latest-2026-10--cmem']);
    const young = results.variants[0], cmem = results.variants[1];
    expect(young.added).toEqual(['C-YOUNG']);
    expect(cmem.added).toEqual(['C-MEM']);
    expect(cmem.removed).toEqual(['C-FAST']);
    const row = young.archs.a3server[0];
    expect(row.npus).toBe(10000);
    expect(row.today.deltaS).toBe(1.5);
    expect(row.today.tauS).toBeGreaterThan(60);
    expect(row.required.B).toBeGreaterThan(0);
    // the main tables are the default set's: C-FAST's fixed 60 s / 1.5 s saves, B ≤ 0 (v5.6 finding)
    expect(results.archs.a3server.sizes['10000'].today.kpiDerated.tauS).toBe(60);
    expect(results.archs.a3server.sizes['10000'].required.B).toBeLessThan(0);
    expect(JSON.parse(readFileSync(join(dir, 'data', 'provenance.json'), 'utf8')).options.variants).toEqual(['remap-latest-2026-10--young', 'remap-latest-2026-10--cmem']);
    const page = join(dir, 'ASCEND_ALLOCATION_FINDINGS_A3SERVER.html');
    expect(existsSync(page)).toBe(true);
    const html = readFileSync(page, 'utf8');
    expect(html).toContain('Appendix A1: the goal under another checkpoint policy');
    expect(html).toContain('附录 A2：目标在另一种检查点策略下的可达性');
    expect(html).toContain('remap-latest-2026-10--cmem');
    expect(html).not.toContain('undefined');
  }, 600_000);
  it('refuses the appendix on the A_op basis and the report’s own set as a variant', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-variants-'));
    const bad = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--metric', 'aOp', '--variants', 'remap-latest-2026-10--young', '--out', dir]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('effective-goodput basis');
    const same = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--study-dir', join(REPO, 'docs', 'backup', 'arch-mechanism-shapley'), '--reuse-studies', '--variants', 'remap-latest-2026-10', '--out', dir]);
    expect(same.status).toBe(1);
    expect(same.stderr).toContain("the report's own set");
  }, 600_000);
});
