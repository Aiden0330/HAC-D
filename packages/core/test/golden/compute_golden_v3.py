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

CHAIN_ORDER = ["predict", "netfail", "replay", "hotswap", "elastic", "process"]
DELAYED_RUNGS = ["replay", "hotswap", "elastic", "process"]

def rung_order(order):
    """v3.5: the given detection-delayed rungs first (unknown / duplicate names ignored), then the missing ones in the default order."""
    out = []
    for r in (order or []):
        if r in DELAYED_RUNGS and r not in out:
            out.append(r)
    for r in DELAYED_RUNGS:
        if r not in out:
            out.append(r)
    return ["predict", "netfail"] + out

def chain(detect_s, global_s, params, applicable, order=None):
    """Enumerate predict → netfail → replay → hotswap → elastic → process → global recursively (spec §19 and §19.1).
    predict: recall r turns the event into a planned migration (pause f + t_mig, no detection delay, no rollback); a miss
    costs nothing. netfail: absorbed inside the collective (pause f + t_nf, no detection delay, no rollback). hotswap:
    pause d + f + t_hs, no rollback. A rung's applicable fraction must be given explicitly (missing = 0)."""
    # v3.7 custom rungs: transparent ones right after netfail (no detection delay unless flagged), delayed ones after the ordered rungs
    custom = params.get("custom") or {}
    capp = applicable.get("custom") or {}
    customs = lambda pos: [(("custom", cid), capp.get(cid, 0.0), cr) for cid, cr in custom.items() if cr.get("position", "transparent") == pos and capp.get(cid, 0.0) > 0]
    front = [(kind, applicable.get(kind, 0.0), params[kind]) for kind in ["predict", "netfail"] if params.get(kind) and applicable.get(kind, 0.0) > 0]
    delayed = [(kind, applicable.get(kind, 0.0), params[kind]) for kind in rung_order(order)[2:] if params.get(kind) and applicable.get(kind, 0.0) > 0]
    rungs = front + customs("transparent") + delayed + customs("delayed")
    acc = {"pPredict": 0.0, "pNetfail": 0.0, "pReplay": 0.0, "pHotswap": 0.0, "pElastic": 0.0, "pProcess": 0.0, "pGlobal": 0.0, "pCustom": 0.0,
           "pRollback": 0.0, "meanPauseS": 0.0, "pauseRollbackS": 0.0, "pauseNoRollbackS": 0.0, "localLossS": 0.0}
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
        if isinstance(kind, tuple):
            s_ = prm["success"]
            terminal("custom", tried * s_, (detect_s if prm.get("detectionDelay") else 0.0) + failed + prm["successSeconds"], bool(prm.get("rollback")), float(prm.get("localLossSeconds", 0.0)))
            rec(i + 1, tried * (1 - s_), failed + prm.get("failureSeconds", 0.0))
            return
        if kind == "predict":
            r = prm["recall"]
            terminal("predict", tried * r, failed + prm["migrationSeconds"], False, 0.0)
            rec(i + 1, tried * (1 - r), failed)  # a missed prediction charges no time
            return
        s = prm["success"]
        if kind == "netfail":
            terminal("netfail", tried * s, failed + prm["successSeconds"], False, 0.0)
        elif kind == "replay":
            terminal("replay", tried * s, detect_s + failed + prm["successSeconds"], False, 0.0)
        elif kind == "hotswap":
            terminal("hotswap", tried * s, detect_s + failed + prm["successSeconds"], False, 0.0)
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
    def solve_grid(base_idx):
        m = np.zeros(n + 1)
        for i in range(n + 1):
            s = base_idx(i)
            jmax = i - C
            if jmax > 0:
                # m[i-C-j] for j = 0..jmax-1 → indices i-C, i-C-1, ..., 1 ; m[i-C-j-1] → i-C-1, ..., 0
                upper = m[i - C - jmax + 1 : i - C + 1][::-1]
                lower = m[i - C - jmax : i - C][::-1]
                s += float(np.dot(upper, W0[:jmax]) + np.dot(lower, I1[:jmax]))
            m[i] = s
        return m
    def solve(base):
        return solve_grid(lambda i: base(x[i]))[n]
    def simpson(q, h):
        """composite Simpson over the grid values q (odd interval counts end with the 3/8 rule)"""
        m = len(q) - 1
        if m <= 0:
            return 0.0
        if m == 1:
            return h * (q[0] + q[1]) / 2
        if m % 2 == 0:
            return h / 3 * (q[0] + q[-1] + 4 * q[1:-1:2].sum() + 2 * q[2:-1:2].sum())
        head = simpson(q[: m - 2], h) if m - 3 >= 0 else 0.0
        return head + 3 * h / 8 * (q[m - 3] + 3 * q[m - 2] + 3 * q[m - 1] + q[m])
    clean = solve(lambda t: (1 - math.exp(-nu * t)) / nu)          # E[clean time in [0, t]]
    episodes = solve(lambda t: 1 - math.exp(-nu * t))                # E[# episodes started]
    discovered = solve(lambda t: (1 - math.exp(-nu * (t - D))) if t > D else 0.0)  # E[# discovered]
    delivered = (g * clean - U * episodes) / T
    # v3.5 discard-all rule: F(t) = e^{-νt} g t + ∫_0^{t-c} ν e^{-νx} [g x − U + F(t − x − c)] dx (the window delivers only when it
    # ends clean; an episode that starts at x and does not finish by t delivers nothing), same renewal recursion as above
    # the work before the first episode counts only if the remaining window ends clean: F(t) = e^{-νt} g t
    # + ∫_0^{t-c} ν e^{-νx} [(g x − U)·Pc(t − x − c) + F(t − x − c)] dx with Pc(t) = e^{-νt} + ∫ ν e^{-νx} Pc(t − x − c) dx
    pc = solve_grid(lambda i: math.exp(-nu * x[i]))
    def analytic_idx(i):
        t = x[i]
        base = math.exp(-nu * t) * g * t
        j = i - C
        if j <= 0:
            return base
        xs = x[: j + 1]
        q = nu * np.exp(-nu * xs) * (g * xs - U) * pc[j::-1]
        return base + simpson(q, h)
    discard = solve_grid(analytic_idx)[n] / T
    p_clean_end = pc[n]
    return {"delivered": delivered, "cleanTimeFraction": clean / T, "expectedEpisodes": episodes, "expectedDiscovered": discovered,
            "deliveredDiscardAll": discard, "pUnresolvedAtEnd": 1 - p_clean_end}

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

# v3.2 rungs (spec §19.1): predict → netfail → replay → hotswap → elastic → process → global
P32 = {**P, "predict": {"recall": 0.5, "precision": 0.8, "migrationSeconds": 180}, "netfail": {"success": 0.95, "successSeconds": 2, "failureSeconds": 10}, "hotswap": {"success": 0.9, "successSeconds": 180, "failureSeconds": 60}}
for cid, (d, g, params, app) in {
    "chain.v32_full": (12.5, 252, P32, {"predict": 0.3, "netfail": 0.2, "replay": 0.831, "hotswap": 1, "elastic": 1, "process": 1}),
    "chain.v32_predict_hotswap": (12.5, 252, {"predict": P32["predict"], "hotswap": P32["hotswap"]}, {"predict": 1, "hotswap": 0.5}),
    "chain.v32_netfail_partial_timeout": (60, 300, {"netfail": P32["netfail"], "replay": P["replay"]}, {"netfail": 0.6, "replay": 0.4}),
    "chain.v32_all_applicable_full_recall": (12.5, 252, {**P32, "predict": {"recall": 1, "precision": 0.5, "migrationSeconds": 120}}, {"predict": 1, "netfail": 1, "replay": 1, "hotswap": 1, "elastic": 1, "process": 1}),
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

# v3.7 custom rungs of the mechanism audit (link-transparent recovery, fabric degrade with degraded running, a delayed rung with rollback)
CR = {
    "R-LINK-LOCAL": {"success": 0.9, "successSeconds": 2, "failureSeconds": 10, "rollback": False, "detectionDelay": False, "localLossSeconds": 0, "position": "transparent"},
    "R-FABRIC-DEGRADE": {"success": 0.8, "successSeconds": 2, "failureSeconds": 10, "rollback": False, "detectionDelay": False, "localLossSeconds": 163.636, "position": "transparent"},
    "X-DELAYED": {"success": 0.7, "successSeconds": 40, "failureSeconds": 20, "rollback": True, "detectionDelay": True, "localLossSeconds": 0, "position": "delayed"},
}
for cid, (d, g, params, app) in {
    "chain.v37_custom_transparent": (12.5, 252, {"custom": {"R-LINK-LOCAL": CR["R-LINK-LOCAL"]}}, {"custom": {"R-LINK-LOCAL": 1}}),
    "chain.v37_custom_mixed": (12.5, 252, {**P32, "custom": CR}, {"predict": 0.3, "netfail": 0.5, "replay": 0.831, "hotswap": 0.5, "elastic": 1, "process": 1, "custom": {"R-LINK-LOCAL": 0.6, "R-FABRIC-DEGRADE": 0.4, "X-DELAYED": 0.5}}),
    "chain.v37_custom_delayed_only": (30, 300, {"custom": {"X-DELAYED": CR["X-DELAYED"]}, "replay": P["replay"]}, {"replay": 0.5, "custom": {"X-DELAYED": 1}}),
}.items():
    cases.append({"id": cid, "group": "chain", "inputs": {"detectS": d, "globalS": g, "params": params, "applicable": app}, "expected": chain(d, g, params, app), "tolerance": {"rel": 1e-12, "abs": 1e-15}})

# v3.5 configurable order of the detection-delayed rungs
for cid, (d, g, params, app, order) in {
    "chain.order_process_first": (12.5, 252, P, {"replay": 1, "process": 1, "elastic": 1}, ["process", "replay", "elastic"]),
    "chain.order_elastic_hotswap_partial": (12.5, 252, P32, {"predict": 0.3, "netfail": 0.2, "replay": 0.831, "hotswap": 1, "elastic": 1, "process": 1}, ["elastic", "hotswap"]),
    "chain.order_unknown_names_ignored": (60, 300, P, {"replay": 0.5, "process": 0.5, "elastic": 0.5}, ["global", "process", "process"]),
}.items():
    cases.append({"id": cid, "group": "chain", "inputs": {"detectS": d, "globalS": g, "params": params, "applicable": app, "order": order}, "expected": chain(d, g, params, app, order), "tolerance": {"rel": 1e-12, "abs": 1e-15}})

for cid, (lam, L) in {"pclear.100k": (1 / 3, 304 / 3600), "pclear.500k": (1 / 0.6, 304 / 3600), "pclear.tiny": (1e-4, 304 / 3600)}.items():
    cases.append({"id": cid, "group": "pclear", "inputs": {"rollbackRatePerHour": lam, "periodH": L}, "expected": {"p": p_clear(lam, L)}, "tolerance": {"rel": 1e-9}})

out = {
    "version": "3.5",
    "generated": "2026-10-13",
    "tool": "python/mpmath (mp.dps=30) quadrature; renewal equations on a grid with exact exponential kernel",
    "spec": "docs/MODEL_REFERENCE.md §19 (mechanism chain, mixed renewal), §20 (silent-corruption delivery)",
    "cases": cases,
}
with open(__file__.replace("compute_golden_v3.py", "golden_v3.json"), "w") as f:
    json.dump(out, f, indent=1)
print(len(cases), "cases")
for c in cases:
    print(c["id"], {k: (round(v, 8) if isinstance(v, float) else v) for k, v in c["expected"].items()})
