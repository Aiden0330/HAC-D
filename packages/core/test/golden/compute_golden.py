#!/usr/bin/env python3
"""
compute_golden.py -- independent golden test vectors for the HAC-D core engine.

Run (regenerates golden.json and golden-report.md next to this file):
  uv run --python 3.12 --with mpmath --with scipy --with numpy python compute_golden.py

Every "expected" number below is computed from the published formula and its inputs
with mpmath at 60 significant digits.  Nothing is copied from the survey; the survey's
printed value is attached only for comparison and classified as
  ok           -- agrees with the printed value within half a unit of its last printed digit
  rounding     -- differs by between 0.5 and 1 unit of the last printed digit (truncation or
                  rounding of an intermediate value)
  discrepancy  -- differs by more than one unit of the last printed digit
  n/a          -- the survey prints no value (pure regression golden)
"""
import datetime
import json
import os
import re

from mpmath import (mp, mpf, sqrt, exp, log, lambertw, gamma, loggamma, binomial, pi,
                    erfinv, matrix, lu_solve, floor)

mp.dps = 60
HERE = os.path.dirname(os.path.abspath(__file__))
SURVEY = "survey_text.txt"
cases = []

# ----------------------------------------------------------------------------- helpers
def L(n):
    return f"{SURVEY} line {n}"


def fl(x):
    return float(mpf(x))


def num(s):
    s2 = re.sub(r"[≈~%,\s]", "", s)
    dec = len(s2.split(".")[1]) if "." in s2 else 0
    return mpf(s2), dec


def match_to(computed, printed, ulp=None):
    """Compare a computed value (already in the survey's printed units) with the printed string."""
    val, dec = num(printed)
    ulp = mpf(ulp) if ulp is not None else mpf(10) ** (-dec)
    d = abs(mpf(computed) - val)
    if d <= ulp / 2 * (1 + mpf("1e-9")):
        return "ok"
    if d <= ulp * (1 + mpf("1e-9")):
        return "rounding"
    return "discrepancy"


def match_range(computed, lo, hi):
    """Range printed by the survey; allow half a unit of the bounds' last printed digit at either end
    (same rule as match_to: a value that rounds to a printed bound is 'ok')."""
    lo_v, dec_lo = num(str(lo))
    hi_v, dec_hi = num(str(hi))
    slack = mpf(10) ** (-max(dec_lo, dec_hi)) / 2 * (1 + mpf("1e-9"))
    x = mpf(computed)
    return "ok" if lo_v - slack <= x <= hi_v + slack else "discrepancy"


def nid(cid):
    """Normalise an id: lower-case dot/kebab/underscore case, no '='."""
    return cid.lower().replace("=", "")


def case_by_id(cid):
    return next(c for c in cases if c["id"] == nid(cid))


def add(cid, group, formula, inputs, expected, survey_value=None, ref=None, match="n/a",
        computed_str=None, note=None, rel=1e-6):
    cid = nid(cid)
    assert re.fullmatch(r"[a-z0-9][a-z0-9._-]*", cid), cid
    assert all(c["id"] != cid for c in cases), f"duplicate id {cid}"
    c = {"id": cid, "group": group, "formula": formula, "inputs": inputs,
         "expected": expected, "tolerance": {"rel": rel}}
    if survey_value is None:
        c["survey"] = None
    else:
        c["survey"] = {"value": survey_value, "ref": ref}
        if computed_str is not None:
            c["survey"]["computed"] = computed_str
    c["match"] = match
    if note:
        c["note"] = note
    cases.append(c)
    return c


def pct(x, nd=3):
    return f"{fl(mpf(x) * 100):.{nd}f} %"


# distributions ----------------------------------------------------------------------
def binom_pmf(n, k, p):
    p = mpf(p)
    return binomial(n, k) * p ** k * (1 - p) ** (n - k)


def binom_cdf(n, k, p):
    if k < 0:
        return mpf(0)
    return sum(binom_pmf(n, i, p) for i in range(0, int(k) + 1))


def binom_sf(n, k, p):  # P(X >= k)
    return sum(binom_pmf(n, i, p) for i in range(int(k), int(n) + 1))


def binom_quantile(n, p, q):  # smallest k with P(X <= k) >= q
    k, c = 0, binom_pmf(n, 0, p)
    while c < q:
        k += 1
        c += binom_pmf(n, k, p)
    return k


def pois_pmf(m, k):
    m = mpf(m)
    return exp(-m) * m ** k / gamma(k + 1)


def pois_cdf(m, k):
    return sum(pois_pmf(m, i) for i in range(0, int(k) + 1))


def pois_quantile(m, q):
    k, c = 0, pois_pmf(m, 0)
    while c < q:
        k += 1
        c += pois_pmf(m, k)
    return k


def bisect(fn, lo, hi, iters=220):
    lo, hi = mpf(lo), mpf(hi)
    flo = fn(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2
        fm = fn(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


# checkpoint models -------------------------------------------------------------------
def young(delta, M):
    return sqrt(2 * delta * M)


def daly_lowest(delta, M):
    return sqrt(2 * delta * M) - delta


def daly_three(delta, M):
    xi = sqrt(delta / (2 * M))
    return sqrt(2 * delta * M) * (1 + xi / 3 + xi ** 2 / 9) - delta


def daly_exact(delta, M):
    xi2 = delta / (2 * M)
    w = lambertw(-exp(-2 * xi2 - 1), 0)
    assert abs(mp.im(w)) < mpf("1e-40")
    eta = 2 * xi2 + 1 + mp.re(w)
    tau = eta * M - delta
    # optimality condition (1 - tau/M) * exp((tau+delta)/M) = 1
    assert abs((1 - tau / M) * exp((tau + delta) / M) - 1) < mpf("1e-40")
    return tau


def goodput_fo(delta, tau, R, M):
    return 1 - delta / tau - (tau / 2 + R) / M


def saxena_tc(Tf, Ts, Tr):
    return Ts + sqrt(2 * (Tf + Tr) * Ts + Ts ** 2)


def saxena_avail(Tf, Ts, Tc, Tr):
    return (Tf - Tf * Ts / Tc) / (Tf + Tc / 2 + Tr)


def ctmc_T0(N, k, lam, mu):
    """Mean first-passage time from state 0 to state k+1 of the Fig. 4-3 birth-death chain.
    (a_j + b_j) T_j = 1 + a_j T_{j+1} + b_j T_{j-1},  a_j = (N+k-j) lam,  b_j = j mu,  T_{k+1} = 0."""
    n = k + 1
    A = matrix(n, n)
    b = matrix(n, 1)
    for j in range(n):
        aj = (N + k - j) * mpf(lam)
        bj = j * mpf(mu)
        A[j, j] = aj + bj
        if j + 1 <= k:
            A[j, j + 1] = -aj
        if j - 1 >= 0:
            A[j, j - 1] = -bj
        b[j] = 1
    return lu_solve(A, b)[0]


def z_quantile(q):
    return sqrt(2) * erfinv(2 * mpf(q) - 1)


# ============================================================================= 1. units
G = "unit-conversion"
T22 = "Table 2-2"


def unit(cid, formula, inputs, val, survey, line, scale, printed, key, note=None):
    add(cid, G, formula, inputs, {key: fl(val)}, survey, f"{T22}, {L(line)}",
        match_to(val / scale, printed), computed_str=f"{fl(val):.6g}", note=note)


unit("units.llama3_gpu_h_per_interruption", "gpu_h_per_event = days*24*N_gpu/events",
     {"days": 54, "N_gpu": 16384, "events": 419}, mpf(54) * 24 * 16384 / 419,
     "≈5.07×10^4 GPU·h/次", 279, mpf(10) ** 4, "5.07", "gpu_h_per_event")
unit("units.rsc1_gpu_h_per_failure", "gpu_h_per_event = 1000*24*gpu_per_node/r_f",
     {"r_f_per_1000_node_day": 6.50, "gpu_per_node": 8}, mpf(1000) * 24 * 8 / mpf("6.50"),
     "≈2.95×10^4 GPU·h/次", 284, mpf(10) ** 4, "2.95", "gpu_h_per_event")
unit("units.rsc2_gpu_h_per_failure", "gpu_h_per_event = 1000*24*gpu_per_node/r_f",
     {"r_f_per_1000_node_day": 2.34, "gpu_per_node": 8}, mpf(1000) * 24 * 8 / mpf("2.34"),
     "≈8.2×10^4 GPU·h/次", 284, mpf(10) ** 4, "8.2", "gpu_h_per_event")
unit("units.coreweave_gpu_h_per_interruption", "gpu_h_per_event = gpu_days_per_event*24",
     {"gpu_days_per_event": 3748.25}, mpf("3748.25") * 24,
     "≈9.0×10^4 GPU·h/次", 289, mpf(10) ** 4, "9.0", "gpu_h_per_event")
unit("units.nebius_gpu_h_per_failure", "gpu_h_per_event = MTBF_h*N_gpu",
     {"MTBF_h": 33.0, "N_gpu": 3000}, mpf("33.0") * 3000,
     "≈9.9×10^4 GPU·h/次", 294, mpf(10) ** 4, "9.9", "gpu_h_per_event")
unit("units.delta_a100_gpu_h_per_error", "gpu_h_per_error = MTBE_h*N_gpu",
     {"MTBE_h": 1.4, "N_gpu": 448}, mpf("1.4") * 448,
     "≈6.3×10^2 GPU·h/错误", 299, mpf(10) ** 2, "6.3", "gpu_h_per_error")
unit("units.delta_h100_gpu_h_per_error", "gpu_h_per_error = MTBE_h*N_gpu",
     {"MTBE_h": 1.9, "N_gpu": 608}, mpf("1.9") * 608,
     "≈1.2×10^3 GPU·h/错误", 299, mpf(10) ** 3, "1.2", "gpu_h_per_error")
unit("units.lanl_sys7_proc_h_per_failure", "proc_h_per_event = N_proc*8760/failures_per_year",
     {"N_proc": 4096, "failures_per_year": 1159, "hours_per_year": 8760}, mpf(4096) * 8760 / 1159,
     "≈3.1×10^4 处理器·h/次", 304, mpf(10) ** 4, "3.1", "proc_h_per_event")
unit("units.lanl_sys7_system_mtbf_h", "MTBF_h = 8760/failures_per_year",
     {"failures_per_year": 1159, "hours_per_year": 8760}, mpf(8760) / 1159,
     "系统 MTBF 约 7.6 h", 304, 1, "7.6", "MTBF_h")
unit("units.titan_node_h_per_crash", "node_h_per_event = MTBF_h*N_nodes",
     {"MTBF_h": 14.51, "N_nodes": 18688}, mpf("14.51") * 18688,
     "≈2.7×10^5 节点·h/次", 309, mpf(10) ** 5, "2.7", "node_h_per_event")
unit("units.petascale_socket_h_per_interruption", "socket_h_per_event = 8760/failures_per_socket_year",
     {"failures_per_socket_year": 0.1, "hours_per_year": 8760}, mpf(8760) / mpf("0.1"),
     "8.76×10^4 socket·h/次", 314, mpf(10) ** 4, "8.76", "socket_h_per_event")

# ======================================================================== 2. 1/N law
G = "one-over-n-law"


def mttf_h_nodes(N_gpu, gpn, rf):
    return 24 / ((mpf(N_gpu) / gpn) * (mpf(rf) / 1000))


v = mttf_h_nodes(16384, 8, "6.50")
add("one-over-n.rsc_rf6.50_16384gpu", G, "MTTF_h = 24 / ((N_gpu/gpu_per_node) * r_f/1000)",
    {"N_gpu": 16384, "gpu_per_node": 8, "r_f_per_1000_node_day": 6.50}, {"MTTF_h": fl(v)},
    "1.8 h", L(326), match_to(v, "1.8"), computed_str=f"{fl(v):.4f} h")
v = mttf_h_nodes(131072, 8, "6.50")
add("one-over-n.rsc_rf6.50_131072gpu", G, "MTTF_h = 24 / ((N_gpu/gpu_per_node) * r_f/1000)",
    {"N_gpu": 131072, "gpu_per_node": 8, "r_f_per_1000_node_day": 6.50}, {"MTTF_h": fl(v)},
    "0.23 h", L(326), match_to(v, "0.23"), computed_str=f"{fl(v):.4f} h")
v = mpf("3748.25") / 1024
add("one-over-n.coreweave_1024gpu_days", G, "MTTF_days = gpu_days_per_event / N_gpu",
    {"gpu_days_per_event": 3748.25, "N_gpu": 1024}, {"MTTF_days": fl(v), "MTTF_h": fl(v * 24)},
    "3.66 天", L(269), match_to(v, "3.66"), computed_str=f"{fl(v):.4f} days")
v = mpf("3748.25") / 16384
add("one-over-n.coreweave_16384gpu_days", G, "MTTF_days = gpu_days_per_event / N_gpu",
    {"gpu_days_per_event": 3748.25, "N_gpu": 16384}, {"MTTF_days": fl(v), "MTTF_h": fl(v * 24)},
    note="Regression golden; the survey prints no value for this size.")
for N, sv, line, printed, ulp, unit_, cid in [
        (16384, "约 3 小时", 963, "3", 1, "h", "one-over-n.epoch_1e-5_16384gpu"),
        (100000, "约每 30 分钟一次", 326, "30", 10, "min", "one-over-n.epoch_1e-5_100k_gpu"),
        (1000000, "约每 3 分钟一次", 326, "3", 1, "min", "one-over-n.epoch_1e-5_1m_gpu"),
        (96000, "96k 卡约 30 分钟", 326, "30", 10, "min", "one-over-n.spare_96k_gpu"),
        (600000, "600k 卡约 5 分钟", 326, "5", 1, "min", "one-over-n.spare_600k_gpu")]:
    M_h = mpf(50000) / N
    val = M_h if unit_ == "h" else M_h * 60
    add(cid, G, "M = 1/(N_gpu*lambda_gpu)", {"N_gpu": N, "lambda_per_gpu_h": 2e-5},
        {"M_h": fl(M_h), "M_min": fl(M_h * 60)}, sv, L(line), match_to(val, printed, ulp),
        computed_str=f"{fl(val):.4g} {unit_}",
        note="Epoch AI / SPARe scale-out statements, lambda_gpu = 1/50,000 per GPU·h; printed values are '约' (approximate).")

# ================================================================ 3. worked example 1
G = "worked-example-1"
T65 = "Table 6-5"
N1, EV, DAYS, DELTA = 16384, 419, 54, mpf("2.43")
lam_job = mpf(EV) / (DAYS * 24)           # per hour
M_h = 1 / lam_job
M_s = M_h * 3600
lam_gpu = lam_job / N1
add("ex1.lambda_job", G, "lambda_job = events/(days*24)", {"events": EV, "days": DAYS},
    {"lambda_job_per_h": fl(lam_job)}, "0.323 次/h", f"{T65}, {L(1820)}", match_to(lam_job, "0.323"),
    computed_str=f"{fl(lam_job):.6f} /h")
add("ex1.mtbi", G, "MTBI = 1/lambda_job", {"lambda_job_per_h": fl(lam_job)},
    {"MTBI_h": fl(M_h), "MTBI_min": fl(M_h * 60), "MTBI_s": fl(M_s)},
    "3.09 h（185.6 min）; M = 11,135 s", f"{T65}, {L(1823)} and {L(1832)}",
    match_to(M_h * 60, "185.6") if match_to(M_h, "3.09") == "ok" and match_to(M_s, "11135") == "ok" else "discrepancy",
    computed_str=f"{fl(M_h):.5f} h = {fl(M_h*60):.3f} min = {fl(M_s):.2f} s")
add("ex1.lambda_gpu", G, "lambda_gpu = lambda_job/N_gpu", {"lambda_job_per_h": fl(lam_job), "N_gpu": N1},
    {"lambda_per_gpu_h": fl(lam_gpu), "gpu_h_per_interruption": fl(1 / lam_gpu)},
    "1 / 50,680 GPU·h", f"{T65}, {L(1826)}", match_to(1 / lam_gpu, "50680", ulp=10),
    computed_str=f"1/{fl(1/lam_gpu):.1f} GPU·h", note="Survey rounds 50,677 to four significant figures.")
tau_yd = young(DELTA, M_s)
add("ex1.tau_yd", G, "tau = sqrt(2*delta*M)", {"delta_s": 2.43, "M_s": fl(M_s)}, {"tau_s": fl(tau_yd)},
    "232.6 s", f"{T65}, {L(1832)}", match_to(tau_yd, "232.6"), computed_str=f"{fl(tau_yd):.3f} s")
tau_lo = daly_lowest(DELTA, M_s)
add("ex1.daly_lowest_order", G, "tau = sqrt(2*delta*M) - delta", {"delta_s": 2.43, "M_s": fl(M_s)},
    {"tau_s": fl(tau_lo)}, "230.2 s", f"{T65}, {L(1833)}", match_to(tau_lo, "230.2"),
    computed_str=f"{fl(tau_lo):.3f} s")
tau_3 = daly_three(DELTA, M_s)
add("ex1.daly_three_term", G, "tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta, xi = sqrt(delta/(2M))",
    {"delta_s": 2.43, "M_s": fl(M_s)}, {"tau_s": fl(tau_3), "xi": fl(sqrt(DELTA / (2 * M_s)))},
    "231.0 s", f"{T65}, {L(1833)}", match_to(tau_3, "231.0"), computed_str=f"{fl(tau_3):.3f} s")
tau_x = daly_exact(DELTA, M_s)
add("ex1.daly_exact_lambert_w", G,
    "eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2 - 1)); tau = eta*M - delta; xi^2 = delta/(2M)",
    {"delta_s": 2.43, "M_s": fl(M_s)}, {"tau_s": fl(tau_x), "eta": fl((tau_x + DELTA) / M_s)},
    "231.0 s（三项式）", f"{T65}, {L(1833)}", match_to(tau_x, "231.0"), computed_str=f"{fl(tau_x):.3f} s",
    note="Survey prints only the three-term value; the exact root of (1 - tau/M) e^((tau+delta)/M) = 1 agrees to 0.01 s. Principal branch W0 is required (W_-1 gives tau < 0).")
g0 = goodput_fo(DELTA, tau_yd, 0, M_s)
add("ex1.goodput_R0", G, "goodput = 1 - delta/tau - (tau/2 + R)/M", {"delta_s": 2.43, "tau_s": fl(tau_yd), "R_s": 0, "M_s": fl(M_s)},
    {"goodput_frac": fl(g0), "loss_frac": fl(1 - g0), "delta_over_tau": fl(DELTA / tau_yd), "half_tau_s": fl(tau_yd / 2)},
    "97.9%（损失 2.1%）; delta/tau = 0.0104; tau/2 = 116.3 s", f"{T65}, {L(1835)}",
    match_to(g0 * 100, "97.9"), computed_str=pct(g0),
    note="At the Young optimum the two loss terms are equal and loss = sqrt(2*delta/M).")
for R_min, sv, line in [("4.45", "95.5%", 1838), ("6.47", "94.4%", 1841)]:
    R_s = mpf(R_min) * 60
    g = goodput_fo(DELTA, tau_yd, R_s, M_s)
    add(f"ex1.goodput_R{R_min}min", G, "goodput = 1 - delta/tau - (tau/2 + R)/M",
        {"delta_s": 2.43, "tau_s": fl(tau_yd), "R_s": fl(R_s), "R_min": float(R_min), "M_s": fl(M_s)},
        {"goodput_frac": fl(g), "recovery_term_frac": fl((tau_yd / 2 + R_s) / M_s)}, sv, f"{T65}, {L(line)}",
        match_to(g * 100, sv.rstrip("%")), computed_str=pct(g))
Tr = mpf("4.45") * 60
tc_star = saxena_tc(M_s, DELTA, Tr)
add("ex1.availability_optimal_interval", G, "Tc* = Ts + sqrt(2*(Tf + Tr)*Ts + Ts^2)",
    {"Ts_s": 2.43, "Tf_s": fl(M_s), "Tr_s": fl(Tr)}, {"Tc_s": fl(tc_star), "ratio_to_young": fl(tc_star / tau_yd)},
    "237.8 s（比 Young 式长 2%）", f"{T65}, {L(1844)}", match_to(tc_star, "237.8"),
    computed_str=f"{fl(tc_star):.3f} s; ratio {fl(tc_star/tau_yd):.4f}")

# ================================================================ 4. worked example 2
G = "worked-example-2"
T66 = "Table 6-6"
LAM2 = mpf(1) / 50680
for N, sv in [(16384, ("185.6", "232.6", "2.1", "95.5", "92.5", 1855)),
              (65536, ("46.4", "116.3", "4.2", "86.2", "74.3", 1862)),
              (131072, ("23.2", "82.2", "5.9", "74.9", "51.0", 1869))]:
    M = 1 / (N * LAM2) * 3600
    tau = young(DELTA, M)
    loss0 = DELTA / tau + tau / (2 * M)
    g267 = goodput_fo(DELTA, tau, mpf(267), M)
    g600 = goodput_fo(DELTA, tau, mpf(600), M)
    line = sv[5]
    add(f"ex2.N{N}.M", G, "M = 1/(N*lambda_gpu)", {"N_gpu": N, "lambda_per_gpu_h": fl(LAM2)},
        {"M_min": fl(M / 60), "M_s": fl(M)}, f"{sv[0]} min", f"{T66}, {L(line)}", match_to(M / 60, sv[0]),
        computed_str=f"{fl(M/60):.3f} min")
    add(f"ex2.N{N}.tau_yd", G, "tau = sqrt(2*delta*M)", {"delta_s": 2.43, "M_s": fl(M)}, {"tau_s": fl(tau)},
        f"{sv[1]} s", f"{T66}, {L(line)}", match_to(tau, sv[1]), computed_str=f"{fl(tau):.3f} s")
    add(f"ex2.N{N}.loss_R0", G, "loss = delta/tau + tau/(2M)", {"delta_s": 2.43, "tau_s": fl(tau), "M_s": fl(M)},
        {"loss_frac": fl(loss0)}, f"{sv[2]}%", f"{T66}, {L(line)}", match_to(loss0 * 100, sv[2]), computed_str=pct(loss0))
    add(f"ex2.N{N}.goodput_R4.45min", G, "goodput = 1 - delta/tau - (tau/2 + R)/M",
        {"delta_s": 2.43, "tau_s": fl(tau), "R_s": 267, "M_s": fl(M)}, {"goodput_frac": fl(g267)},
        f"{sv[3]}%", f"{T66}, {L(line)}", match_to(g267 * 100, sv[3]), computed_str=pct(g267))
    add(f"ex2.N{N}.goodput_R10min", G, "goodput = 1 - delta/tau - (tau/2 + R)/M",
        {"delta_s": 2.43, "tau_s": fl(tau), "R_s": 600, "M_s": fl(M)}, {"goodput_frac": fl(g600)},
        f"{sv[4]}%", f"{T66}, {L(line)}", match_to(g600 * 100, sv[4]), computed_str=pct(g600))
    if N == 131072:
        add("ex2.N131072.R_over_M", G, "R/M and exp(R/M)", {"R_s": 600, "M_s": fl(M)},
            {"R_over_M": fl(600 / M), "exp_R_over_M": fl(exp(600 / M))},
            "R/M = 0.43、e^(R/M) = 1.54", f"{T66}, {L(1873)}",
            "ok" if match_to(600 / M, "0.43") == "ok" and match_to(exp(600 / M), "1.54") == "ok" else "rounding",
            computed_str=f"{fl(600/M):.4f}; e^x = {fl(exp(600/M)):.4f}",
            note="Regime warning: first-order formula requires R << M.")

# ================================================================ 5. worked example 3
G = "worked-example-3"
T67 = "Table 6-7"
N3 = 1024
for rf, col, sv_mean, sv_q99, sv_q999, sv_p8, sv_p22 in [("2.3", "r_f=2.3", "2.36", 7, 8, 3, 2),
                                                           ("6.50", "r_f=6.50", "6.66", 13, 16, 6, 3)]:
    p = mpf(rf) / 1000
    mean = N3 * p
    add(f"ex3.{col}.mean_daily_failures", G, "mean = N*p, p = r_f/1000", {"N_nodes": N3, "r_f_per_1000_node_day": float(rf)},
        {"mean": fl(mean), "p_frac": fl(p)}, sv_mean, f"{T67}, {L(1883 if rf == '2.3' else 1884)}",
        match_to(mean, sv_mean), computed_str=f"{fl(mean):.4f}")
    for q, sv_q, line in [("0.99", sv_q99, 1886), ("0.999", sv_q999, 1888)]:
        k = binom_quantile(N3, p, mpf(q))
        add(f"ex3.{col}.binomial_quantile_{q}", G, "k = min{k : P(Binomial(N,p) <= k) >= q}",
            {"N_nodes": N3, "p_frac": fl(p), "q": float(q)},
            {"k": k, "cdf_at_k": fl(binom_cdf(N3, k, p)), "cdf_at_k_minus_1": fl(binom_cdf(N3, k - 1, p)),
             "k_over_N_frac": fl(mpf(k) / N3)},
            str(sv_q), f"{T67}, {L(line)}", match_to(k, str(sv_q)), computed_str=str(k), rel=1e-9)
    for mttr, sv_p, line in [("8", sv_p8, 1891), ("2.2", sv_p22, 1893)]:
        m = N3 * p / 24 * mpf(mttr)
        k = pois_quantile(m, mpf("0.99"))
        add(f"ex3.{col}.poisson_quantile_0.99_MTTR{mttr}h", G,
            "m = N*lambda_node*MTTR, lambda_node = p/24 per h; k = min{k : P(Poisson(m) <= k) >= 0.99}",
            {"N_nodes": N3, "p_frac": fl(p), "MTTR_h": float(mttr)},
            {"k": k, "m": fl(m), "cdf_at_k": fl(pois_cdf(m, k)), "cdf_at_k_minus_1": fl(pois_cdf(m, k - 1))},
            str(sv_p), f"{T67}, {L(line)}", match_to(k, str(sv_p)), computed_str=f"{k} (m = {fl(m):.5f})", rel=1e-9)

# ================================================================ 6. worked example 4
G = "worked-example-4"
T68 = "Table 6-8"
NREQ = 64
for p, ks in [("0.993", [(0, "63.8", 1907), (1, "92.4", 1909), (2, "98.87", 1909), (3, "99.87", 1909),
                          (4, "99.988", 1911), (5, "99.999", 1911)]),
              ("0.99", [(4, "99.94", 1913), (5, "99.993", 1913)])]:
    for k, sv, line in ks:
        n = NREQ + k
        a = binom_sf(n, NREQ, mpf(p))
        add(f"ex4.p{p}.k{k}", G, "A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i)",
            {"N_required": NREQ, "k_spares": k, "p_replica_frac": float(p)},
            {"availability_frac": fl(a), "redundancy_frac": fl(mpf(k) / NREQ)}, f"{sv}%", f"{T68}, {L(line)}",
            match_to(a * 100, sv), computed_str=pct(a, 4))
pair = 1 - mpf("0.007") ** 2
add("ex4.mirrored_pair_single", G, "A_pair = 1 - (1-p)^2", {"p_replica_frac": 0.993}, {"availability_frac": fl(pair)},
    "99.995%", f"{T68}, {L(1916)}", match_to(pair * 100, "99.995"), computed_str=pct(pair, 4))
m64 = pair ** 64
add("ex4.mirrored_pairs_64", G, "A = (1 - (1-p)^2)^64", {"p_replica_frac": 0.993, "pairs": 64}, {"availability_frac": fl(m64)},
    "≈99.69%", f"{T68}, {L(1916)}", match_to(m64 * 100, "99.69"), computed_str=pct(m64, 4))

# ===================================================================== 7. Daly 2006
G = "daly-2006"
D_DELTA, D_R = mpf(5), mpf(10)
for M_min, sv in [(1440, "117"), (360, "57"), (15, "9.1")]:
    M = mpf(M_min)
    t3 = daly_three(D_DELTA, M)
    tx = daly_exact(D_DELTA, M)
    tl = daly_lowest(D_DELTA, M)
    add(f"daly.M{M_min}min.three_term", G, "tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta",
        {"delta_min": 5, "R_min": 10, "M_min": M_min},
        {"tau_min": fl(t3), "xi2_delta_over_2M": fl(D_DELTA / (2 * M)), "tau_lowest_order_min": fl(tl), "exp_R_over_M": fl(exp(D_R / M))},
        f"{sv} min", f"Daly card, {L(1672)}; Fig 6-1/6-2 captions {L(1605)}, {L(1607)}", match_to(t3, sv),
        computed_str=f"{fl(t3):.3f} min",
        note="Survey value is Daly's Monte-Carlo optimum (<=10,000 runs per case). R does not enter the optimum; it only scales total time by exp(R/M).")
    add(f"daly.M{M_min}min.exact_lambert_w", G, "eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2-1)); tau = eta*M - delta",
        {"delta_min": 5, "R_min": 10, "M_min": M_min}, {"tau_min": fl(tx)},
        f"{sv} min", f"Daly card, {L(1672)}", match_to(tx, sv), computed_str=f"{fl(tx):.3f} min")

# =================================================================== 8. Saxena 2024
G = "saxena-2024"
for tag, Ts, Tr, sv_tc, sv_y, line in [("A", mpf(30), mpf(16) * 60, "9.23", "7.74", 1608),
                                        ("B", mpf(1), mpf(4) * 60, "1.477", "1.414", 1608)]:
    Tf = mpf(3600)
    tc = saxena_tc(Tf, Ts, Tr)
    ty = young(Ts, Tf)
    add(f"saxena.case{tag}.Tc_star", G, "Tc* = Ts + sqrt(2*(Tf + Tr)*Ts + Ts^2)",
        {"Tf_s": 3600, "Ts_s": fl(Ts), "Tr_s": fl(Tr)}, {"Tc_s": fl(tc), "Tc_min": fl(tc / 60)},
        f"{sv_tc} min", f"Saxena paragraph, {L(line)}", match_to(tc / 60, sv_tc), computed_str=f"{fl(tc/60):.4f} min")
    add(f"saxena.case{tag}.young", G, "Tc = sqrt(2*Ts*Tf)", {"Tf_s": 3600, "Ts_s": fl(Ts)},
        {"Tc_s": fl(ty), "Tc_min": fl(ty / 60), "ratio_Tc_star_over_young": fl(tc / ty)},
        f"{sv_y} min", f"Saxena paragraph, {L(line)}", match_to(ty / 60, sv_y), computed_str=f"{fl(ty/60):.4f} min",
        note=None if tag == "B" else "7.746 min rounds to 7.75; the paper/survey print 7.74 (truncation).")
    if tag == "A":
        a_star = saxena_avail(Tf, Ts, tc, Tr)
        a_y = saxena_avail(Tf, Ts, ty, Tr)
        add("saxena.caseA.availability_at_both_intervals", G, "A(Tc) = (Tf - Tf*Ts/Tc)/(Tf + Tc/2 + Tr)",
            {"Tf_s": 3600, "Ts_s": 30, "Tr_s": 960, "Tc_star_s": fl(tc), "Tc_young_s": fl(ty)},
            {"A_at_Tc_star_frac": fl(a_star), "A_at_young_frac": fl(a_y), "difference_frac": fl(a_star - a_y)},
            "0.7040 对 0.7027（约 0.13 个百分点）", f"{L(1608)}",
            "ok" if match_to(a_star, "0.7040") == "ok" and match_to(a_y, "0.7027") == "ok" else "rounding",
            computed_str=f"{fl(a_star):.5f} vs {fl(a_y):.5f}; diff {fl((a_star-a_y)*100):.3f} pp")

# ===================================================================== 9. TrainMover
G = "trainmover"
D_MIN = mpf("4.45")
for N, MTTF, sv_e, sv_w, ulp_w in [(8192, 216, "97.94", "169", 1), (16384, 108, "95.88", None, None),
                                     (32768, 54, "91.76", None, None), (65536, 27, "83.52", None, None),
                                     (131072, 14, "68.21", "41.7", 100)]:
    ettr = 1 - D_MIN / MTTF
    wasted = N * D_MIN / MTTF
    note = "N taken as powers of two (8K = 8,192 ...); 169 wasted GPUs is reproduced only with N = 8,192."
    if sv_w is not None:
        wm = match_to(wasted / (1000 if ulp_w == 100 else 1), sv_w, ulp=(0.1 if ulp_w == 100 else 1))
        svw = f"ETTR {sv_e}%; wasted ≈{sv_w}{'k' if ulp_w == 100 else ''} GPU"
        mt = match_to(ettr * 100, sv_e) if wm == "ok" else wm
    else:
        svw = f"ETTR {sv_e}%"
        mt = match_to(ettr * 100, sv_e)
    add(f"trainmover.N{N}", G, "ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF",
        {"N_gpu": N, "D_min": 4.45, "MTTF_min": MTTF}, {"ETTR_frac": fl(ettr), "wasted_gpus": fl(wasted)},
        svw, f"{L(1507)}", mt, computed_str=f"{pct(ettr)}; wasted {fl(wasted):.1f}", note=note)

# ========================================================================= 10. Lablup
G = "lablup"
M_lab = mpf("56.2") * 3600
t_lab = young(mpf(18), M_lab)
add("lablup.young_interval", G, "T = sqrt(2*delta*M)", {"M_h": 56.2, "delta_s": 18},
    {"T_s": fl(t_lab), "T_min": fl(t_lab / 60), "loss_at_optimum_frac": fl(sqrt(2 * mpf(18) / M_lab))},
    "44.9 min", f"Young card, {L(1661)}", match_to(t_lab / 60, "44.9"), computed_str=f"{fl(t_lab/60):.3f} min",
    note="44.98 min rounds to 45.0; the printed 44.9 is a truncation (or the paper's own rounding of M).")
t_act = mpf("133.5") * 60
loss_act = 18 / t_act + t_act / (2 * M_lab)
add("lablup.loss_at_actual_133.5min", G, "loss = delta/T + T/(2M)", {"M_h": 56.2, "delta_s": 18, "T_min": 133.5},
    {"loss_frac": fl(loss_act), "save_term_frac": fl(18 / t_act), "redo_term_frac": fl(t_act / (2 * M_lab))},
    "实际 133.5 min，故障损失占主导", f"Young card, {L(1661)}", "ok",
    computed_str=f"loss {pct(loss_act)} (save {pct(18/t_act)}, redo {pct(t_act/(2*M_lab))})",
    note="Qualitative statement only; 'ok' means the redo term dominates as stated.")

# =============================================================== 11. Google Ironwood
G = "ironwood-k-of-n"
NC, K95 = 144, 130
p_star = bisect(lambda p: binom_sf(NC, K95, p) - mpf("0.95"), mpf("0.80"), mpf("0.999"))
k99 = max(k for k in range(0, NC + 1) if binom_sf(NC, k, p_star) >= mpf("0.99"))
add("ironwood.p_from_k95_130", G, "solve P(Binomial(144,p) >= 130) = 0.95 for p",
    {"n_cubes": NC, "k95": K95, "confidence": 0.95}, {"p_frac": fl(p_star), "check_P_ge_130": fl(binom_sf(NC, K95, p_star))},
    "p 约 0.935–0.940", f"{L(966)}; card {L(1003)}", match_range(p_star, "0.935", "0.940"), computed_str=f"{fl(p_star):.5f}",
    note="Root of the exact binomial tail; 0.9347 rounds to 0.935, the lower end of the survey's inferred band 0.935–0.940.")
add("ironwood.k99_at_p_star", G, "k99 = max{k : P(Binomial(144,p*) >= k) >= 0.99}",
    {"n_cubes": NC, "p_frac": fl(p_star), "confidence": 0.99},
    {"k99": k99, "P_ge_k99": fl(binom_sf(NC, k99, p_star)), "P_ge_k99_plus_1": fl(binom_sf(NC, k99 + 1, p_star))},
    "k99 = 127–128", f"{L(966)}; card {L(1003)}", match_range(k99, 127, 128), computed_str=str(k99), rel=1e-9)
for pp in ["0.935", "0.940"]:
    k95b = max(k for k in range(0, NC + 1) if binom_sf(NC, k, mpf(pp)) >= mpf("0.95"))
    k99b = max(k for k in range(0, NC + 1) if binom_sf(NC, k, mpf(pp)) >= mpf("0.99"))
    add(f"ironwood.k_at_p{pp}", G, "k_q = max{k : P(Binomial(144,p) >= k) >= q}", {"n_cubes": NC, "p_frac": float(pp)},
        {"k95": k95b, "k99": k99b, "P_ge_130": fl(binom_sf(NC, 130, mpf(pp)))},
        "k95 = 130, k99 = 127–128（同一 p）", f"{L(966)}", "ok" if (k95b == 130 and 127 <= k99b <= 128) else "discrepancy",
        computed_str=f"k95 = {k95b}, k99 = {k99b}", rel=1e-9,
        note="End points of the survey's inferred p band.")
p_125 = bisect(lambda p: binom_sf(NC, 125, p) - mpf("0.99"), mpf("0.80"), mpf("0.999"))
add("ironwood.p_from_k99_125", G, "solve P(Binomial(144,p) >= 125) = 0.99 for p", {"n_cubes": NC, "k99": 125, "confidence": 0.99},
    {"p_frac": fl(p_125)}, "原文 99% 时取 125；两点在同一 p 下不完全自洽", f"{L(966)}; {L(1784)}", "ok",
    computed_str=f"{fl(p_125):.5f} (vs {fl(p_star):.5f} from the 95 % point)",
    note="Confirms the survey's remark: the blog's two points imply different p (0.918 vs 0.934).")
add("ironwood.redundancy_fractions", G, "frac = (n - k)/n", {"n_cubes": NC, "k95": 130, "k99_blog": 125},
    {"frac_k95": fl(mpf(14) / 144), "frac_k99": fl(mpf(19) / 144)}, "约 10%（14/144）到 13%（19/144）", f"{L(1004)}",
    "ok" if match_to(mpf(14) / 144 * 100, "10", ulp=1) == "ok" and match_to(mpf(19) / 144 * 100, "13") == "ok" else "rounding",
    computed_str=f"{fl(mpf(14)/144*100):.2f} % / {fl(mpf(19)/144*100):.2f} %")

# ====================================================================== 12. ByteRobust
G = "byterobust"
ivals = {}
for Nm, q in [(1024, 4), (512, 3), (256, 2), (128, 2)]:
    p_lo = bisect(lambda p: binom_cdf(Nm, q - 1, p) - mpf("0.99"), mpf("1e-6"), mpf("0.05"))
    p_hi = bisect(lambda p: binom_cdf(Nm, q, p) - mpf("0.99"), mpf("1e-6"), mpf("0.05"))
    ivals[Nm] = (p_lo, p_hi)
    sv = "约 0.08%–0.125%" if Nm == 1024 else None
    add(f"byterobust.N{Nm}.p_interval_for_P99_eq_{q}", G,
        "P99(Binomial(N,p)) = q  <=>  F(q-1;p) < 0.99 <= F(q;p); p_lo: F(q-1;p)=0.99, p_hi: F(q;p)=0.99",
        {"N_machines": Nm, "P99_quantile": q, "confidence": 0.99},
        {"p_lo_frac_exclusive": fl(p_lo), "p_hi_frac_inclusive": fl(p_hi),
         "check_quantile_at_midpoint": binom_quantile(Nm, (p_lo + p_hi) / 2, mpf("0.99"))},
        sv, f"{T67} 对照, {L(1898)}" if sv else None,
        ("ok" if match_to(p_lo * 100, "0.08") == "ok" and match_to(p_hi * 100, "0.125") == "ok" else "rounding") if sv else "n/a",
        computed_str=f"({fl(p_lo*100):.4f} %, {fl(p_hi*100):.4f} %]" if sv else None)
lo_all = max(v[0] for v in ivals.values())
hi_all = min(v[1] for v in ivals.values())
add("byterobust.intersection_all_sizes", G, "intersection of the four p-intervals (1024->4, 512->3, 256->2, 128->2)",
    {"sizes": [1024, 512, 256, 128], "quantiles": [4, 3, 2, 2]},
    {"p_lo_frac_exclusive": fl(lo_all), "p_hi_frac_inclusive": fl(hi_all), "nonempty": bool(hi_all > lo_all)},
    "约 0.12%–0.125%", f"{T67} 对照, {L(1898)}",
    "ok" if match_to(lo_all * 100, "0.12") == "ok" and match_to(hi_all * 100, "0.125") == "ok" else "rounding",
    computed_str=f"({fl(lo_all*100):.4f} %, {fl(hi_all*100):.4f} %]",
    note="Lower bound comes from N = 128 (quantile 2), upper bound from N = 1024 (quantile 4).")

# ============================================================ 13. CTMC first passage
G = "ctmc-first-passage"
LAM, MU = mpf("1e-4"), mpf(1) / 24
t = ctmc_T0(1, 1, LAM, 0)
add("ctmc.two_hot_units_no_repair", G, "birth-death recurrence, N=1, k=1, mu=0  ->  T0 = 3/(2*lambda)",
    {"N": 1, "k": 1, "lambda_per_h": 1e-4, "mu_per_h": 0}, {"T0_h": fl(t), "T0_times_lambda": fl(t * LAM)},
    "MTTF = 3/(2λ)", f"{L(968)}; plan §8", "ok" if abs(t * LAM - mpf(3) / 2) < mpf("1e-40") else "discrepancy",
    computed_str=f"{fl(t):.1f} h = {fl(t*LAM):.6f}/λ")
t = ctmc_T0(1, 1, LAM, MU)
closed = (3 * LAM + MU) / (2 * LAM ** 2)
add("ctmc.two_units_one_repairman", G, "birth-death recurrence, N=1, k=1, mu>0  ->  T0 = (3*lambda + mu)/(2*lambda^2)",
    {"N": 1, "k": 1, "lambda_per_h": 1e-4, "mu_per_h": fl(MU), "MTTR_h": 24}, {"T0_h": fl(t), "closed_form_h": fl(closed)},
    "MTTF = (3λ + μ)/(2λ²)", f"{L(1033)}", "ok" if abs(t - closed) / closed < mpf("1e-40") else "discrepancy",
    computed_str=f"{fl(t):.4f} h")
t = ctmc_T0(1024, 0, LAM, MU)
add("ctmc.k0_series_reduces_to_1_over_N_lambda", G, "k = 0  ->  T0 = 1/(N*lambda)",
    {"N": 1024, "k": 0, "lambda_per_h": 1e-4, "mu_per_h": fl(MU)}, {"T0_h": fl(t), "closed_form_h": fl(1 / (1024 * LAM))},
    "T_0 = 1/(Nλ)", f"{L(1030)}", "ok" if abs(t - 1 / (1024 * LAM)) < mpf("1e-40") else "discrepancy",
    computed_str=f"{fl(t):.6f} h")
LAM_D, MU_D, N_D, K_D = mpf("11.6e-6"), mpf(1) / 24, 1024, 4
t = ctmc_T0(N_D, K_D, LAM_D, MU_D)
u = LAM_D * 24 / (1 + LAM_D * 24)
A_ss = binom_cdf(N_D + K_D, K_D, u)
add("ctmc.N1024_k4_numeric", G, "birth-death recurrence solved as a tridiagonal linear system (states 0..k, T_{k+1}=0)",
    {"N": N_D, "k": K_D, "lambda_per_h": 11.6e-6, "mu_per_h": fl(MU_D), "MTTR_h": 24},
    {"T0_h": fl(t), "T0_years": fl(t / 8766)},
    note="Regression golden (no survey value): mean time until the 5th simultaneous failure exhausts 4 hot spares.")
add("ctmc.N1024_k4_steady_state_availability", G, "A = sum_{j<=k} C(N+k,j) u^j (1-u)^(N+k-j), u = lambda*MTTR/(1 + lambda*MTTR)",
    {"N": N_D, "k": K_D, "lambda_per_h": 11.6e-6, "MTTR_h": 24},
    {"u_frac": fl(u), "A_frac": fl(A_ss), "unavailability_frac": fl(1 - A_ss)},
    note="Fig. 4-1(b) formula; regression golden. Implementations computing 1 - A must keep ~1e-5 absolute resolution.")
add("ctmc.ideal_cold_standby", G, "MTTF = 2/lambda (ideal cold standby); (1 + p_s)/lambda with switch success p_s",
    {"lambda_per_h": 1e-4, "p_s_frac": 0.9}, {"MTTF_ideal_h": fl(2 / LAM), "MTTF_ps0.9_h": fl((1 + mpf("0.9")) / LAM)},
    "理想冷备 2/λ；切换成功概率 p_s 时 (1 + p_s)/λ", f"{L(968)}", "ok",
    computed_str=f"{fl(2/LAM):.1f} h; {fl(1.9/LAM):.1f} h", note="Closed forms; 'ok' is an identity check.")

G = "rbd-basic"
At = mpf("0.99")
add("rbd.parallel_1_of_2", G, "A = 1 - (1 - A_t)^2", {"A_t_frac": 0.99}, {"A_frac": fl(1 - (1 - At) ** 2)},
    note="Fig. 4-1 / 算例五 formula (line 1136); regression golden.")
Am = mpf("0.99")
add("rbd.n_plus_1_5_of_6", G, "A = A_m^n + n*A_m^(n-1)*(1 - A_m), n = 6", {"A_m_frac": 0.99, "n": 6},
    {"A_frac": fl(Am ** 6 + 6 * Am ** 5 * (1 - Am)), "check_binomial_tail": fl(binom_sf(6, 5, Am))},
    note="N+1 cooling (5-of-6 mCDU); regression golden.")
add("rbd.series_unavailability", G, "A_job = prod (1 + lambda_i*MTTR_i)^(-n_i); 1 - A ≈ lambda_job*MTTR",
    {"n_gpu": 16384, "lambda_per_gpu_h": fl(lam_gpu), "MTTR_h": 1.0},
    {"A_frac": fl((1 + lam_gpu * 1) ** (-16384)), "first_order_unavailability_frac": fl(16384 * lam_gpu * 1)},
    note="Fig. 4-1(a) series availability with one component class; regression golden.")

# ============================================================ 14. Meta Poisson sparing
G = "meta-poisson-sparing"
Lz, MTTR_z, MTBF_z, Rz = 256, mpf(24), mpf(1000), 22
m_z = Lz * MTTR_z / MTBF_z
rho = MTTR_z / MTBF_z
pb_pois = 1 - pois_cdf(m_z, Rz)
pb_bin = 1 - binom_cdf(Lz, Rz, rho / (1 + rho))
add("meta.blocked_poisson_L256_R22", G, "Pr(blocked) ≈ 1 - sum_{n<=R} m^n/n! e^-m, m = L*MTTR/MTBF",
    {"L_blocks": Lz, "MTTR_h": 24, "MTBF_block_h": 1000, "R_spares": Rz}, {"m": fl(m_z), "Pr_blocked": fl(pb_pois)},
    note="Regression golden; formula at line 1031 / 1733. Tail is ~1e-7, so implementations should sum the upper tail or keep double precision in 1 - CDF.")
add("meta.blocked_binomial_exact_L256_R22", G,
    "Pr(blocked) = 1 - (1 + rho)^-L * sum_{n<=R} C(L,n) rho^n, rho = MTTR/MTBF  (= Binomial(L, rho/(1+rho)) upper tail)",
    {"L_blocks": Lz, "MTTR_h": 24, "MTBF_block_h": 1000, "R_spares": Rz},
    {"rho": fl(rho), "Pr_blocked": fl(pb_bin), "ratio_poisson_over_exact": fl(pb_pois / pb_bin)},
    note="Regression golden; exact stationary distribution of the finite birth-death chain (line 1031).")
# 1/H scaling law with m held fixed
r_fix = {}
for Lh in (256, 512, 1024):
    Rh = min(R for R in range(0, Lh) if 1 - pois_cdf(m_z, R) <= pb_pois * (1 + mpf("1e-30")))
    r_fix[Lh] = Rh
add("meta.one_over_H_scaling_fixed_m", G, "with m = L*MTTR/MTBF held fixed, R is unchanged and R/L scales as 1/H",
    {"m": fl(m_z), "target_Pr_blocked": fl(pb_pois), "L_blocks": [256, 512, 1024]},
    {"R_spares": [r_fix[256], r_fix[512], r_fix[1024]],
     "spare_frac": [fl(mpf(r_fix[256]) / 256), fl(mpf(r_fix[512]) / 512), fl(mpf(r_fix[1024]) / 1024)]},
    "块缩小 H 倍 … 备件比例降为 1/H", f"{L(1031)}", "ok" if r_fix[256] == r_fix[512] == r_fix[1024] else "discrepancy",
    computed_str=f"R = {r_fix[256]}/{r_fix[512]}/{r_fix[1024]}", rel=1e-9,
    note="Exact only when the block MTBF scales with 1/H (tray-dominated); the rack term breaks it slightly (see Table 6-3 attempt).")
# Table 6-3 reverse engineering (optional)
t63 = []
for gpu_blk, frac_printed, strand_printed in [(72, "8.6", "3.9"), (36, "4.7", "7.8"), (18, "2.6", "9.9")]:
    K = mpf(gpu_blk) / 4                       # trays per block (4 GPU per compute tray)
    mtbf_blk = 1 / (K / 20000 + mpf(1) / 10000)
    Lb = 18432 // gpu_blk
    mb = Lb * 24 / mtbf_blk
    # R consistent with the printed percentage (1 decimal)
    cands = [R for R in range(1, Lb) if f"{fl(mpf(R)/Lb*100):.1f}" == frac_printed]
    Rb = cands[0]
    P = 2304 // gpu_blk                        # placement-group size in blocks
    working = ((Lb - Rb) // P) * P
    strand = mpf(Lb - Rb - working) / Lb
    pr_R = 1 - pois_cdf(mb, Rb)
    pr_Rm1 = 1 - pois_cdf(mb, Rb - 1)
    ub = rho_b = 24 / mtbf_blk
    ub = rho_b / (1 + rho_b)
    bpr_R = 1 - binom_cdf(Lb, Rb, ub)
    bpr_Rm1 = 1 - binom_cdf(Lb, Rb - 1, ub)
    t63.append((gpu_blk, K, mtbf_blk, Lb, mb, Rb, cands, strand, pr_R, pr_Rm1, bpr_R, bpr_Rm1))
    add(f"meta.table6-3.block{gpu_blk}gpu", G,
        "MTBF_block = 1/(K_trays/MTBF_tray + 1/MTBF_rack); L = 18432/gpu_per_block; R from printed spare fraction; stranded = (L-R - floor((L-R)/P)*P)/L",
        {"gpu_per_block": gpu_blk, "K_trays": fl(K), "MTBF_tray_h": 20000, "MTBF_rack_h": 10000, "MTTR_h": 24,
         "zone_gpu": 18432, "placement_group_gpu": 2304},
        {"MTBF_block_h": fl(mtbf_blk), "L_blocks": Lb, "m": fl(mb), "R_spares_from_printed_frac": Rb, "R_candidates": cands,
         "spare_frac": fl(mpf(Rb) / Lb), "stranded_frac": fl(strand),
         "Pr_blocked_poisson_at_R": fl(pr_R), "Pr_blocked_poisson_at_R_minus_1": fl(pr_Rm1),
         "Pr_blocked_binomial_at_R": fl(bpr_R), "Pr_blocked_binomial_at_R_minus_1": fl(bpr_Rm1)},
        f"块间备件 {frac_printed}%，stranded {strand_printed}%", f"Table 6-3 rows, {L(1734)}–{L(1749)}",
        "ok" if match_to(strand * 100, strand_printed) == "ok" else "discrepancy",
        computed_str=f"R = {Rb} ({fl(mpf(Rb)/Lb*100):.2f} %), stranded {fl(strand*100):.2f} %",
        note="The stranding term reproduces the printed 3.9/7.8/9.9 % exactly with R = 22/24/27, confirming those R. The blocked-probability target is reverse-engineered below.")
lo_t = max(x[8] for x in t63)
hi_t = min(x[9] for x in t63)
lo_tb = max(x[10] for x in t63)
hi_tb = min(x[11] for x in t63)


def band_str(lo, hi):
    return f"[{fl(lo):.3g}, {fl(hi):.3g})" if hi > lo else f"empty (needs ≥ {fl(lo):.3g} and < {fl(hi):.3g})"


def r_for_target(target, exact):
    out = []
    for gpu_blk, K, mtbf_blk, Lb, mb, Rb, cands, strand, *_ in t63:
        rho_b = 24 / mtbf_blk
        ub = rho_b / (1 + rho_b)
        R = 0
        while True:
            pr = (1 - binom_cdf(Lb, R, ub)) if exact else (1 - pois_cdf(mb, R))
            if pr <= target:
                break
            R += 1
        out.append(R)
    return out


targets = ["1e-6", "5e-7", "2e-7", "1e-7", "5e-8", "2e-8", "1e-8"]
scan_p = [r_for_target(mpf(t), False) for t in targets]
scan_b = [r_for_target(mpf(t), True) for t in targets]
want_R = [x[5] for x in t63]
add("meta.table6-3.common_target_band", G,
    "R(target) = min{R : Pr_blocked(R) <= target}; band of targets reproducing R = 22/24/27 is [max Pr(R), min Pr(R-1))",
    {"R_spares": [x[5] for x in t63], "m": [fl(x[4]) for x in t63]},
    {"poisson_band_lo": fl(lo_t), "poisson_band_hi": fl(hi_t), "poisson_band_nonempty": bool(hi_t > lo_t),
     "binomial_band_lo": fl(lo_tb), "binomial_band_hi": fl(hi_tb), "binomial_band_nonempty": bool(hi_tb > lo_tb)},
    "8.6% / 4.7% / 2.6%", f"Table 6-3, {L(1733)}", "ok" if (hi_t > lo_t or hi_tb > lo_tb) else "discrepancy",
    computed_str=f"Poisson band {band_str(lo_t, hi_t)}; exact-binomial band {band_str(lo_tb, hi_tb)}",
    note="R = 22/24/27 is certain (printed fractions and stranding). Under the Poisson approximation NO single target yields all three; "
         "with the exact binomial stationary distribution a common target exists only in a narrow band (~6-7e-8). Low confidence that the paper chose R from a probability target; see report.")
add("meta.table6-3.round_target_scan", G, "R(target) = min{R : Pr_blocked(R) <= target} for round targets, Poisson and exact binomial",
    {"targets": [float(mpf(t)) for t in targets], "R_printed": want_R},
    {"R_poisson": scan_p, "R_binomial": scan_b,
     "targets_reproducing_printed_poisson": [float(mpf(t)) for t, r in zip(targets, scan_p) if r == want_R],
     "targets_reproducing_printed_binomial": [float(mpf(t)) for t, r in zip(targets, scan_b) if r == want_R]},
    "8.6% / 4.7% / 2.6%（R = 22/24/27）", f"Table 6-3, {L(1733)}",
    "ok" if any(r == want_R for r in scan_p + scan_b) else "discrepancy", rel=1e-9,
    computed_str="; ".join(f"{t}: P {''.join(str(x)+'/' for x in rp)[:-1]} B {''.join(str(x)+'/' for x in rb)[:-1]}" for t, rp, rb in zip(targets, scan_p, scan_b)),
    note="No round target reproduces 22/24/27 under either distribution unless listed in targets_reproducing_*; informational.")

# ================================================================ 15. Benoit SC'19
G = "benoit-replication"
for b in (10, 100, 100000):
    lnratio = b * log(4) - (loggamma(2 * b + 1) - 2 * loggamma(b + 1))
    nf = 1 + exp(lnratio)
    approx = sqrt(pi * b)
    bday = sqrt(pi * b / 2)
    sv = "561" if b == 100000 else None
    add(f"benoit.n_fail_b{b}", G, "n_fail(2b) = 1 + 4^b / C(2b,b)  (via log-gamma)", {"b_pairs": b},
        {"n_fail": fl(nf), "sqrt_pi_b": fl(approx), "ratio_to_sqrt_pi_b_over_2": fl(nf / bday), "ratio_to_sqrt_pi_b": fl(nf / approx)},
        sv, f"{L(965)}" if sv else None, match_to(nf, sv) if sv else "n/a", computed_str=f"{fl(nf):.4f}" if sv else None,
        note="For large b, n_fail → sqrt(pi*b) + 1 ≈ 1.414 × sqrt(pi*b/2) ('40 % larger than the birthday estimate')." if b == 100000 else None)

# ========================================================================== 16. NTP
G = "ntp-amplification"
v = 1 - (1 - mpf("0.001")) ** 64
add("ntp.affected_fraction_p0.001_T64", G, "f = 1 - (1 - p)^T", {"p_frac": 0.001, "T": 64}, {"affected_frac": fl(v)},
    "约 0.062", f"{L(1132)}", match_to(v, "0.062"), computed_str=f"{fl(v):.5f}")
v72 = 1 - (1 - mpf("0.001")) ** 72
v8 = 1 - (1 - mpf("0.001")) ** 8
add("ntp.nvl72_block_vs_8gpu_node", G, "p_block = 1 - (1 - p_gpu)^72 ≈ 72 p_gpu; ratio to 8-GPU node", {"p_gpu_frac": 0.001},
    {"p_block_72_frac": fl(v72), "p_node_8_frac": fl(v8), "ratio": fl(v72 / v8)},
    "≈72 p_GPU，是 8 GPU 节点的 9 倍", f"{L(1132)}", "ok",
    computed_str=f"{fl(v72):.5f} vs {fl(v8):.5f}; ratio {fl(v72/v8):.3f} (→ 9 as p → 0)",
    note="'9×' is the small-p limit; at p = 0.001 the exact ratio is 8.72.")

# =================================================================== 17. availability
G = "availability-afr"
for tag, mttf, mttr, sv, line in [("delta_h100_node", mpf(292), mpf("2.2"), "99.3", 378),
                                   ("delta_a100_node", mpf(154), mpf("0.88"), "99.4", 378)]:
    A = mttf / (mttf + mttr)
    add(f"avail.{tag}", G, "A = MTTF/(MTTF + MTTR)", {"MTTF_h": fl(mttf), "MTTR_h": fl(mttr)},
        {"A_frac": fl(A), "downtime_min_per_day": fl((1 - A) * 1440)}, f"约 {sv}%", f"{L(line)}",
        match_to(A * 100, sv), computed_str=f"{pct(A)}; {fl((1-A)*1440):.2f} min/day",
        note="Survey's '每天停机 9–10 分钟' (line 1133/1905) corresponds to A = 99.3–99.4 % rounded; unrounded inputs give 10.8 / 8.2 min/day.")
for mttf_h, sv in [(mpf(10) ** 6, "0.88"), (mpf("1.5") * 10 ** 6, "0.58")]:
    afr = 8760 / mttf_h
    add(f"avail.afr_from_mttf_{int(mttf_h)}h", G, "AFR ≈ 8760/MTTF", {"MTTF_h": fl(mttf_h), "hours_per_year": 8760},
        {"AFR_frac": fl(afr), "FIT": fl(mpf(10) ** 9 / mttf_h)}, f"{sv}%", f"{L(110)}", match_to(afr * 100, sv),
        computed_str=pct(afr))
for a, sv in [("0.9932", "59.6"), ("0.9997", "2.6")]:
    d = (1 - mpf(a)) * 8760
    add(f"avail.calce_downtime_A{a}", G, "downtime_h_per_year = (1 - A)*8760", {"A_frac": float(a), "hours_per_year": 8760},
        {"downtime_h_per_year": fl(d)}, f"{sv} h", f"{L(1135)}", match_to(d, sv), computed_str=f"{fl(d):.3f} h")

# ======================================================================== 18. Weibull
G = "weibull"
for k, sv, line in [("0.7", "≈0.47（SIGMA 2.67/5.74）", 742), ("0.78", None, None)]:
    kk = mpf(k)
    ratio = log(2) ** (1 / kk) / gamma(1 + 1 / kk)
    add(f"weibull.median_over_mean_k{k}", G, "median/mean = (ln 2)^(1/k) / Gamma(1 + 1/k)", {"k_shape": float(k)},
        {"median_over_mean": fl(ratio), "gamma_1_plus_1_over_k": fl(gamma(1 + 1 / kk))},
        sv, f"{L(line)}" if sv else None, match_to(ratio, "0.47") if sv else "n/a",
        computed_str=f"{fl(ratio):.4f} (SIGMA observed 2.67/5.74 = {fl(mpf('2.67')/mpf('5.74')):.4f})" if sv else None,
        note="Survey infers k ≈ 0.7 from SIGMA's median/mean 2.67 h / 5.74 h." if sv else None)
kk, lam_w, Nw = mpf("0.78"), mpf("1e-5"), 1000
alpha = (1 / lam_w) / gamma(1 + 1 / kk)
alpha_N = alpha * mpf(Nw) ** (-1 / kk)
mttf_new = alpha_N * gamma(1 + 1 / kk)
add("weibull.mean_matched_scale_k0.78", G, "alpha = (1/lambda)/Gamma(1 + 1/k)", {"lambda_per_h": 1e-5, "k_shape": 0.78},
    {"alpha_h": fl(alpha), "check_mean_h": fl(alpha * gamma(1 + 1 / kk))},
    "α = (1/λ)/Γ(1 + 1/k)（AIReSim 均值匹配）", f"{L(1057)}", "ok", computed_str=f"{fl(alpha):.3f} h",
    note="'ok' = identity check: the Weibull mean equals 1/lambda = 1e5 h.")
add("weibull.series_N1000_k0.78", G,
    "alpha_N = alpha*N^(-1/k); MTTF_from_new = alpha_N*Gamma(1 + 1/k); exponential reference 1/(N*lambda)",
    {"lambda_per_h": 1e-5, "k_shape": 0.78, "N_units": Nw, "alpha_h": fl(alpha)},
    {"alpha_N_h": fl(alpha_N), "MTTF_from_new_h": fl(mttf_new), "MTTF_exponential_h": fl(1 / (Nw * lam_w)),
     "ratio_weibull_over_exponential": fl(mttf_new / (1 / (Nw * lam_w)))},
    "尺度按 N^(−1/k) 缩小，从新起算的系统 MTTF 按 N^(−1/k) 而非 1/N 下降", f"{L(1057)}", "ok",
    computed_str=f"{fl(mttf_new):.3f} h vs {fl(1/(Nw*lam_w)):.1f} h",
    note="Qualitative statement in the survey; numeric values are regression goldens.")

# ============================================================== 19. lognormal repair
G = "lognormal-repair"
mean_r, med_r = mpf(355), mpf(54)
sigma = sqrt(2 * log(mean_r / med_r))
mu_ln = log(med_r)
p90 = exp(mu_ln + z_quantile("0.90") * sigma)
p99 = exp(mu_ln + z_quantile("0.99") * sigma)
add("lognormal.lanl_repair_fit", G, "sigma = sqrt(2 ln(mean/median)); mu = ln(median); P_q = exp(mu + z_q sigma)",
    {"mean_min": 355, "median_min": 54},
    {"sigma": fl(sigma), "mu": fl(mu_ln), "P90_min": fl(p90), "P99_min": fl(p99),
     "check_mean_min": fl(exp(mu_ln + sigma ** 2 / 2)), "mean_over_median": fl(mean_r / med_r), "C2": fl(exp(sigma ** 2) - 1)},
    "均值 355 min 是中位数 54 min 的 6.6 倍", f"{L(318)}", match_to(mean_r / med_r, "6.6"),
    computed_str=f"ratio {fl(mean_r/med_r):.3f}; P90 {fl(p90):.1f} min, P99 {fl(p99):.1f} min",
    note="Lognormal parameters are not printed in DSN'06; these are the method-of-moments values from mean and median.")

# ==================================================================== 20. prediction
G = "prediction"
lam_p, Rc, Pr_ = mpf("0.323"), mpf("0.17"), mpf("0.84")
add("prediction.rates", G, "lambda_unplanned = (1-R)*lambda; lambda_alarm = R*lambda/P", {"lambda_per_h": 0.323, "recall_frac": 0.17, "precision_frac": 0.84},
    {"lambda_unplanned_per_h": fl((1 - Rc) * lam_p), "lambda_alarm_per_h": fl(Rc * lam_p / Pr_),
     "breakeven_C_unplanned_over_C_planned": fl(1 / Pr_)},
    "λ_unplanned = (1 − R)·λ; λ_alarm = R·λ/P", f"{L(1962)}", "ok",
    computed_str=f"{fl((1-Rc)*lam_p):.6f} /h; {fl(Rc*lam_p/Pr_):.6f} /h",
    note="Formula case; the survey prints no numeric instance. Prediction pays off only when C_unplanned > C_planned/P.")

# ============================================================ 21. Epoch replica model
G = "epoch-replica"
t_train = mpf(60) * 86400
N_e = 1000
lam_node_s = 8 * (mpf(1) / 50000) / 3600
for M_rep, tstep, sv_per in [(2, 10, "533"), (3, 10, "2.3e9")]:
    F = (t_train / tstep) * (mpf(N_e) / M_rep) * (lam_node_s * tstep) ** M_rep
    target = 1 / mpf(sv_per)
    if M_rep == 2:
        t_needed = target / (t_train * (mpf(N_e) / 2) * lam_node_s ** 2)
    else:
        t_needed = sqrt(target / (t_train * (mpf(N_e) / 3) * lam_node_s ** 3))
    add(f"epoch.replica_M{M_rep}_tstep10s", G, "F = (t_train/t_step)*(N_gpu/M)*(lambda_node*t_step)^M",
        {"t_train_days": 60, "N_gpu": N_e, "gpu_per_node": 8, "lambda_per_gpu_h": 2e-5, "lambda_node_per_s": fl(lam_node_s),
         "t_step_s": tstep, "M_replicas": M_rep},
        {"F_expected_unrecoverable_per_training": fl(F), "trainings_per_event": fl(1 / F),
         "t_step_s_needed_to_reproduce_survey": fl(t_needed)},
        f"M = {M_rep}: 每 {'533 次' if M_rep == 2 else '约 23 亿次'} 训练出一次", f"{L(1033)}; card {L(1213)}", "discrepancy",
        computed_str=f"1 per {fl(1/F):.4g} trainings",
        note="Assumption: t_step = 10 s, lambda_node = 8 × 1/50,000 per GPU·h. The printed formula with these inputs does not reproduce Epoch's quoted numbers; the t_step that would (366 s for M=2, 54 s for M=3) differ from each other, so no single t_step works. See report.")

# ================================================= extras: Epoch first-order (λ = 1/50,000)
G = "epoch-first-order"
M_ep = mpf(50000) / 16384 * 3600
tau_ep = young(DELTA, M_ep)
loss_ep = sqrt(2 * DELTA / M_ep)
rec_ep = (mpf(16384) / 50000) * mpf("5.1") / 60
add("epoch.fo.optimal_interval", G, "tau = sqrt(2*delta*M), M = 50000/N h", {"N_gpu": 16384, "lambda_per_gpu_h": 2e-5, "delta_s": 2.43},
    {"M_s": fl(M_ep), "tau_s": fl(tau_ep), "tau_min": fl(tau_ep / 60)}, "最优间隔约 4 min", f"{L(1129)}",
    match_to(tau_ep / 60, "4", ulp=1), computed_str=f"{fl(tau_ep/60):.3f} min")
add("epoch.fo.checkpoint_plus_redo_loss", G, "loss = sqrt(2*delta/M)", {"delta_s": 2.43, "M_s": fl(M_ep)}, {"loss_frac": fl(loss_ep)},
    "约 2.1%", f"{L(1129)}; {L(1072)}", match_to(loss_ep * 100, "2.1"), computed_str=pct(loss_ep))
add("epoch.fo.recovery_term", G, "recovery_loss = lambda_job*R = (N*lambda_gpu)*R", {"N_gpu": 16384, "lambda_per_gpu_h": 2e-5, "R_min": 5.1},
    {"recovery_loss_frac": fl(rec_ep), "total_loss_frac": fl(rec_ep + loss_ep)}, "约 2.8%（合计约 5%）", f"{L(1129)}; {L(1072)}",
    match_to(rec_ep * 100, "2.8"), computed_str=f"{pct(rec_ep)}; total {pct(rec_ep + loss_ep)}")

# =============================================== extras: Meta HPCA'25 ETTR planning statements
G = "meta-hpca-ettr"
for rf, wcp, sv, cid in [("6.50", 300, None, "meta_hpca.N12000_rf6.50_w300s"),
                          ("1.0", 300, "约 0.9", "meta_hpca.N12000_rf1.0_w300s"),
                          ("6.50", 10, "约 0.9", "meta_hpca.N12000_rf6.50_w10s")]:
    nodes = mpf(12000) / 8
    M = 1 / (nodes * mpf(rf) / 1000 / 24) * 3600
    dt = young(mpf(wcp), M)
    ettr = goodput_fo(mpf(wcp), dt, mpf(300), M)
    add(cid, G, "ETTR ≈ 1 - w_cp/dt - (dt/2 + u0)/M, dt = sqrt(2*w_cp*M), M = 1/(N_nodes*r_f)",
        {"N_gpu": 12000, "gpu_per_node": 8, "r_f_per_1000_node_day": float(rf), "w_cp_s": wcp, "u0_s": 300},
        {"M_s": fl(M), "dt_s": fl(dt), "ETTR_frac": fl(ettr)}, sv, f"{L(1610)}" if sv else None,
        (match_to(ettr, "0.9")) if sv else "n/a", computed_str=f"{fl(ettr):.4f}" if sv else None,
        note="First-order reproduction of the HPCA'25 planning statement; the paper's E[ETTR] also has a queueing term q (not modelled), so only '约 0.9' is checked." if sv else "Baseline before either lever is pulled; regression golden.")

# ======================================================================= extras: trivia
G = "misc-trivial"
v1 = (1 - mpf("0.001")) ** 100
v2 = (1 - mpf("0.0001")) ** 1000
add("misc.flashrecovery_no_failure_probabilities", G, "(1-p)^n", {"p1_frac": 0.001, "n1": 100, "p2_frac": 0.0001, "n2": 1000},
    {"p_no_failure_1": fl(v1), "p_no_failure_2": fl(v2)}, "0.90479 对 0.90483", f"{L(1508)}",
    "ok" if match_to(v1, "0.90479") == "ok" and match_to(v2, "0.90483") == "ok" else "rounding",
    computed_str=f"{fl(v1):.6f} vs {fl(v2):.6f}")
rs = {N: int(floor(log(N, 2) + mpf("0.833"))) for N in (200, 600, 1000)}
add("misc.spare_optimal_redundancy_r_star", G, "r* = floor(log2(N) + 0.833)", {"N": [200, 600, 1000]},
    {"r_star": [rs[200], rs[600], rs[1000]]}, "8/10/10", f"{L(1057)}",
    "ok" if (rs[200], rs[600], rs[1000]) == (8, 10, 10) else "discrepancy", computed_str=f"{rs[200]}/{rs[600]}/{rs[1000]}", rel=1e-9)
add("misc.meta_in_block_spare_fraction", G, "8/72", {"spare_trays_gpu": 8, "block_gpu": 72}, {"frac": fl(mpf(8) / 72)},
    "块内备份 11.1%", f"{L(1748)}", match_to(mpf(8) / 72 * 100, "11.1"), computed_str=pct(mpf(8) / 72, 2))
gr = mpf(61134) / 59821
add("misc.meta_goodput_ratio", G, "61,134 / 59,821", {"goodput_best_eq_gpu": 61134, "goodput_second_eq_gpu": 59821}, {"ratio": fl(gr)},
    "1.024×", f"{L(1748)}", match_to(gr, "1.024"), computed_str=f"{fl(gr):.4f}",
    note="The two printed goodput values give 1.022, not 1.024; the paper's ratio presumably used unrounded values or different operands.")
add("misc.hot_spare_fractions", G, "k/N", {"byterobust_spares": 8, "byterobust_nodes": 2048, "epoch_spares": 480, "epoch_nodes": 125000},
    {"byterobust_frac": fl(mpf(8) / 2048), "epoch_frac": fl(mpf(480) / 125000)}, "8 台约占 0.4%；480 个节点（约 0.3%）", f"{L(1131)}",
    "ok" if match_to(mpf(8) / 2048 * 100, "0.4") == "ok" and match_to(mpf(480) / 125000 * 100, "0.3", ulp=0.1) == "ok" else "rounding",
    computed_str=f"{pct(mpf(8)/2048, 3)}; {pct(mpf(480)/125000, 3)}")

# ================================================================== scipy/numpy self-check
def selfcheck():
    """Independent recomputation of the numerically delicate pieces with scipy/numpy (double precision)."""
    import numpy as np
    from scipy import stats, special
    tol = 1e-9

    def close(a, b, what):
        a, b = float(a), float(b)
        if abs(a - b) > tol * max(1.0, abs(a), abs(b)):
            raise SystemExit(f"selfcheck FAILED: {what}: mpmath {a!r} vs scipy {b!r}")

    class _ById(dict):
        def __missing__(self, key):
            k2 = nid(key)
            if k2 == key:
                raise KeyError(key)
            return self[k2]

    byid = _ById({c["id"]: c for c in cases})
    # binomial quantiles / tails
    for rf in ("2.3", "6.50"):
        p = float(rf) / 1000
        close(byid[f"ex3.r_f={rf}.binomial_quantile_0.99"]["expected"]["k"], stats.binom.ppf(0.99, 1024, p), "binom ppf 0.99")
        close(byid[f"ex3.r_f={rf}.binomial_quantile_0.999"]["expected"]["k"], stats.binom.ppf(0.999, 1024, p), "binom ppf 0.999")
        for mttr in ("8", "2.2"):
            m = 1024 * p / 24 * float(mttr)
            close(byid[f"ex3.r_f={rf}.poisson_quantile_0.99_MTTR{mttr}h"]["expected"]["k"], stats.poisson.ppf(0.99, m), "poisson ppf")
    for k in range(6):
        close(byid[f"ex4.p0.993.k{k}"]["expected"]["availability_frac"], stats.binom.sf(63, 64 + k, 0.993), f"ex4 k={k}")
    ps = byid["ironwood.p_from_k95_130"]["expected"]["p_frac"]
    close(0.95, stats.binom.sf(129, 144, ps), "ironwood root")
    close(byid["ironwood.k99_at_p_star"]["expected"]["P_ge_k99"], stats.binom.sf(126, 144, ps), "ironwood k99 tail")
    close(byid["byterobust.N1024.p_interval_for_P99_eq_4"]["expected"]["p_hi_frac_inclusive"],
          byid["byterobust.N1024.p_interval_for_P99_eq_4"]["expected"]["p_hi_frac_inclusive"], "noop")
    close(0.99, stats.binom.cdf(4, 1024, byid["byterobust.N1024.p_interval_for_P99_eq_4"]["expected"]["p_hi_frac_inclusive"]), "byterobust p_hi")
    close(0.99, stats.binom.cdf(3, 1024, byid["byterobust.N1024.p_interval_for_P99_eq_4"]["expected"]["p_lo_frac_exclusive"]), "byterobust p_lo")
    # Meta tails (relative 1e-9 on a 1e-7 tail is a real test of the sf path)
    close(byid["meta.blocked_poisson_L256_R22"]["expected"]["Pr_blocked"], stats.poisson.sf(22, 6.144), "poisson sf")
    close(byid["meta.blocked_binomial_exact_L256_R22"]["expected"]["Pr_blocked"], stats.binom.sf(22, 256, 0.024 / 1.024), "binom sf")
    # Lambert W, gamma, normal quantiles
    for cid, d, M in (("ex1.daly_exact_lambert_w", 2.43, byid["ex1.daly_exact_lambert_w"]["inputs"]["M_s"]),
                      ("daly.M15min.exact_lambert_w", 5.0, 15.0), ("daly.M1440min.exact_lambert_w", 5.0, 1440.0)):
        xi2 = d / (2 * M)
        eta = 2 * xi2 + 1 + special.lambertw(-np.exp(-2 * xi2 - 1), 0).real
        close(byid[cid]["expected"]["tau_s" if "tau_s" in byid[cid]["expected"] else "tau_min"], eta * M - d, f"lambertw {cid}")
    close(byid["weibull.median_over_mean_k0.7"]["expected"]["median_over_mean"], np.log(2) ** (1 / 0.7) / special.gamma(1 + 1 / 0.7), "weibull gamma")
    sig = byid["lognormal.lanl_repair_fit"]["expected"]["sigma"]
    close(byid["lognormal.lanl_repair_fit"]["expected"]["P99_min"], 54 * np.exp(stats.norm.ppf(0.99) * sig), "lognormal P99")
    # Benoit via scipy gammaln
    b = 100000
    close(byid["benoit.n_fail_b100000"]["expected"]["n_fail"], 1 + np.exp(b * np.log(4) - (special.gammaln(2 * b + 1) - 2 * special.gammaln(b + 1))), "benoit")
    # CTMC via numpy solve
    N, k, lam, mu = 1024, 4, 11.6e-6, 1 / 24
    A = np.zeros((k + 1, k + 1)); bvec = np.ones(k + 1)
    for j in range(k + 1):
        aj, bj = (N + k - j) * lam, j * mu
        A[j, j] = aj + bj
        if j + 1 <= k: A[j, j + 1] = -aj
        if j >= 1: A[j, j - 1] = -bj
    close(byid["ctmc.N1024_k4_numeric"]["expected"]["T0_h"], np.linalg.solve(A, bvec)[0], "ctmc T0")
    close(byid["ctmc.N1024_k4_steady_state_availability"]["expected"]["A_frac"],
          stats.binom.cdf(4, 1028, byid["ctmc.N1024_k4_steady_state_availability"]["expected"]["u_frac"]), "ctmc A")
    print("selfcheck passed (scipy/numpy agree with mpmath to 1e-9 relative)")


try:
    selfcheck()
except ImportError as exc:  # scipy/numpy optional
    print(f"selfcheck skipped: {exc}")

# ======================================================================= write outputs
out = {"version": "0.1", "generated": datetime.date.today().isoformat(), "tool": "python/mpmath (mp.dps=60)",
       "survey_source": "/private/tmp/claude-501/-Users-liqingchuan-Documents-projects-HAC-D/617f1a19-ec28-4034-8f9f-a12fcba9e7f4/scratchpad/survey_text.txt",
       "match_legend": {"ok": "within half a unit of the survey's last printed digit", "rounding": "within one unit (truncation/intermediate rounding)",
                        "discrepancy": "beyond one unit of the last printed digit", "n/a": "no survey value (regression golden)"},
       "cases": cases}
with open(os.path.join(HERE, "golden.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)

# ------------------------------------------------------------------------ report
GROUPS = [
    ("unit-conversion", "1. Unit conversions (Table 2-2)"),
    ("one-over-n-law", "2. 1/N law"),
    ("worked-example-1", "3. Worked example 1 (Table 6-5)"),
    ("worked-example-2", "4. Worked example 2 (Table 6-6)"),
    ("worked-example-3", "5. Worked example 3 (Table 6-7)"),
    ("worked-example-4", "6. Worked example 4 (Table 6-8)"),
    ("daly-2006", "7. Daly 2006"),
    ("saxena-2024", "8. Saxena 2024"),
    ("trainmover", "9. TrainMover ETTR(N)"),
    ("lablup", "10. Lablup"),
    ("ironwood-k-of-n", "11. Google Ironwood k-of-n"),
    ("byterobust", "12. ByteRobust binomial P99"),
    ("ctmc-first-passage", "13a. Textbook CTMC first passage"),
    ("rbd-basic", "13b. Basic RBD identities"),
    ("meta-poisson-sparing", "14. Meta Poisson blocked probability and Table 6-3"),
    ("benoit-replication", "15. Benoit SC'19 replication"),
    ("ntp-amplification", "16. NTP amplification"),
    ("availability-afr", "17. Availability and AFR"),
    ("weibull", "18. Weibull"),
    ("lognormal-repair", "19. Lognormal repair"),
    ("prediction", "20. Prediction rates"),
    ("epoch-replica", "21. Epoch replica model (optional)"),
    ("epoch-first-order", "Extra: Epoch first-order numbers (λ = 1/50,000)"),
    ("meta-hpca-ettr", "Extra: Meta HPCA'25 ETTR planning statements"),
    ("misc-trivial", "Extra: trivially available checks"),
]
counts = {}
for c in cases:
    counts[c["match"]] = counts.get(c["match"], 0) + 1

b72, b36, b18 = t63
lines = []
lines.append("# HAC-D golden vectors — independent verification report\n")
lines.append(f"Generated {out['generated']} by `compute_golden.py` (mpmath, 60 significant digits). "
             f"{len(cases)} cases; match counts: " + ", ".join(f"{k} = {v}" for k, v in sorted(counts.items())) + ".\n")
lines.append("`computed` is my value expressed in the survey's printed units; `survey` is the survey's printed value. "
             "Match: ok = within half a unit of the last printed digit; rounding = within one unit; "
             "discrepancy = beyond that; n/a = the survey prints no value (regression golden).\n")
for gid, title in GROUPS:
    lines.append(f"\n## {title}\n")
    lines.append("| id | formula | computed | survey | match |")
    lines.append("|---|---|---|---|---|")
    for c in cases:
        if c["group"] != gid:
            continue
        if c["survey"]:
            comp = c["survey"].get("computed") or "; ".join(f"{k} = {v:.6g}" if isinstance(v, float) else f"{k} = {v}" for k, v in c["expected"].items())
            svv = f"{c['survey']['value']} ({c['survey']['ref']})"
        else:
            comp = "; ".join(f"{k} = {v:.6g}" if isinstance(v, float) else f"{k} = {v}" for k, v in c["expected"].items())
            svv = "—"
        lines.append(f"| `{c['id']}` | {c['formula'].replace('|', '/')} | {comp} | {svv} | {c['match']} |")

ex1_tau = case_by_id("ex1.tau_yd")["expected"]["tau_s"]
scan_lines = "\n".join(f"  - target {t}: Poisson R = {'/'.join(map(str, rp))}, exact binomial R = {'/'.join(map(str, rb))}"
                       for t, rp, rb in zip(targets, scan_p, scan_b))
repro_p = [t for t, r in zip(targets, scan_p) if r == want_R]
repro_b = [t for t, r in zip(targets, scan_b) if r == want_R]
lines.append(f"""
## Discrepancies (beyond rounding)

1. **Epoch AI memory-replica model (`epoch.replica_M2_tstep10s`, `epoch.replica_M3_tstep10s`).** The survey (line 1033, card line 1213) prints
   F = (t_train/t_step)·(N_GPU/M)·(λ_node·t_step)^M and quotes Epoch's results "M = 2 once per 533 trainings, M = 3 once per ≈2.3 billion".
   With t_train = 60 days, N_GPU = 1,000, λ_node = 8 × 1/50,000 per GPU·h and t_step = 10 s the formula gives one event per
   {fl(1/((t_train/10)*(mpf(N_e)/2)*(lam_node_s*10)**2)):.4g} trainings (M = 2) and per {fl(1/((t_train/10)*(mpf(N_e)/3)*(lam_node_s*10)**3)):.4g} trainings (M = 3).
   F ∝ t_step for M = 2 and ∝ t_step² for M = 3, so the step time that would reproduce 533 is {fl(case_by_id("epoch.replica_M2_tstep10s")["expected"]["t_step_s_needed_to_reproduce_survey"]):.0f} s
   while the one reproducing 2.3 billion is {fl(case_by_id("epoch.replica_M3_tstep10s")["expected"]["t_step_s_needed_to_reproduce_survey"]):.1f} s; no single t_step works, and solving
   both quoted numbers simultaneously for (λ_node, t_step) gives λ_node ≈ 7.5e-3 /h and t_step ≈ 0.17 s, which are not Epoch's inputs.
   I believe the formula as transcribed (or the inputs Epoch actually used) differs from what produced the quoted numbers; the engine
   should be tested against the formula, not against 533 / 2.3e9. The two cases are regression goldens for the formula as printed.
2. **Meta Sparing goodput ratio (`misc.meta_goodput_ratio`).** 61,134 / 59,821 = {fl(gr):.4f}, printed as 1.024×. Minor; the paper's ratio was
   probably computed from unrounded goodput values. Not an engine formula.
3. **Meta Table 6-3 spare fractions (`meta.table6-3.round_target_scan`).** The printed 8.6 / 4.7 / 2.6 % (R = 22/24/27) cannot be produced by
   a single round blocked-probability threshold with the survey's reconstructed inputs, under either the Poisson approximation or the exact
   binomial (closest: Poisson 2e-7 → 22/24/26, 1e-7 → 23/24/27; binomial 1e-7 → 22/24/26, 5e-8 → 23/24/27). The printed numbers are the
   paper's outputs and are not claimed wrong; the selection criterion (or the block-MTBF / zone reconstruction) is what is unresolved.
   Details in the Table 6-3 section below.

## Rounding-level differences and inferred values (not discrepancies)

- `lablup.young_interval`: √(2·18 s·56.2 h) = {fl(t_lab / 60):.2f} min; the survey/paper print 44.9 (truncated; 44.98 rounds to 45.0).
- `saxena.caseA.young`: √(2·30 s·3600 s) = 7.746 min; printed 7.74 (truncation in the paper).
- `daly.M15min.exact_lambert_w`: exact root 9.17 min vs Daly's Monte-Carlo optimum 9.1 min; the three-term series gives 9.14. Daly's
  117 / 57 / 9.1 min are simulation optima (≤10,000 runs), so agreement to the printed digit is all one can expect.
- `misc.hot_spare_fractions`: 480/125,000 = 0.384 %, which the survey (quoting Epoch) calls "约 0.3 %".
- `avail.delta_*`: unrounded MTTF/MTTR give 10.8 and 8.2 min/day of downtime; the survey's "9–10 min/day" is the paper's rounded statement.
- `ironwood.p_from_k95_130`: the exact root of P(X ≥ 130) = 0.95 for Binomial(144, p) is p* = {fl(p_star):.5f}, which rounds to 0.935, the lower
  end of the survey's inferred band 0.935–0.940; at p* the 99 % point is k99 = {k99} (survey 127–128). At p = 0.935 / 0.940 the 95 % point is
  k95 = 130 in both cases and k99 = 127 / 128, so the survey's band is the set of p whose k95 rounds to the blog's 130. The blog's second
  point (k99 = 125) implies p = {fl(p_125):.4f}, confirming the survey's remark that the two blog points are not self-consistent.
- `benoit.n_fail_b100000`: 1 + 4^b/C(2b,b) = 561.4998, which rounds to 561 by 0.0002; implementations must use log-gamma (4^b overflows).

## Table 6-3 reverse engineering (optional item 14)

Block MTBF = 1/(K_trays/20,000 + 1/10,000) with K = 18 / 9 / 4.5 gives {fl(b72[2]):.0f} / {fl(b36[2]):.1f} / {fl(b18[2]):.1f} h; L = 256 / 512 / 1024 blocks per
18,432-GPU zone; m = L·MTTR/MTBF = {fl(b72[4]):.3f} / {fl(b36[4]):.3f} / {fl(b18[4]):.3f}. The printed spare fractions 8.6 / 4.7 / 2.6 % correspond to
R = {b72[5]} / {b36[5]} / {b18[5]} (the unique integers that round to the printed percentages), and the stranding term (L − R rounded down to a multiple
of the 2,304-GPU placement group) reproduces the printed 3.9 / 7.8 / 9.9 % exactly, so those R are certain.

The selection criterion is not reproduced, however. If R = min{{R : Pr(blocked) ≤ target}}, the target band that yields all three R is
{band_str(lo_t, hi_t)} under the Poisson approximation (the 72-GPU block needs target ≥ {fl(lo_t):.3g} while the 18-GPU block needs
target < {fl(hi_t):.3g}, so **no single Poisson target works**) and {band_str(lo_tb, hi_tb)} with the exact binomial stationary distribution.
Round targets give:
{scan_lines}
Targets reproducing 22/24/27: Poisson {repro_p or 'none'}, exact binomial {repro_b or 'none'}. My reading: the paper did not pick R from a
single blocked-probability threshold with these demo inputs (or its block MTBF / zone definition differs from the survey's reconstruction);
the fractions should be treated as the paper's printed outputs, and the engine should be validated on the formula (cases
`meta.blocked_poisson_L256_R22`, `meta.blocked_binomial_exact_L256_R22`) rather than on 8.6/4.7/2.6 %. The 1/H scaling law is exact when
m is held fixed (`meta.one_over_H_scaling_fixed_m`, R = 22 for L = 256/512/1024 → 8.6/4.3/2.1 %); with the rack term m grows
{fl(b72[4]):.1f} → {fl(b18[4]):.1f} and R grows 22 → 27, which is why the printed fractions are not exactly 1/H. Low confidence overall; time-boxed.

## Assumptions and conventions

- Worked example 1 uses the exact M = 54·24/419 h = 11,135.08 s (survey rounds to 11,135 s); the difference is below 1e-5 relative.
- Worked example 2 uses λ_GPU = 1/50,680 per GPU·h as the survey states (example 1's unrounded value is 1/50,677).
- TrainMover N = 8K … 128K are taken as 8,192 … 131,072; the printed "≈169 wasted GPUs" is reproduced only with N = 8,192.
- Daly's τ is the compute time between checkpoints (excluding δ); the Lambert-W solution uses the principal branch W0, whose
  argument −e^(−2ξ²−1) is within 2ξ² of the branch point −1/e; implementations need a Lambert W that is accurate there
  (series about the branch point or a well-seeded Halley iteration). The three-term series is the survey's/Daly's Eq. 37 form.
- Binomial / Poisson quantiles are "smallest k with CDF ≥ q" (ByteRobust P99 convention); k-of-n availability is P(X ≥ k).
- The CTMC first-passage recurrence is solved as a tridiagonal linear system; (a)–(c) agree with the textbook closed forms to 1e-40.
- Lognormal repair parameters are method-of-moments from mean and median (DSN'06 does not print μ, σ).
- `tolerance.rel` = 1e-6 for closed forms and root-finding results (bisection to machine precision reaches this), 1e-9 for integer
  results. Tiny probabilities (~1e-7) in the Meta cases are fine in double precision via 1 − CDF (absolute error ~1e-16).
- Cases with `survey: null` / `match: "n/a"` are regression goldens: the survey prints no number, the value pins the formula.
- A scipy/numpy self-check (`selfcheck()`) recomputes the distribution tails, quantiles, Lambert W, gamma, normal quantiles and the
  CTMC solve independently of the mpmath helpers; the run aborts if any differ by more than 1e-9 relative.
""")

with open(os.path.join(HERE, "golden-report.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print(f"wrote {len(cases)} cases -> golden.json, golden-report.md; matches: {counts}")
for c in cases:
    if c["match"] in ("discrepancy", "rounding"):
        print(f"  [{c['match']}] {c['id']}: {c['survey']['computed'] if c['survey'] else ''} vs {c['survey']['value'] if c['survey'] else ''}")
