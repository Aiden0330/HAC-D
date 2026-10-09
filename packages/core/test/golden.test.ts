/**
 * Golden-vector harness. The expected values were computed independently in Python
 * (test/golden/compute_golden.py) from the published formulas; this file maps each case
 * onto engine functions. Do not edit expected values by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  gammaFn, binomCdf, binomSf, binomQuantile, poissonCdf, poissonSf, poissonQuantile, logChoose,
} from '../src/math/special.js';
import { lognormalFromMeanMedian, quantile, mean, variance } from '../src/math/distributions.js';
import { toPerHour, nodeRateToGpuRate, availabilityFromMttfMttr, afrFromMttfHours, HOURS_PER_YEAR } from '../src/units/index.js';
import { kOfNRepairable, standby } from '../src/ctmc/index.js';
import { youngInterval, dalyLowestOrder, dalyThreeTerm, dalyExact, goodputFirstOrder, saxenaOptimalPeriod, saxenaAvailability, trainMoverEttr, metaRscInterval } from '../src/checkpoint/index.js';
import { blockedProbabilityPoisson, blockedProbabilityBinomial, blockMtbfHours, sparesForBlockedTarget } from '../src/sparing/index.js';
import { evaluate, type Block } from '../src/rbd/index.js';

interface GoldenCase {
  id: string;
  group: string;
  formula?: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
  tolerance?: { rel?: number; abs?: number };
  match?: string;
}
interface GoldenFile { version: string; cases: GoldenCase[] }

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden.json'), 'utf8')) as GoldenFile;

type Out = Record<string, number | boolean | number[]>;
type Handler = (inp: Record<string, number>, raw: Record<string, unknown>) => Out;

/** bisection for a monotone function on [lo, hi] */
function solve(f: (x: number) => number, target: number, lo: number, hi: number, increasing: boolean): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if ((v < target) === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const kAtLeast = (n: number, p: number, q: number) => {
  let k = n;
  while (k > 0 && binomSf(n, k, p) < q) k--;
  return k;
};

const ex1 = (i: Record<string, number>): Out => {
  const g = goodputFirstOrder(i.delta_s, i.tau_s, i.M_s, i.R_s);
  // the golden file's "recovery term" is the survey's 中断损失占比 (τ/2 + R)/M
  return { goodput_frac: g.goodput, loss_frac: g.terms.total, delta_over_tau: g.terms.save, half_tau_s: i.tau_s / 2, recovery_term_frac: g.terms.recompute + g.terms.restart };
};

const handlers: Record<string, Handler> = {
  // unit conversions
  'units.llama3_gpu_h_per_interruption': (i) => ({ gpu_h_per_event: 1 / (i.events / (i.days * 24 * i.N_gpu)) }),
  'units.rsc1_gpu_h_per_failure': (i) => ({ gpu_h_per_event: 1 / nodeRateToGpuRate(toPerHour(i.r_f_per_1000_node_day, 'per_1000_node_day'), i.gpu_per_node) }),
  'units.rsc2_gpu_h_per_failure': (i) => ({ gpu_h_per_event: 1 / nodeRateToGpuRate(toPerHour(i.r_f_per_1000_node_day, 'per_1000_node_day'), i.gpu_per_node) }),
  'units.coreweave_gpu_h_per_interruption': (i) => ({ gpu_h_per_event: 1 / toPerHour(i.gpu_days_per_event, 'gpu_day_per_event') }),
  'units.nebius_gpu_h_per_failure': (i) => ({ gpu_h_per_event: i.MTBF_h * i.N_gpu }),
  'units.delta_a100_gpu_h_per_error': (i) => ({ gpu_h_per_error: i.MTBE_h * i.N_gpu }),
  'units.delta_h100_gpu_h_per_error': (i) => ({ gpu_h_per_error: i.MTBE_h * i.N_gpu }),
  'units.lanl_sys7_proc_h_per_failure': (i) => ({ proc_h_per_event: (i.N_proc * HOURS_PER_YEAR) / i.failures_per_year }),
  'units.lanl_sys7_system_mtbf_h': (i) => ({ MTBF_h: 1 / toPerHour(i.failures_per_year, 'per_year') }),
  'units.titan_node_h_per_crash': (i) => ({ node_h_per_event: i.MTBF_h * i.N_nodes }),
  'units.petascale_socket_h_per_interruption': (i) => ({ socket_h_per_event: 1 / toPerHour(i.failures_per_socket_year, 'per_year') }),
  // 1/N law
  'one-over-n.rsc_rf6.50_16384gpu': (i) => ({ MTTF_h: 1 / ((i.N_gpu / i.gpu_per_node) * toPerHour(i.r_f_per_1000_node_day, 'per_1000_node_day')) }),
  'one-over-n.rsc_rf6.50_131072gpu': (i) => ({ MTTF_h: 1 / ((i.N_gpu / i.gpu_per_node) * toPerHour(i.r_f_per_1000_node_day, 'per_1000_node_day')) }),
  'one-over-n.coreweave_1024gpu_days': (i) => ({ MTTF_days: i.gpu_days_per_event / i.N_gpu, MTTF_h: (24 * i.gpu_days_per_event) / i.N_gpu }),
  'one-over-n.coreweave_16384gpu_days': (i) => ({ MTTF_days: i.gpu_days_per_event / i.N_gpu, MTTF_h: (24 * i.gpu_days_per_event) / i.N_gpu }),
  // worked example 1
  'ex1.lambda_job': (i) => ({ lambda_job_per_h: i.events / (i.days * 24) }),
  'ex1.mtbi': (i) => ({ MTBI_h: 1 / i.lambda_job_per_h, MTBI_min: 60 / i.lambda_job_per_h, MTBI_s: 3600 / i.lambda_job_per_h }),
  'ex1.lambda_gpu': (i) => ({ lambda_per_gpu_h: i.lambda_job_per_h / i.N_gpu, gpu_h_per_interruption: i.N_gpu / i.lambda_job_per_h }),
  'ex1.tau_yd': (i) => ({ tau_s: youngInterval(i.delta_s, i.M_s) }),
  'ex1.daly_lowest_order': (i) => ({ tau_s: dalyLowestOrder(i.delta_s, i.M_s) }),
  'ex1.daly_three_term': (i) => ({ tau_s: dalyThreeTerm(i.delta_s, i.M_s), xi: Math.sqrt(i.delta_s / (2 * i.M_s)) }),
  'ex1.daly_exact_lambert_w': (i) => {
    const tau = dalyExact(i.delta_s, i.M_s);
    return { tau_s: tau, eta: (tau + i.delta_s) / i.M_s };
  },
  'ex1.goodput_r0': ex1,
  'ex1.goodput_r4.45min': ex1,
  'ex1.goodput_r6.47min': ex1,
  'ex1.availability_optimal_interval': (i) => {
    const tc = saxenaOptimalPeriod(i.Tf_s, i.Ts_s, i.Tr_s);
    return { Tc_s: tc, ratio_to_young: tc / youngInterval(i.Ts_s, i.Tf_s) };
  },
  // Daly 2006 (minutes in, minutes out — the formulas are scale-free)
  'daly.three_term': (i) => ({ tau_min: dalyThreeTerm(i.delta_min, i.M_min), xi2_delta_over_2M: i.delta_min / (2 * i.M_min), tau_lowest_order_min: dalyLowestOrder(i.delta_min, i.M_min), exp_R_over_M: Math.exp(i.R_min / i.M_min) }),
  'daly.exact': (i) => ({ tau_min: dalyExact(i.delta_min, i.M_min) }),
  // Saxena
  'saxena.tc_star': (i) => {
    const tc = saxenaOptimalPeriod(i.Tf_s, i.Ts_s, i.Tr_s);
    return { Tc_s: tc, Tc_min: tc / 60 };
  },
  'saxena.young': (i) => {
    const y = youngInterval(i.Ts_s, i.Tf_s);
    return { Tc_s: y, Tc_min: y / 60 };
  },
  'saxena.casea.availability_at_both_intervals': (i) => {
    const a = saxenaAvailability(i.Tc_star_s, i.Tf_s, i.Ts_s, i.Tr_s);
    const b = saxenaAvailability(i.Tc_young_s, i.Tf_s, i.Ts_s, i.Tr_s);
    return { A_at_Tc_star_frac: a, A_at_young_frac: b, difference_frac: a - b };
  },
  // TrainMover
  'trainmover': (i) => {
    const r = trainMoverEttr(i.D_min * 60, i.MTTF_min * 60, i.N_gpu);
    return { ETTR_frac: r.ettr, wasted_gpus: r.wastedGpus! };
  },
  // Lablup
  'lablup.young_interval': (i) => {
    const M = i.M_h * 3600;
    const T = youngInterval(i.delta_s, M);
    return { T_s: T, T_min: T / 60, loss_at_optimum_frac: i.delta_s / T + T / (2 * M) };
  },
  'lablup.loss_at_actual_133.5min': (i) => {
    const M = i.M_h * 3600;
    const T = i.T_min * 60;
    return { loss_frac: i.delta_s / T + T / (2 * M), save_term_frac: i.delta_s / T, redo_term_frac: T / (2 * M) };
  },
  // Ironwood
  'ironwood.p_from_k95_130': (i) => {
    const p = solve((x) => binomSf(i.n_cubes, i.k95, x), i.confidence, 0.5, 0.999999, true);
    return { p_frac: p, check_P_ge_130: binomSf(i.n_cubes, i.k95, p) };
  },
  'ironwood.k99_at_p_star': (i) => {
    const k = kAtLeast(i.n_cubes, i.p_frac, i.confidence);
    return { k99: k, P_ge_k99: binomSf(i.n_cubes, k, i.p_frac), P_ge_k99_plus_1: binomSf(i.n_cubes, k + 1, i.p_frac) };
  },
  'ironwood.k_at_p': (i) => ({ k95: kAtLeast(i.n_cubes, i.p_frac, 0.95), k99: kAtLeast(i.n_cubes, i.p_frac, 0.99), P_ge_130: binomSf(i.n_cubes, 130, i.p_frac) }),
  'ironwood.p_from_k99_125': (i) => ({ p_frac: solve((x) => binomSf(i.n_cubes, i.k99, x), i.confidence, 0.5, 0.999999, true) }),
  'ironwood.redundancy_fractions': (i) => ({ frac_k95: (i.n_cubes - i.k95) / i.n_cubes, frac_k99: (i.n_cubes - i.k99_blog) / i.n_cubes }),
  // ByteRobust
  'byterobust.p_interval': (i) => {
    const N = i.N_machines;
    const q = i.P99_quantile;
    const c = i.confidence;
    const lo = solve((p) => binomCdf(N, q - 1, p), c, 1e-9, 0.5, false);
    const hi = solve((p) => binomCdf(N, q, p), c, 1e-9, 0.5, false);
    return { p_lo_frac_exclusive: lo, p_hi_frac_inclusive: hi, check_quantile_at_midpoint: binomQuantile(N, (lo + hi) / 2, c) };
  },
  'byterobust.intersection_all_sizes': (_i, raw) => {
    const sizes = raw.sizes as number[];
    const qs = raw.quantiles as number[];
    let lo = 0;
    let hi = 1;
    sizes.forEach((N, idx) => {
      lo = Math.max(lo, solve((p) => binomCdf(N, qs[idx] - 1, p), 0.99, 1e-9, 0.5, false));
      hi = Math.min(hi, solve((p) => binomCdf(N, qs[idx], p), 0.99, 1e-9, 0.5, false));
    });
    return { p_lo_frac_exclusive: lo, p_hi_frac_inclusive: hi, nonempty: lo < hi };
  },
  // CTMC first passage (N required + k spares)
  'ctmc.two_hot_units_no_repair': (i) => {
    const T = kOfNRepairable(i.N + i.k, i.N, i.lambda_per_h, i.mu_per_h).mttfFromNew;
    return { T0_h: T, T0_times_lambda: T * i.lambda_per_h };
  },
  'ctmc.two_units_one_repairman': (i) => {
    const T = kOfNRepairable(i.N + i.k, i.N, i.lambda_per_h, i.mu_per_h, 1).mttfFromNew;
    return { T0_h: T, closed_form_h: (3 * i.lambda_per_h + i.mu_per_h) / (2 * i.lambda_per_h * i.lambda_per_h) };
  },
  'ctmc.k0_series_reduces_to_1_over_n_lambda': (i) => {
    const T = kOfNRepairable(i.N, i.N, i.lambda_per_h, i.mu_per_h).mttfFromNew;
    return { T0_h: T, closed_form_h: 1 / (i.N * i.lambda_per_h) };
  },
  'ctmc.n1024_k4_numeric': (i) => {
    const T = kOfNRepairable(i.N + i.k, i.N, i.lambda_per_h, i.mu_per_h).mttfFromNew;
    return { T0_h: T, T0_years: T / 8766 }; // the golden file uses a 365.25-day year
  },
  'ctmc.n1024_k4_steady_state_availability': (i) => {
    const r = kOfNRepairable(i.N + i.k, i.N, i.lambda_per_h, 1 / i.MTTR_h);
    const u = (i.lambda_per_h * i.MTTR_h) / (1 + i.lambda_per_h * i.MTTR_h);
    return { u_frac: u, A_frac: r.availability, unavailability_frac: 1 - r.availability };
  },
  'ctmc.ideal_cold_standby': (i) => ({ MTTF_ideal_h: standby(2, i.lambda_per_h, 0, 0, 1).mttfFromNew, 'MTTF_ps0.9_h': standby(2, i.lambda_per_h, 0, 0, i.p_s_frac).mttfFromNew }),
  // RBD basics
  'rbd.parallel_1_of_2': (i) => {
    const lam = 1e-3;
    const mttr = (1 - i.A_t_frac) / (lam * i.A_t_frac);
    const r = evaluate({ kind: 'parallel', id: 'p', children: [{ kind: 'leaf', id: 'a', lambda: lam, mttr }, { kind: 'leaf', id: 'b', lambda: lam, mttr }] });
    return { A_frac: r.availability };
  },
  'rbd.n_plus_1_5_of_6': (i) => {
    const lam = 1e-3;
    const mttr = (1 - i.A_m_frac) / (lam * i.A_m_frac);
    const r = evaluate({ kind: 'kofn', id: 'k', n: i.n, k: i.n - 1, unit: { kind: 'leaf', id: 'm', lambda: lam, mttr } });
    return { A_frac: r.availability, check_binomial_tail: binomSf(i.n, i.n - 1, i.A_m_frac) };
  },
  'rbd.series_unavailability': (i) => {
    const r = evaluate({ kind: 'leaf', id: 'gpu', count: i.n_gpu, lambda: i.lambda_per_gpu_h, mttr: i.MTTR_h } as Block);
    return { A_frac: r.availability, first_order_unavailability_frac: i.n_gpu * i.lambda_per_gpu_h * i.MTTR_h };
  },
  // Meta sparing
  'meta.blocked_poisson_l256_r22': (i) => ({ m: (i.L_blocks * i.MTTR_h) / i.MTBF_block_h, Pr_blocked: blockedProbabilityPoisson(i.L_blocks, i.MTTR_h, i.MTBF_block_h, i.R_spares) }),
  'meta.blocked_binomial_exact_l256_r22': (i) => {
    const b = blockedProbabilityBinomial(i.L_blocks, i.MTTR_h, i.MTBF_block_h, i.R_spares);
    return { rho: i.MTTR_h / i.MTBF_block_h, Pr_blocked: b, ratio_poisson_over_exact: blockedProbabilityPoisson(i.L_blocks, i.MTTR_h, i.MTBF_block_h, i.R_spares) / b };
  },
  'meta.one_over_h_scaling_fixed_m': (i, raw) => {
    const Ls = raw.L_blocks as number[];
    // the target equals Pr_blocked(22) exactly: R(target) = min{R : Pr_blocked(R) ≤ target} with a 1e-6 boundary slack
    const R = Ls.map(() => {
      let r = 0;
      while (poissonSf(i.m, r) > i.target_Pr_blocked * (1 + 1e-6)) r++;
      return r;
    });
    return { R_spares: R, spare_frac: R.map((r, idx) => r / Ls[idx]) };
  },
  'meta.table6-3': (i) => {
    const mtbf = blockMtbfHours(i.K_trays, i.MTBF_tray_h, i.MTBF_rack_h);
    const L = i.zone_gpu / i.gpu_per_block;
    const m = (L * i.MTTR_h) / mtbf;
    const P = i.placement_group_gpu / i.gpu_per_block;
    const spareFracPrinted: Record<number, number> = { 72: 0.086, 36: 0.047, 18: 0.026 };
    const R = Math.round(spareFracPrinted[i.gpu_per_block] * L);
    const stranded = (L - R - Math.floor((L - R) / P) * P) / L;
    return {
      MTBF_block_h: mtbf,
      L_blocks: L,
      m,
      R_spares_from_printed_frac: R,
      spare_frac: R / L,
      stranded_frac: stranded,
      Pr_blocked_poisson_at_R: blockedProbabilityPoisson(L, i.MTTR_h, mtbf, R),
      Pr_blocked_poisson_at_R_minus_1: blockedProbabilityPoisson(L, i.MTTR_h, mtbf, R - 1),
      Pr_blocked_binomial_at_R: blockedProbabilityBinomial(L, i.MTTR_h, mtbf, R),
      Pr_blocked_binomial_at_R_minus_1: blockedProbabilityBinomial(L, i.MTTR_h, mtbf, R - 1),
    };
  },
  'meta.table6-3.common_target_band': (_i, raw) => {
    const Rs = raw.R_spares as number[];
    const ms = raw.m as number[];
    const pois = (m: number, R: number) => 1 - poissonCdf(m, R);
    const plo = Math.max(...Rs.map((R, k) => pois(ms[k], R)));
    const phi = Math.min(...Rs.map((R, k) => pois(ms[k], R - 1)));
    return { poisson_band_lo: plo, poisson_band_hi: phi, poisson_band_nonempty: plo < phi };
  },
  'meta.table6-3.round_target_scan': (_i, raw) => {
    const targets = raw.targets as number[];
    const Rp = raw.R_printed as number[];
    const ms = [6.144, 6.7584, 7.9872];
    const Ls = [256, 512, 1024];
    const mttrOverMtbf = ms.map((m, k) => m / Ls[k]);
    const Rpois = targets.map((t) => ms.map((m) => poissonQuantile(m, 1 - t)));
    const Rbin = targets.map((t) => Ls.map((L, k) => binomQuantile(L, mttrOverMtbf[k] / (1 + mttrOverMtbf[k]), 1 - t)));
    const same = (a: number[]) => a.every((v, k) => v === Rp[k]);
    return {
      R_poisson: Rpois.flat(),
      R_binomial: Rbin.flat(),
      targets_reproducing_printed_poisson: targets.filter((_t, idx) => same(Rpois[idx])),
      targets_reproducing_printed_binomial: targets.filter((_t, idx) => same(Rbin[idx])),
    };
  },
  // Benoit replication
  'benoit': (i) => {
    const b = i.b_pairs;
    const n = 1 + Math.exp(b * Math.log(4) - logChoose(2 * b, b));
    const s = Math.sqrt(Math.PI * b);
    return { n_fail: n, sqrt_pi_b: s, ratio_to_sqrt_pi_b_over_2: n / Math.sqrt((Math.PI * b) / 2), ratio_to_sqrt_pi_b: n / s };
  },
  // NTP
  'ntp.affected_fraction_p0.001_t64': (i) => ({ affected_frac: 1 - Math.pow(1 - i.p_frac, i.T) }),
  'ntp.nvl72_block_vs_8gpu_node': (i) => {
    const a = 1 - Math.pow(1 - i.p_gpu_frac, 72);
    const b = 1 - Math.pow(1 - i.p_gpu_frac, 8);
    return { p_block_72_frac: a, p_node_8_frac: b, ratio: a / b };
  },
  // availability / AFR
  'avail.delta': (i) => {
    const A = availabilityFromMttfMttr(i.MTTF_h, i.MTTR_h);
    return { A_frac: A, downtime_min_per_day: (1 - A) * 1440 };
  },
  'avail.afr': (i) => ({ AFR_frac: afrFromMttfHours(i.MTTF_h), FIT: 1e9 / i.MTTF_h }),
  'avail.calce': (i) => ({ downtime_h_per_year: (1 - i.A_frac) * i.hours_per_year }),
  // Weibull
  'weibull.median_over_mean': (i) => ({ median_over_mean: Math.pow(Math.LN2, 1 / i.k_shape) / gammaFn(1 + 1 / i.k_shape), gamma_1_plus_1_over_k: gammaFn(1 + 1 / i.k_shape) }),
  'weibull.mean_matched_scale_k0.78': (i) => {
    const alpha = 1 / i.lambda_per_h / gammaFn(1 + 1 / i.k_shape);
    return { alpha_h: alpha, check_mean_h: mean({ type: 'weibull', shape: i.k_shape, scale: alpha }) };
  },
  'weibull.series_n1000_k0.78': (i) => {
    const aN = i.alpha_h * Math.pow(i.N_units, -1 / i.k_shape);
    const m = mean({ type: 'weibull', shape: i.k_shape, scale: aN });
    const e = 1 / (i.N_units * i.lambda_per_h);
    return { alpha_N_h: aN, MTTF_from_new_h: m, MTTF_exponential_h: e, ratio_weibull_over_exponential: m / e };
  },
  // Lognormal
  'lognormal.lanl_repair_fit': (i) => {
    const d = lognormalFromMeanMedian(i.mean_min, i.median_min);
    if (d.type !== 'lognormal') throw new Error('unexpected');
    const m = mean(d);
    return { sigma: d.sigma, mu: d.mu, P90_min: quantile(d, 0.9), P99_min: quantile(d, 0.99), check_mean_min: m, mean_over_median: m / i.median_min, C2: variance(d) / (m * m) };
  },
  // prediction
  'prediction.rates': (i) => ({ lambda_unplanned_per_h: (1 - i.recall_frac) * i.lambda_per_h, lambda_alarm_per_h: (i.recall_frac * i.lambda_per_h) / i.precision_frac, breakeven_C_unplanned_over_C_planned: 1 / i.precision_frac }),
  // Epoch
  'epoch.replica': (i) => {
    const F = ((i.t_train_days * 86400) / i.t_step_s) * (i.N_gpu / i.M_replicas) * Math.pow(i.lambda_node_per_s * i.t_step_s, i.M_replicas);
    return { F_expected_unrecoverable_per_training: F, trainings_per_event: 1 / F };
  },
  'epoch.fo.optimal_interval': (i) => {
    const M = 3600 / (i.N_gpu * i.lambda_per_gpu_h);
    const tau = youngInterval(i.delta_s, M);
    return { M_s: M, tau_s: tau, tau_min: tau / 60 };
  },
  'epoch.fo.checkpoint_plus_redo_loss': (i) => ({ loss_frac: Math.sqrt((2 * i.delta_s) / i.M_s) }),
  'epoch.fo.recovery_term': (i) => {
    const M = 3600 / (i.N_gpu * i.lambda_per_gpu_h);
    const r = (i.R_min * 60) / M;
    return { recovery_loss_frac: r, total_loss_frac: r + Math.sqrt((2 * 2.43) / M) };
  },
  // Meta HPCA ETTR planning statements
  'meta_hpca': (i) => {
    const rf = toPerHour(i.r_f_per_1000_node_day, 'per_1000_node_day');
    const nodes = i.N_gpu / i.gpu_per_node;
    const M = 3600 / (nodes * rf);
    const dt = metaRscInterval(i.w_cp_s, nodes, rf);
    return { M_s: M, dt_s: dt, ETTR_frac: goodputFirstOrder(i.w_cp_s, dt, M, i.u0_s).goodput };
  },
  // misc
  'misc.flashrecovery_no_failure_probabilities': (i) => ({ p_no_failure_1: Math.pow(1 - i.p1_frac, i.n1), p_no_failure_2: Math.pow(1 - i.p2_frac, i.n2) }),
  'misc.spare_optimal_redundancy_r_star': (_i, raw) => ({ r_star: (raw.N as number[]).map((n) => Math.floor(Math.log2(n) + 0.833)) }),
  'misc.meta_in_block_spare_fraction': (i) => ({ frac: i.spare_trays_gpu / i.block_gpu }),
  'misc.meta_goodput_ratio': (i) => ({ ratio: i.goodput_best_eq_gpu / i.goodput_second_eq_gpu }),
  'misc.hot_spare_fractions': (i) => ({ byterobust_frac: i.byterobust_spares / i.byterobust_nodes, epoch_frac: i.epoch_spares / i.epoch_nodes }),
};

/** Resolve the handler for a case id: exact id, then known prefixes. */
function handlerFor(id: string): Handler | undefined {
  if (handlers[id]) return handlers[id];
  if (id.startsWith('one-over-n.epoch') || id.startsWith('one-over-n.spare')) return (i) => ({ M_h: 1 / (i.N_gpu * i.lambda_per_gpu_h), M_min: 60 / (i.N_gpu * i.lambda_per_gpu_h) });
  if (/^ex2\..*\.m$/.test(id)) return (i) => ({ M_min: 60 / (i.N_gpu * i.lambda_per_gpu_h), M_s: 3600 / (i.N_gpu * i.lambda_per_gpu_h) });
  if (/^ex2\..*\.tau_yd$/.test(id)) return (i) => ({ tau_s: youngInterval(i.delta_s, i.M_s) });
  if (/^ex2\..*\.loss_r0$/.test(id)) return (i) => ({ loss_frac: i.delta_s / i.tau_s + i.tau_s / (2 * i.M_s) });
  if (/^ex2\..*\.goodput_/.test(id)) return (i) => ({ goodput_frac: goodputFirstOrder(i.delta_s, i.tau_s, i.M_s, i.R_s).goodput });
  if (/^ex2\..*\.r_over_m$/.test(id)) return (i) => ({ R_over_M: i.R_s / i.M_s, exp_R_over_M: Math.exp(i.R_s / i.M_s) });
  if (/^ex3\..*mean_daily_failures$/.test(id)) return (i) => ({ mean: (i.N_nodes * i.r_f_per_1000_node_day) / 1000, p_frac: i.r_f_per_1000_node_day / 1000 });
  if (/^ex3\..*binomial_quantile/.test(id)) return (i) => {
    const k = binomQuantile(i.N_nodes, i.p_frac, i.q);
    return { k, cdf_at_k: binomCdf(i.N_nodes, k, i.p_frac), cdf_at_k_minus_1: binomCdf(i.N_nodes, k - 1, i.p_frac), k_over_N_frac: k / i.N_nodes };
  };
  if (/^ex3\..*poisson_quantile/.test(id)) return (i) => {
    const m = (i.N_nodes * i.p_frac * i.MTTR_h) / 24;
    const k = poissonQuantile(m, 0.99);
    return { k, m, cdf_at_k: poissonCdf(m, k), cdf_at_k_minus_1: poissonCdf(m, k - 1) };
  };
  if (/^ex4\.p.*\.k\d$/.test(id)) return (i) => ({ availability_frac: binomSf(i.N_required + i.k_spares, i.N_required, i.p_replica_frac), redundancy_frac: i.k_spares / i.N_required });
  if (id === 'ex4.mirrored_pair_single') return (i) => ({ availability_frac: 1 - Math.pow(1 - i.p_replica_frac, 2) });
  if (id === 'ex4.mirrored_pairs_64') return (i) => ({ availability_frac: Math.pow(1 - Math.pow(1 - i.p_replica_frac, 2), i.pairs) });
  if (/^daly\..*three_term$/.test(id)) return handlers['daly.three_term'];
  if (/^daly\..*exact_lambert_w$/.test(id)) return handlers['daly.exact'];
  if (/^saxena\.case.\.tc_star$/.test(id)) return handlers['saxena.tc_star'];
  if (/^saxena\.case.\.young$/.test(id)) return (i) => {
    const y = youngInterval(i.Ts_s, i.Tf_s);
    return { Tc_s: y, Tc_min: y / 60 };
  };
  if (id.startsWith('trainmover.')) return handlers['trainmover'];
  if (/^ironwood\.k_at_p/.test(id)) return handlers['ironwood.k_at_p'];
  if (/^byterobust\.n\d+\.p_interval/.test(id)) return handlers['byterobust.p_interval'];
  if (/^meta\.table6-3\.block/.test(id)) return handlers['meta.table6-3'];
  if (id.startsWith('benoit.')) return handlers['benoit'];
  if (id.startsWith('avail.delta')) return handlers['avail.delta'];
  if (id.startsWith('avail.afr')) return handlers['avail.afr'];
  if (id.startsWith('avail.calce')) return handlers['avail.calce'];
  if (id.startsWith('weibull.median_over_mean')) return handlers['weibull.median_over_mean'];
  if (id.startsWith('epoch.replica')) return handlers['epoch.replica'];
  if (id.startsWith('meta_hpca.')) return handlers['meta_hpca'];
  return undefined;
}

function close(actual: number, expected: number, rel: number): boolean {
  if (!Number.isFinite(expected)) return actual === expected;
  if (expected === 0) return Math.abs(actual) <= 1e-12;
  return Math.abs(actual - expected) <= Math.max(rel, 1e-9) * Math.abs(expected) + 1e-15;
}

describe(`golden vectors v${golden.version} (${golden.cases.length} cases)`, () => {
  let compared = 0;
  const unmapped: string[] = [];
  for (const c of golden.cases) {
    const h = handlerFor(c.id);
    if (!h) {
      unmapped.push(c.id);
      continue;
    }
    it(c.id, () => {
      const numeric: Record<string, number> = {};
      for (const [k, v] of Object.entries(c.inputs)) if (typeof v === 'number') numeric[k] = v;
      const out = h(numeric, c.inputs);
      const rel = c.tolerance?.rel ?? 1e-6;
      let n = 0;
      for (const [k, e] of Object.entries(c.expected)) {
        if (!(k in out)) continue;
        const a = out[k];
        n++;
        if (Array.isArray(e)) {
          const flatE = (e as unknown[]).flat() as number[];
          const flatA = (a as number[]).flat();
          expect(flatA.length, `${c.id}.${k} length`).toBe(flatE.length);
          flatE.forEach((ev, idx) => expect(close(flatA[idx], ev, rel), `${c.id}.${k}[${idx}] = ${flatA[idx]} vs ${ev}`).toBe(true));
        } else if (typeof e === 'boolean') {
          expect(a, `${c.id}.${k}`).toBe(e);
        } else if (typeof e === 'number') {
          expect(close(a as number, e, rel), `${c.id}.${k} = ${a} vs ${e} (rel ${rel})`).toBe(true);
        }
      }
      expect(n, `${c.id}: no expected key compared`).toBeGreaterThan(0);
      compared += n;
    });
  }
  it('maps every golden case to an engine function', () => {
    expect(unmapped, 'unmapped golden cases').toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });
});
