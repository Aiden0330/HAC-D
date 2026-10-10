"""
Independent golden vectors for the v3 closed forms (docs/MODEL_REFERENCE.md §19–§20), computed from the
specification without reading the TypeScript engine:
  * mixed exact renewal goodput: running time per attempt by numerical quadrature of the survival function,
    attempts per completed interval, pauses by event class;
  * mechanism chain: recursive enumeration of the rung tree (applicable / success / failure);
  * silent-corruption delivery over a finite window: the alternating renewal process (Exp(ν) clean,
    deterministic dirty + pause c) solved as Volterra renewal equations on a grid with the exponential kernel
    integrated exactly against a piecewise-linear unknown (step h = c / 1200);
  * probability that a rollback clears an unpersisted corruption, by quadrature over a uniform phase.
Run: python3 compute_golden_v3.py  → golden_v3.json
"""
import json, math
import numpy as np
from mpmath import mp, mpf, quad, exp, expm1

mp.dps = 30

def mixed_renewal(tau_s, delta_s, lam_rb_per_h, R_rb_s, lam_p_per_h, R_p_s):
    tau, delta = mpf(tau_s) / 3600, mpf(delta_s) / 3600
    L = tau + delta
    lam = mpf(lam_rb_per_h)
    lamp = mpf(lam_p_per_h)
    Rrb, Rp = mpf(R_rb_s) / 3600, mpf(R_p_s) / 3600
    # running time of one attempt: E[min(X, L)] = ∫_0^L e^{-λs} ds (numerical)
    run_attempt = quad(lambda s: exp(-lam * s), [0, L]) if lam > 0 else L
    p_success = exp(-lam * L)
    attempts = 1 / p_success
    run_per_interval = run_attempt * attempts
    rb_events = attempts - 1
    pause = rb_events * Rrb + run_per_interval * lamp * Rp
    wall = run_per_interval + pause
    goodput = tau / wall
    running = run_per_interval / wall
    save = goodput * delta / tau
    return {
        "goodput": float(goodput),
        "runningFraction": float(running),
        "saveFraction": float(save),
        "rollbackFraction": float(running - goodput - save),
        "rollbackPauseFraction": float(rb_events * Rrb / wall),
        "pauseOnlyFraction": float(run_per_interval * lamp * Rp / wall),
    }

def chain(detect_s, global_s, params, applicable):
    """Enumerate replay → elastic → process → global recursively."""
    rungs = []
    if params.get("replay") and applicable.get("replay", 0) > 0:
        rungs.append(("replay", applicable["replay"], params["replay"]))
    if params.get("elastic") and applicable.get("elastic", 0) > 0:
        rungs.append(("elastic", applicable["elastic"], params["elastic"]))
    if params.get("process") and applicable.get("process", 0) > 0:
        rungs.append(("process", applicable["process"], params["process"]))
    acc = {"pReplay": 0.0, "pElastic": 0.0, "pProcess": 0.0, "pGlobal": 0.0, "pRollback": 0.0, "meanPauseS": 0.0, "pauseRollbackS": 0.0, "pauseNoRollbackS": 0.0, "localLossS": 0.0}
    def terminal(kind, p, pause, rollback, local):
        acc["p" + kind[0].upper() + kind[1:]] += p
        acc["meanPauseS"] += p * pause
        acc["localLossS"] += p * local
        if rollback:
            acc["pRollback"] += p
            acc["pauseRollbackS"] += p * pause
        else:
            acc["pauseNoRollbackS"] += p * pause
    def rec(i, p, failed):
        if p <= 0:
            return
        if i == len(rungs):
            terminal("global", p, detect_s + failed + global_s, True, 0.0)
            return
        kind, frac, prm = rungs[i]
        # not applicable
        rec(i + 1, p * (1 - frac), failed)
        tried = p * frac
        s = prm["success"]
        if kind == "replay":
            terminal("replay", tried * s, detect_s + failed + prm["successSeconds"], False, 0.0)
        elif kind == "elastic":
            d = prm["domains"]
            terminal("elastic", tried * s, failed + prm["syncSeconds"], False, max(0.0, detect_s + prm["recoverSeconds"] - prm["syncSeconds"]) / d)
        else:
            terminal("process", tried * s, detect_s + failed + prm["successSeconds"], True, 0.0)
        rec(i + 1, tried * (1 - s), failed + prm["failureSeconds"])
    rec(0, 1.0, 0.0)
    return acc

def sdc_delivery(T, nu, D, Rc, g, U):
    """Renewal equations for the alternating process, exact-kernel piecewise-linear convolution (numpy)."""
    c = D + Rc
    n_per_cycle = 1200
    h = c / n_per_cycle
    n = int(round(T / h))
    assert abs(n * h - T) < 1e-9, (n * h, T)  # cases are chosen so that T is a multiple of c / 1200
    C = n_per_cycle
    x = np.arange(n + 1) * h
    e = np.exp(-nu * x)
    I0 = e[:-1] - e[1:]
    J = (x[:-1] * e[:-1] - x[1:] * e[1:]) + (e[:-1] - e[1:]) / nu - x[:-1] * I0
    I1 = J / h
    W0 = I0 - I1
    def solve(base):
        m = np.zeros(n + 1)
        for i in range(n + 1):
            s = base(x[i])
            jmax = i - C
            if jmax > 0:
                # m[i-C-j] for j = 0..jmax-1 → indices i-C, i-C-1, ..., 1 ; m[i-C-j-1] → i-C-1, ..., 0
                upper = m[i - C - jmax + 1 : i - C + 1][::-1]
                lower = m[i - C - jmax : i - C][::-1]
                s += float(np.dot(upper, W0[:jmax]) + np.dot(lower, I1[:jmax]))
            m[i] = s
        return m[n]
    clean = solve(lambda t: (1 - math.exp(-nu * t)) / nu)          # E[clean time in [0, t]]
    episodes = solve(lambda t: 1 - math.exp(-nu * t))                # E[# episodes started]
    discovered = solve(lambda t: (1 - math.exp(-nu * (t - D))) if t > D else 0.0)  # E[# discovered]
    delivered = (g * clean - U * episodes) / T
    return {"delivered": delivered, "cleanTimeFraction": clean / T, "expectedEpisodes": episodes, "expectedDiscovered": discovered}

def p_clear(lam_rb_per_h, L_h):
    lam, L = mpf(lam_rb_per_h), mpf(L_h)
    # uniform phase φ in [0, L): P(rollback before the next write) = E[1 − e^{−λ(L−φ)}]
    return float(quad(lambda phi: 1 - exp(-lam * (L - phi)), [0, L]) / L)

cases = []
for cid, (tau, delta, lrb, Rrb, lp, Rp) in {
    "mixed.hard_only_100k": (300, 4, 1 / 3, 264.5, 0, 0),
    "mixed.replay_100k": (300, 4, 0.2073, 265.2, 0.1326, 29.06),
    "mixed.elastic_500k": (300, 4, 0.584, 269, 1.1155, 8.35),
    "mixed.pause_only": (300, 4, 0, 0, 0.5, 120),
    "mixed.fast_ckpt": (60, 1, 1.6667, 264.5, 0.3, 10),
}.items():
    cases.append({"id": cid, "group": "mixed", "inputs": {"tauS": tau, "deltaS": delta, "rollbackRatePerHour": lrb, "rollbackPauseS": Rrb, "pauseRatePerHour": lp, "pauseS": Rp}, "expected": mixed_renewal(tau, delta, lrb, Rrb, lp, Rp), "tolerance": {"rel": 1e-9, "abs": 1e-15}})

P = {"replay": {"success": 0.9, "successSeconds": 5, "failureSeconds": 10}, "elastic": {"domains": 50, "success": 0.98, "recoverSeconds": 180, "failureSeconds": 120, "syncSeconds": 1}, "process": {"success": 0.95, "successSeconds": 60, "failureSeconds": 120}}
for cid, (d, g, params, app) in {
    "chain.gpu_all": (12.5, 252, P, {"replay": 0.831, "process": 1, "elastic": 1}),
    "chain.other_partial": (12.5, 252, P, {"replay": 0, "process": 0.361, "elastic": 0.361}),
    "chain.replay_only": (12.5, 252, {"replay": P["replay"]}, {"replay": 0.7}),
    "chain.process_only_zero_detect": (0, 300, {"process": P["process"]}, {"process": 1}),
    "chain.none": (12.5, 252, {}, {"replay": 1, "process": 1, "elastic": 1}),
}.items():
    cases.append({"id": cid, "group": "chain", "inputs": {"detectS": d, "globalS": g, "params": params, "applicable": app}, "expected": chain(d, g, params, app), "tolerance": {"rel": 1e-12, "abs": 1e-15}})

for cid, (T, nu, D, Rc, g, U) in {
    "sdc.reference_100k": (720, 4.647e-3, 119.93, 0.07, 0.94741, 0.0418),
    "sdc.reference_500k": (720, 0.02146, 119.93, 0.07, 0.81534, 0.0418),
    "sdc.day_fallback": (720, 0.02, 23.5, 0.5, 0.9, 0.04),
    "sdc.rare": (720, 1e-4, 119.93, 0.07, 0.98, 0.04),
    "sdc.short_window": (240, 0.05, 5.95, 0.05, 0.85, 0.02),
}.items():
    cases.append({"id": cid, "group": "sdc", "inputs": {"horizonH": T, "nuPerWallHour": nu, "fallbackDelayH": D, "episodePauseH": Rc, "cleanGoodput": g, "preEpisodeLossH": U}, "expected": sdc_delivery(T, nu, D, Rc, g, U), "tolerance": {"rel": 2e-6}})

for cid, (lam, L) in {"pclear.100k": (1 / 3, 304 / 3600), "pclear.500k": (1 / 0.6, 304 / 3600), "pclear.tiny": (1e-4, 304 / 3600)}.items():
    cases.append({"id": cid, "group": "pclear", "inputs": {"rollbackRatePerHour": lam, "periodH": L}, "expected": {"p": p_clear(lam, L)}, "tolerance": {"rel": 1e-9}})

out = {
    "version": "3.0",
    "generated": "2026-10-10",
    "tool": "python/mpmath (mp.dps=30) quadrature; renewal equations on a grid with exact exponential kernel",
    "spec": "docs/MODEL_REFERENCE.md §19 (mechanism chain, mixed renewal), §20 (silent-corruption delivery)",
    "cases": cases,
}
with open(__file__.replace("compute_golden_v3.py", "golden_v3.json"), "w") as f:
    json.dump(out, f, indent=1)
print(len(cases), "cases")
for c in cases:
    print(c["id"], {k: (round(v, 8) if isinstance(v, float) else v) for k, v in c["expected"].items()})
