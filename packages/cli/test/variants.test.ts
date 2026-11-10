/**
 * v5.9 `hacd findings --variants`: the budget of the records under alternative mechanism sets (the checkpoint-policy variants
 * C-YOUNG / C-MEM, v5.10 C-YOUNG with the delivered-only mechanisms applied) is written to results.json as `variants` and rendered as
 * Appendix A of the Findings page; the main tables are unchanged. One record at one scale with few windows and the committed Shapley
 * study reused.
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
  it('writes the appendix variants to the sidecar and renders Appendix A (the goodput basis of v5.6–v5.11, --metric effective)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-variants-'));
    const studyDir = join(REPO, 'docs', 'backup', 'arch-mechanism-shapley');
    const r = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--metric', 'effective', '--study-dir', studyDir, '--reuse-studies', '--variants', 'remap-latest-2026-10--young,remap-latest-2026-10--cmem,remap-latest-2026-10--young-sdc', '--out', dir, '--no-methodology']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('variant remap-latest-2026-10--young a3server 10000');
    const results = JSON.parse(readFileSync(join(dir, 'data', 'results.json'), 'utf8'));
    expect(results.variants.map((v: { id: string }) => v.id)).toEqual(['remap-latest-2026-10--young', 'remap-latest-2026-10--cmem', 'remap-latest-2026-10--young-sdc']);
    const young = results.variants[0], cmem = results.variants[1], sdc = results.variants[2];
    expect(young.added).toEqual(['C-YOUNG']);
    expect(cmem.added).toEqual(['C-MEM']);
    expect(cmem.removed).toEqual(['C-FAST']);
    expect(sdc.added).toEqual(['C-YOUNG', 'D-SDC-FP8', 'D-SDC-FP4', 'D-ABFT', 'D-NET-SDC', 'H-SDC-SCREEN']);
    expect(sdc.removed).toEqual([]);
    expect(sdc.archs.a3server[0].recommended.delivered).toBeGreaterThan(young.archs.a3server[0].recommended.delivered);
    const row = young.archs.a3server[0];
    expect(row.npus).toBe(10000);
    expect(row.today.deltaS).toBe(1.5);
    expect(row.today.tauS).toBeGreaterThan(60);
    expect(row.required.B).toBeGreaterThan(0);
    // v5.12 (D1 / D2) under C-YOUNG the requirement is the engine's hardware-only root: no loss end, the MTBF end from the root
    expect(row.required.interval).toBe('optimised');
    expect(row.required.reachable).toBe(true);
    expect(row.required.mttrAtTodayMtbfS).toBeNull();
    expect(cmem.archs.a3server[0].required.interval).toBeUndefined();
    // the main tables are the default set's: C-FAST's fixed 60 s / 1.5 s saves, B ≤ 0 (v5.6 finding)
    expect(results.archs.a3server.sizes['10000'].today.kpiDerated.tauS).toBe(60);
    expect(results.archs.a3server.sizes['10000'].required.B).toBeLessThan(0);
    expect(JSON.parse(readFileSync(join(dir, 'data', 'provenance.json'), 'utf8')).options.variants).toEqual(['remap-latest-2026-10--young', 'remap-latest-2026-10--cmem', 'remap-latest-2026-10--young-sdc']);
    const page = join(dir, 'ASCEND_ALLOCATION_FINDINGS_A3SERVER.html');
    expect(existsSync(page)).toBe(true);
    const html = readFileSync(page, 'utf8');
    expect(html).toContain('Appendix A1: the goal under another checkpoint policy');
    expect(html).toContain('附录 A2：目标在另一种检查点策略下的可达性');
    expect(html).toContain('remap-latest-2026-10--cmem');
    expect(html).not.toContain('undefined');
    // v5.10 the page of the delivered-only mechanisms, its comparison with the Young variant, and what the main tables' G_del covers
    expect(html).toContain('Appendix A3: the goal and the delivered goodput with the delivered-only mechanisms applied');
    expect(html).toContain('附录 A3：应用只保交付 goodput 的机制时的目标与交付 goodput');
    expect(html).toContain('only the reference set differs');
    expect(html).toContain('Against Appendix A1 at');
    expect(html).toContain('Appendix A3 shows them applied');
    expect(html).toContain('not applied in the designs of Tables 1–5');
    expect(html).not.toContain('kept, outside');
    // v5.10 the parameters as written (the integer format printed 0.5 s as 1 and a 1 % overhead as 0)
    expect(html).toContain('saveSeconds 0.5 → 0.75');
    expect(html).toContain('overhead 0.01 → 0.015');
    expect(html).toContain('overhead 0.001 → 0.0015');
    // v5.12 (D1) the requirement cell of a C-YOUNG row names the engine's root, never "B ≤ 0: out of reach by hardware alone"
    expect(html).toContain('the engine’s root');
  }, 600_000);
  it('v5.12 the default basis is A_op: the three-target page with the tiers, the field-level case and an appendix on that basis', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-variants-'));
    const studyDir = join(REPO, 'docs', 'backup', 'arch-mechanism-shapley');
    const r = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--study-dir', studyDir, '--reuse-studies', '--field-rates', 'field-llama3-2026-11', '--variants', 'remap-latest-2026-10--cmem', '--delivered-floor', '0.95', '--out', dir, '--no-methodology']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('A_op ≥ 0.985');
    expect(r.stderr).toContain('field case a3server 10000');
    const results = JSON.parse(readFileSync(join(dir, 'data', 'results.json'), 'utf8'));
    expect(results.metric).toBe('aOp');
    expect(results.floors).toEqual({ effective: 0.97, delivered: 0.95 });
    const z = results.archs.a3server.sizes['10000'];
    expect(z.required.metric).toBe('aOp');
    expect(z.recommended.feasible).toBe(true);
    expect(z.recommended.tiers.checkpoint.basis).toBe('young');
    expect(z.recommended.tiers.delivered.floor).toBe(0.95);
    expect(z.recommended.tiers.delivered.withDetectors.mechanisms).toEqual(['D-SDC-FP8', 'D-SDC-FP4', 'D-ABFT', 'D-NET-SDC', 'H-SDC-SCREEN']);
    expect(z.recommended.windowDerated.trials).toBe(40);
    expect(z.spares.nodes).toBe(1250);
    expect(z.recoveryScale).toBeNull();
    // the field case: the same plan needs no move at 10k, so the allowed FIT per NPU is the catalog's (the requirement is absolute)
    const fc = results.fieldCase;
    expect(fc.id).toBe('field-llama3-2026-11');
    const f = fc.archs.a3server[0];
    expect(f.today.hardFitPerNpu / z.hardFitPerNpuTotal).toBeGreaterThan(5.5);
    expect(f.recommended.feasible).toBe(true);
    if (!f.recommended.mechanisms.length && !f.recommended.levers.length && !z.recommended.mechanisms.length && !z.recommended.levers.length) expect(f.recommended.allowedFitPerNpu / (z.recommended.k * z.hardFitPerNpuTotal)).toBeCloseTo(1, 1);
    const v = results.variants[0];
    expect(v.metric).toBe('aOp');
    expect(v.archs.a3server[0].recommended.tiers.checkpoint.deltaS.nominal).toBe(0.5);
    const prov = JSON.parse(readFileSync(join(dir, 'data', 'provenance.json'), 'utf8')).options;
    expect(prov.metric).toBe('aOp');
    expect(prov.fieldRates).toBe('field-llama3-2026-11');
    expect(prov.deliveredFloor).toBe(0.95);
    const html = readFileSync(join(dir, 'ASCEND_ALLOCATION_FINDINGS_A3SERVER.html'), 'utf8');
    for (const s of ['Table 7: The checkpoint tier', 'Table 8: The delivered tier', 'Table 9: What the failure-rate basis changes', '表 7：检查点层', '表 8：交付层', '表 9：失效率基准的影响', 'Appendix A: the allocation and the goodput tiers under another mechanism set', 'Design P (nominal / derated)', 'Two conditions the model does not enforce', 'field-level case']) expect(html, s).toContain(s);
    expect(html).not.toContain('undefined');
    // outside the embedded fonts (base64 may hold any letters)
    expect(html.replace(/url\(data:[^)]*\)/g, '')).not.toContain('NaN');
  }, 600_000);
  it('refuses the report’s own set as a variant, a field case equal to the run’s override, and a floor outside (0, 1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hacd-variants-'));
    const floor = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--effective-floor', '97', '--out', dir]);
    expect(floor.status).toBe(1);
    expect(floor.stderr).toContain('a goodput floor between 0 and 1');
    const fieldSame = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--rates', 'field-llama3-2026-11', '--field-rates', 'field-llama3-2026-11', '--out', dir]);
    expect(fieldSame.status).toBe(1);
    expect(fieldSame.stderr).toContain("the run's own failure-rate override");
    const same = hacd(['findings', '--record', 'a3server', '--scales', '10000', '--trials', '40', '--study-dir', join(REPO, 'docs', 'backup', 'arch-mechanism-shapley'), '--reuse-studies', '--variants', 'remap-latest-2026-10', '--out', dir]);
    expect(same.status).toBe(1);
    expect(same.stderr).toContain("the report's own set");
  }, 600_000);
});
