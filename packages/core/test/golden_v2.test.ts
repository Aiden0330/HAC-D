/**
 * v2 golden-vector harness. Expected values in test/golden/golden_v2.json were computed independently in
 * Python (compute_golden_v2.py) from docs/MODEL_REFERENCE.md §10–§17 without reading the engine.
 * Do not edit expected values by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kOfNRepairable, standby } from '../src/ctmc/index.js';
import { dualRepairUnit, meanRepairH, kOfNGroup, subhealthUnit, subhealthRateFromProbability, stragglerLaw, planeLossPerformance, type DualRepair } from '../src/ctmc/repair.js';
import { ladderExpectation } from '../src/recovery/ladder.js';
import { evaluate, compensationWaterfall, type Block } from '../src/rbd/index.js';
import { parseScenario, computeCounts } from '../src/scenario/index.js';

interface GoldenCase {
  id: string;
  group: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
  tolerance?: { rel?: number; abs?: number };
}
const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_v2.json'), 'utf8')) as { cases: GoldenCase[] };

type Out = Record<string, number | number[]>;
type Handler = (i: Record<string, number>, raw: Record<string, unknown>) => Out;

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const repairOf = (i: Record<string, number>, raw: Record<string, unknown>): DualRepair => ({
  coverage: num(i.c),
  successProbability: raw.s === null || raw.s === undefined ? 1 : num(i.s),
  autoMttrH: raw.T_a === null || raw.T_a === undefined ? 0 : num(i.T_a),
  manualMttrH: num(i.T_m),
});
const switchoverOf = (i: Record<string, number>, raw: Record<string, unknown>) =>
  (raw.p_sw !== undefined && num(i.p_sw) < 1) || num(i.t_sw_s) > 0
    ? { successProbability: num(i.p_sw, 1), outageS: num(i.t_sw_s), failureRecoveryHours: raw.T_sf === null || raw.T_sf === undefined ? undefined : num(i.T_sf) }
    : undefined;
const crewsOf = (raw: Record<string, unknown>) => (raw.crews === null || raw.crews === undefined ? Infinity : (raw.crews as number));

const handlers: Record<string, Handler> = {};

// §10
for (const set of ['a', 'b', 'c', 'd']) {
  handlers[`repair.unit.set_${set}`] = (i, raw) => {
    const r = repairOf(i, raw);
    const u = dualRepairUnit(i.lambda, r);
    return { A: u.availability, E_R: meanRepairH(r), nu: u.failureFrequency, pi_Da: u.piDownAuto, pi_Dm: u.piDownManual, auto_downtime_share: u.autoDowntimeShare, human_fraction: u.humanFraction };
  };
}

// §11 — capacity keys follow the golden convention Σ π·w/n and Σ π·min(1, w/k) over ALL states (the engine's `capacity` sums up states only)
const groupBasic: Handler = (i, raw) => {
  const g = kOfNGroup({ n: i.n, k: i.k, lambda: i.lambda, repair: repairOf(i, raw), crews: crewsOf(raw), switchover: switchoverOf(i, raw) });
  const d = g.distribution!;
  const out: Out = {
    A: g.availability,
    nu: g.failureFrequency,
    mttf_from_new: g.mttfFromNew,
    capacity_proportional: d.reduce((a, s) => a + (s.probability * s.working) / i.n, 0),
    capacity_fractional: d.reduce((a, s) => a + s.probability * Math.min(1, s.working / i.k), 0),
    U_sw: g.switchoverOutage,
    A_eff: g.availabilityEffective,
    switchover_frequency: g.switchoverFrequency,
    nu_eff: g.failureFrequencyEffective,
    pi_switch_failed: g.switchFailedProbability,
  };
  return out;
};
for (const id of ['kofn.group.n2k1_seta_crews_inf_psw1', 'kofn.group.n3k2_seta_crews1_psw1', 'kofn.group.n4k2_setd_crews2_psw1', 'kofn.group.n2k1_setb_crews_inf_switchover', 'kofn.group.n3k2_seta_crews1_switchover']) handlers[id] = groupBasic;
handlers['kofn.group.n3k2_setb_crews1_reduction_to_v1'] = (i, raw) => {
  const base = groupBasic(i, raw);
  const v1 = kOfNRepairable(i.n, i.k, i.lambda, 1 / i.T_m, crewsOf(raw));
  return { ...base, A_classic: v1.availability, nu_classic: v1.failureFrequency, mttf_from_new_classic: v1.mttfFromNew };
};

// §12
handlers['parallel.firstorder.two_children'] = (i, raw) => {
  const children = (raw.children as { lambda: number; T_m: number }[]).map((c, j): Block => ({ kind: 'leaf', id: `c${j}`, lambda: c.lambda, mttr: c.T_m }));
  const perfect = evaluate({ kind: 'parallel', id: 'p', children });
  const sw = evaluate({ kind: 'parallel', id: 'p', children, switchover: { successProbability: i.p_sw, outageS: i.t_sw_s, failureRecoveryHours: i.T_sf } });
  return { U_perfect: perfect.unavailability, U_approx: sw.unavailability, penalty_switch_failure: sw.switchover!.failedProbability, penalty_micro_outage: sw.switchover!.outage };
};

// §13
const standbyV2: Handler = (i, raw) => {
  const r = standby(i.n, i.lambda, i.mu, i.f, i.p_sw, crewsOf(raw), 1 / i.T_sf);
  return { A: r.availability, nu: r.failureFrequency, U_sw: (r.switchFrequency * i.t_sw_s) / 3600, mttf_from_new: r.mttfFromNew };
};
handlers['standby.v2.n2_cold_crews_inf'] = standbyV2;
handlers['standby.v2.n3_warm_crews1'] = standbyV2;

// §14
const subhealth: Handler = (i, raw) => {
  const u = subhealthUnit(i.lambda, repairOf(i, raw), {
    ratePerHour: i.lambda_sh,
    durationH: i.D,
    performance: i.phi,
    escalationMultiplier: i.m,
    policy: raw.policy as 'tolerate' | 'isolate',
    detection: raw.p_d === null || raw.p_d === undefined ? undefined : { probability: i.p_d, delayH: i.T_d },
    threshold: i.phi_min,
  });
  return {
    pi_U: u.piUp,
    pi_H: u.piSubhealthPending,
    pi_Hp: u.piSubhealthUndetected,
    pi_I: u.piIsolated,
    pi_Da: u.piDownAuto,
    pi_Dm: u.piDownManual,
    A_strict: u.strict,
    A_tolerant: u.tolerant,
    A_perf: u.performability,
    A_threshold: u.availability,
    nu_threshold: u.failureFrequency,
    nu_iso: u.isolationFrequency,
    p_H_given_not_down: u.pSubhealthGivenNotDown,
    mttf_from_new: u.mttfFromNew,
  };
};
for (const id of ['subhealth.unit.tolerate_phi0.6', 'subhealth.unit.tolerate_phi0.8', 'subhealth.unit.isolate', 'subhealth.unit.reduction_to_degraded_unit']) handlers[id] = subhealth;
handlers['subhealth.unit.p_sh_conversion'] = (i) => ({ lambda_sh: subhealthRateFromProbability(i.p_sh, i.D).ratePerHour });

// straggler, plane
for (const id of ['straggler.n1000', 'straggler.n16384']) handlers[id] = (i) => { const r = stragglerLaw(i.N, i.p_H, i.phi); return { p_slowed: r.pSlowed, phi_job: r.performanceFactor }; };
for (const id of ['plane.p7_f0.3', 'plane.p2_f0.5', 'plane.p4_f0.2']) handlers[id] = (i) => { const r = planeLossPerformance(i.P, i.f_comm); return { phi_plane: r.performance, step_time_factor: r.stepTimeFactor }; };

// §16
handlers['ladder.mindcluster_like'] = (_i, raw) => {
  const rungs = (raw.rungs as { kind: 'auto' | 'manual'; s: number; t_s: number }[]).map((r, j) => ({ id: `r${j}`, kind: r.kind, successProbability: r.s, timeS: r.t_s }));
  const l = ladderExpectation({ id: 'g', rungs }, 4096);
  return { E_T_s: l.meanS, reach: l.rungs.map((r) => r.reachProbability), share: l.rungs.map((r) => r.share), p_manual: l.pManual, auto_mean_s: l.autoMeanS, manual_mean_s: l.manualMeanS };
};

// §17
handlers['waterfall.small_tree'] = (_i, raw) => {
  const X = raw.X as Record<string, number | string>;
  const B = raw.B as Record<string, number>;
  const C1 = raw.C1 as Record<string, number>;
  const C2 = raw.C2 as Record<string, number>;
  const G2 = raw.G2 as Record<string, number>;
  const unit: Block = {
    kind: 'leaf', id: 'x', lambda: X.lambda as number, mttr: X.T_m as number,
    repair: { coverage: X.c as number, successProbability: X.s as number, autoMttrH: X.T_a as number, manualMttrH: X.T_m as number },
    subhealth: { ratePerHour: X.lambda_sh as number, durationH: X.D as number, performance: X.phi as number, escalationMultiplier: X.m as number, policy: X.policy as 'tolerate', threshold: X.phi_min as number },
  };
  const tree: Block = {
    kind: 'series', id: 'sys', children: [
      { kind: 'kofn', id: 'g1', n: 3, k: 2, unit },
      { kind: 'leaf', id: 'b', lambda: B.lambda, mttr: B.T_m },
      { kind: 'parallel', id: 'g2', children: [{ kind: 'leaf', id: 'c1', lambda: C1.lambda, mttr: C1.T_m }, { kind: 'leaf', id: 'c2', lambda: C2.lambda, mttr: C2.T_m }], switchover: { successProbability: G2.p_sw, failureRecoveryHours: G2.T_sf, outageS: G2.t_sw_s } },
    ],
  };
  const w = compensationWaterfall(tree);
  return { A_step0: w.steps[0].availability, A_step1: w.steps[1].availability, A_step2: w.steps[2].availability, A_step3: w.steps[3].availability, switchover_penalty: w.switchoverPenalty, gain: w.gain.deltaAvailability };
};

// CM384 counts
handlers['cm384.counts'] = (i) => {
  const s = parseScenario({
    meta: { name: 'counts' },
    topology: { superpod: { preset: 'cloudmatrix384', npusPerNode: i.npus_per_node, l1PerNode: i.l1_per_node, nodesPerRack: 4, computeRacks: i.nodes / 4, subPlanes: i.sub_planes, l2PerSubPlane: i.l2_per_subplane, l2Ports: i.l2_ports, linksPerL1: i.links_per_l1, transceiversPerLink: i.transceivers_per_link } },
    components: [{ id: 'npu', countRule: { per: 'gpu' }, failure: { value: 1e-5, unit: 'per_h' }, repair: { mttrHours: 1 } }],
    workload: { type: 'training', nGpus: i.nodes * i.npus_per_node, deltaS: 10 },
  });
  const c = computeCounts(s);
  return { npus: c.gpus, l1_chips: c.l1Switches, l2_chips: c.l2Switches, l1_l2_links: c.opticalLinks, links_per_subplane: c.opticalLinks / c.subPlanes, l2_ports_per_subplane: i.l2_per_subplane * i.l2_ports, transceiver_ends: c.transceivers };
};

function close(actual: number, expected: number, tol: { rel?: number; abs?: number }): boolean {
  if (!Number.isFinite(expected)) return actual === expected;
  const rel = tol.rel ?? 1e-9;
  const abs = tol.abs ?? 0;
  return Math.abs(actual - expected) <= Math.max(abs, rel * Math.abs(expected));
}

describe('v2 golden vectors (independent Python)', () => {
  const handled = golden.cases.filter((c) => handlers[c.id]);
  it('every case has a handler', () => {
    const missing = golden.cases.filter((c) => !handlers[c.id]).map((c) => c.id);
    expect(missing).toEqual([]);
  });
  for (const c of handled) {
    it(`${c.id}`, () => {
      const inputs = Object.fromEntries(Object.entries(c.inputs).map(([k, v]) => [k, typeof v === 'number' ? v : NaN])) as Record<string, number>;
      const out = handlers[c.id](inputs, c.inputs);
      const tol = c.tolerance ?? { rel: 1e-9 };
      for (const [key, exp] of Object.entries(c.expected)) {
        if (key.startsWith('_')) continue;
        const act = out[key];
        expect(act, `${c.id}.${key} missing in engine output`).toBeDefined();
        if (Array.isArray(exp)) {
          expect(Array.isArray(act)).toBe(true);
          (exp as number[]).forEach((e, j) => expect(close((act as number[])[j], e, tol), `${c.id}.${key}[${j}]: engine ${(act as number[])[j]} vs golden ${e}`).toBe(true));
        } else if (typeof exp === 'number') {
          expect(close(act as number, exp, tol), `${c.id}.${key}: engine ${act} vs golden ${exp}`).toBe(true);
        }
      }
    });
  }
});
