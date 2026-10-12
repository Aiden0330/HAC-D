#!/usr/bin/env python3
"""
compute_golden_v2.py -- independent golden test vectors for the HAC-D v2 reliability models
(docs/MODEL_REFERENCE.md, "v2 additions", §10–§17).

Run from the repository root (regenerates golden_v2.json and golden-v2-report.md next to this file):

  uv run --with numpy --with scipy --with mpmath python packages/core/test/golden/compute_golden_v2.py

Independence rule: this file was written from the specification text only; no engine source
(packages/core/src) was consulted.  Every CTMC below is assembled from the state/transition table
of its section, solved for the stationary distribution (pi Q = 0, sum pi = 1) and for mean
first-passage times ((-Q_TT) t = 1 over the transient = up set) with mpmath at 40 significant
digits.  The same linear systems are re-solved in double precision with numpy (LU) and scipy
(null space of Q^T) as a cross-check; the largest disagreement is printed in the report.
Failure frequency nu = sum_{i in up, j in down} pi_i Q_ij.

Conventions of golden_v2.json
  * inputs are hours and per-hour unless the key ends in `_s` (seconds); `crews: null` = unlimited;
    `s`/`T_a` are null for a legacy (manual-only, c = 0) repair.
  * tolerance.rel = 1e-9 for exact (CTMC / closed-form) quantities, 1e-6 where the spec calls the
    formula first-order (§12, and §17 which contains §12).  tolerance.abs, when present, exists only
    for expected values that are structurally zero (unreachable state, t_sw = 0).
"""
import datetime
import json
import os
import re

import numpy as np
from scipy import linalg as sla
from mpmath import mp, mpf, matrix, lu_solve, binomial

mp.dps = 40
HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = "docs/MODEL_REFERENCE.md, v2 additions §10–§17"

cases = []
checks = []        # (name, abs_diff, rel_diff, note)
report_sections = []   # (title, [lines])
XC = {"chains": 0, "pi_rel": mpf(0), "pi_abs": mpf(0), "ns_rel": mpf(0), "mfpt_rel": mpf(0),
      "worst_pi": "", "worst_mfpt": "", "mfpt_solves": 0}
MODE = ["mp"]      # "mp": mpmath solutions are used; "np": the numpy double-precision solutions are used
NPAGREE = []       # per case: (id, max rel diff over expected values, worst key)


# ----------------------------------------------------------------------------- helpers
def fl(x):
    return float(x)


def jnum(x):
    if x is None or isinstance(x, (str, bool, int)):
        return x
    if isinstance(x, (list, tuple)):
        return [jnum(v) for v in x]
    return float(x)


def g(x, nd=15):
    return f"{fl(x):.{nd}g}"


def add(cid, group, formula, inputs, expected, notes="", rel=1e-9, abs_tol=None):
    assert re.fullmatch(r"[a-z0-9][a-z0-9._-]*", cid), cid
    assert all(c["id"] != cid for c in cases), f"duplicate id {cid}"
    tol = {"rel": rel}
    if abs_tol is not None:
        tol["abs"] = abs_tol
    c = {"id": cid, "group": group, "formula": formula, "inputs": inputs,
         "expected": {k: jnum(v) for k, v in expected.items()}, "tolerance": tol, "notes": notes}
    cases.append(c)
    return c


def check(name, a, b, note=""):
    a, b = mpf(a), mpf(b)
    d = abs(a - b)
    m = max(abs(a), abs(b))
    r = d / m if m > 0 else mpf(0)
    if MODE[0] == "mp":
        checks.append((name, d, r, note))
    return d


def both(cid, fn):
    """Run a case's computation with the mpmath solutions, then again with the numpy double-precision
    solutions of the same linear systems; record the largest relative difference over its numeric outputs.
    Keys starting with '_' are diagnostics for the notes/report and are not part of `expected`."""
    MODE[0] = "mp"
    e_mp = fn()
    MODE[0] = "np"
    e_np = fn()
    MODE[0] = "mp"
    worst, wkey = mpf(0), ""
    for k_, v in e_mp.items():
        if k_.startswith("_"):
            continue              # diagnostics (some are residuals of order 1e-41) are not compared
        vals = v if isinstance(v, (list, tuple)) else [v]
        vals_np = e_np[k_] if isinstance(v, (list, tuple)) else [e_np[k_]]
        for x, y in zip(vals, vals_np):
            if not isinstance(x, (int, float, mpf)) or isinstance(x, bool):
                continue          # strings, None, nested diagnostics (report rows) are not compared
            x, y = mpf(x), mpf(y)
            m = max(abs(x), abs(y))
            r = abs(x - y) / m if m > 0 else mpf(0)
            if r > worst:
                worst, wkey = r, k_
    NPAGREE.append((cid, worst, wkey))
    expected = {k_: v for k_, v in e_mp.items() if not k_.startswith("_")}
    return expected, e_mp, worst


def section(title, lines):
    report_sections.append((title, lines))


def table(rows, header):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return out


# ----------------------------------------------------------------------------- CTMC
class Chain:
    """Finite CTMC assembled from labelled states and positive transition rates."""

    def __init__(self, name):
        self.name = name
        self.labels, self.index, self.up, self.attr, self.rates = [], {}, {}, {}, {}
        self.pi_mp, self.pi_np, self._Q, self.pruned = None, None, None, []

    def state(self, label, up, **attr):
        assert label not in self.index, label
        self.index[label] = len(self.labels)
        self.labels.append(label)
        self.up[label] = bool(up)
        self.attr[label] = attr

    def rate(self, src, dst, r):
        r = mpf(r)
        assert r >= 0 and src != dst, (src, dst, r)
        if r == 0:
            return
        key = (self.index[src], self.index[dst])
        self.rates[key] = self.rates.get(key, mpf(0)) + r

    def prune_unreachable(self, start):
        """Drop states that cannot be reached from `start` (e.g. D_a when c = 0)."""
        succ = {}
        for (i, j) in self.rates:
            succ.setdefault(i, []).append(j)
        reach, stack = {self.index[start]}, [self.index[start]]
        while stack:
            i = stack.pop()
            for j in succ.get(i, []):
                if j not in reach:
                    reach.add(j)
                    stack.append(j)
        keep = [i for i in range(len(self.labels)) if i in reach]
        new_index = {i: r for r, i in enumerate(keep)}
        self.pruned = [self.labels[i] for i in range(len(self.labels)) if i not in reach]
        self.rates = {(new_index[i], new_index[j]): r for (i, j), r in self.rates.items() if i in reach and j in reach}
        labels = [self.labels[i] for i in keep]
        self.labels = labels
        self.index = {lab: r for r, lab in enumerate(labels)}
        self.up = {lab: self.up[lab] for lab in labels}
        self.attr = {lab: self.attr[lab] for lab in labels}
        self._Q = None
        return self

    def Q(self):
        if self._Q is None:
            n = len(self.labels)
            Q = matrix(n, n)
            for (i, j), r in self.rates.items():
                Q[i, j] = Q[i, j] + r
                Q[i, i] = Q[i, i] - r
            self._Q = Q
        return self._Q

    def Q_np(self):
        n = len(self.labels)
        Q = np.zeros((n, n))
        for (i, j), r in self.rates.items():
            Q[i, j] += float(r)
            Q[i, i] -= float(r)
        return Q

    def solve(self):
        """pi Q = 0 with sum pi = 1 (one balance equation replaced by the normalisation)."""
        n = len(self.labels)
        Q = self.Q()
        A, b = matrix(n, n), matrix(n, 1)
        for i in range(n):
            for j in range(n):
                A[i, j] = Q[j, i]
        for j in range(n):
            A[n - 1, j] = mpf(1)
        b[n - 1] = mpf(1)
        pi = lu_solve(A, b)
        self.pi_mp = [pi[i] for i in range(n)]
        resid = max(abs(sum((self.pi_mp[i] * Q[i, j] for i in range(n)), mpf(0))) for j in range(n))
        assert resid < mpf(10) ** (-(mp.dps - 6)), (self.name, resid)
        assert min(self.pi_mp) > 0, (self.name, min(self.pi_mp))
        # double-precision cross-checks: numpy LU on the same system, scipy null space of Q^T
        Qn = self.Q_np()
        An = Qn.T.copy()
        An[n - 1, :] = 1.0
        bn = np.zeros(n)
        bn[n - 1] = 1.0
        pin = np.linalg.solve(An, bn)
        ns = sla.null_space(Qn.T)
        assert ns.shape[1] == 1, (self.name, ns.shape)
        pis = ns[:, 0] / ns[:, 0].sum()
        self.pi_np = [mpf(x) for x in pin]
        if MODE[0] == "mp":
            XC["chains"] += 1
            for i in range(n):
                rel = abs(self.pi_np[i] - self.pi_mp[i]) / self.pi_mp[i]
                if rel > XC["pi_rel"]:
                    XC["pi_rel"], XC["worst_pi"] = rel, f"{self.name}, state {self.labels[i]}, pi = {fl(self.pi_mp[i]):.3e}"
                XC["pi_abs"] = max(XC["pi_abs"], abs(self.pi_np[i] - self.pi_mp[i]))
                XC["ns_rel"] = max(XC["ns_rel"], abs(mpf(pis[i]) - self.pi_mp[i]) / self.pi_mp[i])
        return self

    @property
    def pi(self):
        return self.pi_np if MODE[0] == "np" else self.pi_mp

    def p(self, label):
        return self.pi[self.index[label]] if label in self.index else mpf(0)

    def mass(self, pred):
        return sum((self.pi[i] for i, lab in enumerate(self.labels) if pred(lab)), mpf(0))

    def flux(self, from_pred, to_pred):
        return sum((self.pi[i] * r for (i, j), r in self.rates.items()
                    if from_pred(self.labels[i]) and to_pred(self.labels[j])), mpf(0))

    def mfpt(self, start, target_pred):
        """Mean first passage from `start` into the target set: (-Q_TT) t = 1 on the transient set."""
        T = [i for i, lab in enumerate(self.labels) if not target_pred(lab)]
        pos = {i: r for r, i in enumerate(T)}
        Q = self.Q()
        M, b = matrix(len(T), len(T)), matrix(len(T), 1)
        for r_, i in enumerate(T):
            for c_, j in enumerate(T):
                M[r_, c_] = -Q[i, j]
            b[r_] = mpf(1)
        t = lu_solve(M, b)
        val = t[pos[self.index[start]]]
        Mn = -self.Q_np()[np.ix_(T, T)]
        tn = np.linalg.solve(Mn, np.ones(len(T)))
        val_np = mpf(tn[pos[self.index[start]]])
        if MODE[0] == "mp":
            rel = abs(val_np - val) / val
            XC["mfpt_solves"] += 1
            if rel > XC["mfpt_rel"]:
                XC["mfpt_rel"], XC["worst_mfpt"] = rel, self.name
        return val_np if MODE[0] == "np" else val

    def is_up(self, lab):
        return self.up[lab]

    def is_down(self, lab):
        return not self.up[lab]


def two_state_eq(A, nu):
    """Equivalent two-state unit of a block with availability A and failure frequency nu."""
    return {"lambda_eq": nu / A, "MTTR_eq": (1 - A) / nu}


# ----------------------------------------------------------------------------- §10 repair
def repair(c, T_m, s=None, T_a=None):
    legacy = s is None
    return {"c": mpf(c), "T_m": mpf(T_m), "s": mpf(1) if legacy else mpf(s),
            "T_a": mpf(1) if legacy else mpf(T_a), "legacy": legacy}


def repair_inputs(rp):
    return {"c": fl(rp["c"]), "s": None if rp["legacy"] else fl(rp["s"]),
            "T_a": None if rp["legacy"] else fl(rp["T_a"]), "T_m": fl(rp["T_m"])}


def E_R(rp):
    return rp["c"] * rp["T_a"] + (1 - rp["c"] * rp["s"]) * rp["T_m"]


def unit_chain(lam, rp):
    ch = Chain("§10 unit")
    ch.state("U", True)
    ch.state("Da", False)
    ch.state("Dm", False)
    ch.rate("U", "Da", lam * rp["c"])
    ch.rate("U", "Dm", lam * (1 - rp["c"]))
    ch.rate("Da", "U", rp["s"] / rp["T_a"])
    ch.rate("Da", "Dm", (1 - rp["s"]) / rp["T_a"])
    ch.rate("Dm", "U", 1 / rp["T_m"])
    return ch.prune_unreachable("U").solve()


PSETS = {
    "A": {"lam": "1e-3", "c": "0.9", "s": "0.95", "T_a": "0.1", "T_m": "6"},
    "B": {"lam": "2e-4", "c": "0", "T_m": "24"},               # legacy mttrHours = 24
    "C": {"lam": "5e-3", "c": "1", "s": "1", "T_a": "0.05", "T_m": "8"},
    "D": {"lam": "1e-2", "c": "0.6", "s": "0.5", "T_a": "0.5", "T_m": "48"},
}


def pset(name):
    P = PSETS[name]
    return mpf(P["lam"]), repair(P["c"], P["T_m"], P.get("s"), P.get("T_a"))


def agree(w):
    return f" Double-precision (numpy) recomputation of these values agrees to {fl(w):.1e} relative."


G = "repair"
rows = []
for name in "ABCD":
    lam, rp = pset(name)

    def run(lam=lam, rp=rp, name=name):
        ch = unit_chain(lam, rp)
        ER = E_R(rp)
        A = ch.p("U")
        nu = ch.flux(ch.is_up, ch.is_down)
        pi_Da, pi_Dm = ch.p("Da"), ch.p("Dm")
        share = pi_Da / (pi_Da + pi_Dm)
        check(f"§10 set {name}: pi_U = 1/(1 + lambda*E[R])", A, 1 / (1 + lam * ER))
        check(f"§10 set {name}: nu (flux) = lambda*pi_U", nu, lam * A)
        check(f"§10 set {name}: pi_Da/(pi_Da+pi_Dm) = c*T_a/E[R]", share, rp["c"] * rp["T_a"] / ER)
        return {"A": A, "E_R": ER, "nu": nu, "pi_Da": pi_Da, "pi_Dm": pi_Dm, "auto_downtime_share": share,
                "human_fraction": 1 - rp["c"] * rp["s"], "_states": len(ch.labels), "_pruned": ", ".join(ch.pruned)}

    cid = f"repair.unit.set_{name.lower()}"
    expected, e, w = both(cid, run)
    zero = {"B": "pi_Da and auto_downtime_share are structurally 0 (c = 0: D_a unreachable)",
            "C": "pi_Dm is structurally 0 (c = 1, s = 1: D_m unreachable)"}.get(name)
    notes = (f"Parameter set {name}. CTMC U/D_a/D_m from the §10 table ({e['_states']} reachable states"
             + (f", pruned: {e['_pruned']}" if e["_pruned"] else "") + "); A = pi_U, E_R = c*T_a + (1 - c*s)*T_m, "
             f"nu = lambda*pi_U (equals the up->down flux), human_fraction = 1 - c*s. "
             f"Identity pi_U = 1/(1 + lambda*E_R) holds to {fl(checks[-3][1]):.1e}.")
    if name == "B":
        notes += " Legacy input (mttrHours = 24): c = 0, s and T_a unused."
    if zero:
        notes += " " + zero + "; tolerance.abs covers those entries."
    add(cid, G,
        "CTMC §10: U->Da lambda*c, U->Dm lambda*(1-c), Da->U s/T_a, Da->Dm (1-s)/T_a, Dm->U 1/T_m; "
        "A = pi_U = 1/(1+lambda*E_R); E_R = c*T_a+(1-c*s)*T_m; nu = lambda*pi_U; "
        "auto_downtime_share = pi_Da/(pi_Da+pi_Dm); human_fraction = 1-c*s",
        {"lambda": fl(lam), **repair_inputs(rp)}, expected, notes + agree(w), abs_tol=1e-12 if zero else None)
    rows.append((name, fl(lam), repair_inputs(rp), g(e["A"]), g(e["E_R"]), g(e["nu"]), g(e["pi_Da"]), g(e["pi_Dm"]),
                 g(e["auto_downtime_share"]), g(e["human_fraction"])))
section("§10 Dual-path repair unit (`repair.unit.*`)", [
    "Built literally from the §10 table (three states, five rates). For c = 0 the state D_a has no inflow and is "
    "dropped by the reachability pass (pi_Da = 0 exactly); for c = s = 1 the same happens to D_m. "
    "Outputs: A = pi_U, E_R = c*T_a + (1 - c*s)*T_m, nu = up->down flux (= lambda*pi_U), "
    "auto_downtime_share = pi_Da/(pi_Da + pi_Dm), human_fraction = 1 - c*s. "
    "Asserted for every set: pi_U = 1/(1 + lambda*E_R) (see the identity table below), "
    "nu = lambda*pi_U, and pi_Da/(pi_Da + pi_Dm) = c*T_a/E_R.", ""]
    + table(rows, ["set", "lambda", "repair", "A", "E_R", "nu", "pi_Da", "pi_Dm", "auto share", "human"]))


# ----------------------------------------------------------------------------- §11 k-of-n group
def kofn_chain(n, k, lam, rp, crews, p_sw, T_sf):
    """§11 chain. States N(a, m) (a in automatic recovery, m in manual repair, w = n-a-m working;
    up iff w >= k) and, when p_sw < 1, switch-failed states S(a, m) (down) for every (a, m) with w-1 >= k."""
    lam, p_sw = mpf(lam), mpf(p_sw)
    c, s, T_a, T_m = rp["c"], rp["s"], rp["T_a"], rp["T_m"]
    with_S = p_sw < 1
    ch = Chain(f"§11 kofn n={n} k={k} crews={'inf' if crews is None else crews} p_sw={fl(p_sw)}")
    pairs = [(a, m) for a in range(n + 1) for m in range(n + 1 - a)]
    for a, m in pairs:
        ch.state(("N", a, m), up=(n - a - m >= k), w=n - a - m)
    if with_S:
        for a, m in pairs:
            if n - a - m - 1 >= k:
                ch.state(("S", a, m), up=False, w=n - a - m)   # w inherited from (a, m); see report
    for a, m in pairs:
        w = n - a - m
        N = ("N", a, m)
        if w >= 1:
            if w - 1 >= k:                                    # survivable failure: switchover
                ch.rate(N, ("N", a + 1, m), w * lam * c * p_sw)
                ch.rate(N, ("N", a, m + 1), w * lam * (1 - c) * p_sw)
                if with_S:
                    ch.rate(N, ("S", a, m), w * lam * (1 - p_sw))
            else:                                             # group goes down regardless
                ch.rate(N, ("N", a + 1, m), w * lam * c)
                ch.rate(N, ("N", a, m + 1), w * lam * (1 - c))
        if a >= 1:
            ch.rate(N, ("N", a - 1, m), a * s / T_a)
            ch.rate(N, ("N", a - 1, m + 1), a * (1 - s) / T_a)
        if m >= 1:
            ch.rate(N, ("N", a, m - 1), (m if crews is None else min(m, crews)) / T_m)
    if with_S:
        for a, m in pairs:
            if n - a - m - 1 >= k:
                ch.rate(("S", a, m), ("N", a, m + 1), 1 / mpf(T_sf))
    return ch.prune_unreachable(("N", 0, 0)).solve()


def kofn_outputs(ch, n, k, lam, p_sw, t_sw_s):
    lam, p_sw, t_sw_s = mpf(lam), mpf(p_sw), mpf(t_sw_s)
    out = {}
    out["A"] = ch.mass(ch.is_up)
    out["nu"] = ch.flux(ch.is_up, ch.is_down)
    out["capacity_proportional"] = sum((ch.pi[i] * mpf(ch.attr[lab]["w"]) / n for i, lab in enumerate(ch.labels)), mpf(0))
    out["capacity_fractional"] = sum((ch.pi[i] * min(mpf(1), mpf(ch.attr[lab]["w"]) / k) for i, lab in enumerate(ch.labels)), mpf(0))
    sw = [i for i, lab in enumerate(ch.labels) if lab[0] == "N" and ch.up[lab] and ch.attr[lab]["w"] - 1 >= k]
    out["switchover_frequency"] = sum((ch.pi[i] * ch.attr[ch.labels[i]]["w"] * lam * p_sw for i in sw), mpf(0))
    out["U_sw"] = out["switchover_frequency"] * t_sw_s / 3600
    out["A_eff"] = out["A"] - out["U_sw"]
    out["nu_eff"] = out["nu"] + (out["switchover_frequency"] if t_sw_s > 0 else mpf(0))
    out["mttf_from_new"] = ch.mfpt(("N", 0, 0), ch.is_down)
    out["pi_switch_failed"] = ch.mass(lambda lab: lab[0] == "S")
    return out


def kofn_classic_chain(n, k, lam, mu, crews):
    """v1 one-dimensional birth-death chain: j failed units, (n-j)*lambda up, min(j, crews)*mu down."""
    lam, mu = mpf(lam), mpf(mu)
    ch = Chain(f"v1 kofn n={n} k={k} crews={'inf' if crews is None else crews}")
    for j in range(n + 1):
        ch.state(j, up=(n - j >= k), w=n - j)
    for j in range(n + 1):
        if j < n:
            ch.rate(j, j + 1, (n - j) * lam)
        if j >= 1:
            ch.rate(j, j - 1, (j if crews is None else min(j, crews)) * mu)
    return ch.solve()


def binomial_kofn_A(n, k, u):
    return sum((binomial(n, j) * u ** j * (1 - u) ** (n - j) for j in range(0, n - k + 1)), mpf(0))


G = "kofn"
KOFN_FORMULA = ("CTMC §11 on states (a,m) [+ S(a,m) if p_sw<1]; A = sum_up pi; nu = up->down flux; "
                "capacity_proportional = sum pi*w/n; capacity_fractional = sum pi*min(1,w/k); "
                "switchover_frequency = sum_{up, w-1>=k} pi*w*lambda*p_sw; U_sw = switchover_frequency*t_sw_s/3600; "
                "A_eff = A - U_sw; nu_eff = nu + [t_sw>0]*switchover_frequency; "
                "mttf_from_new = mean first passage (0,0) -> down; pi_switch_failed = sum_S pi")
kofn_rows = []
KOFN_CASES = [
    # id suffix, n, k, set, crews, p_sw, T_sf, t_sw_s, kind
    ("n2k1_seta_crews_inf_psw1", 2, 1, "A", None, "1", None, "0", "basic"),
    ("n3k2_seta_crews1_psw1", 3, 2, "A", 1, "1", None, "0", "basic"),
    ("n4k2_setd_crews2_psw1", 4, 2, "D", 2, "1", None, "0", "basic"),
    ("n2k1_setb_crews_inf_switchover", 2, 1, "B", None, "0.9", "2", "30", "switch"),
    ("n3k2_seta_crews1_switchover", 3, 2, "A", 1, "0.95", "1", "60", "switch"),
    ("n3k2_setb_crews1_reduction_to_v1", 3, 2, "B", 1, "1", None, "0", "reduction"),
]
BASIC_KEYS = ("A", "nu", "mttf_from_new", "capacity_proportional", "capacity_fractional")
SWITCH_KEYS = ("A", "U_sw", "A_eff", "nu", "switchover_frequency", "nu_eff", "mttf_from_new", "pi_switch_failed")
for suffix, n, k, sname, crews, p_sw, T_sf, t_sw_s, kind in KOFN_CASES:
    lam, rp = pset(sname)

    def run(n=n, k=k, lam=lam, rp=rp, crews=crews, p_sw=p_sw, T_sf=T_sf, t_sw_s=t_sw_s, kind=kind, suffix=suffix):
        ch = kofn_chain(n, k, lam, rp, crews, p_sw, T_sf)
        o = kofn_outputs(ch, n, k, lam, p_sw, t_sw_s)
        e = {"_states": len(ch.labels), "_pruned": len(ch.pruned)}
        if kind == "basic":
            e.update({key: o[key] for key in BASIC_KEYS})
            if crews is None:
                u = 1 - 1 / (1 + lam * E_R(rp))
                e["_binom_diff"] = check(f"§11 {suffix}: A = binomial product form (crews=inf, p_sw=1), u = 1-1/(1+lambda*E_R)",
                                         o["A"], binomial_kofn_A(n, k, u))
        elif kind == "switch":
            e.update({key: o[key] for key in SWITCH_KEYS})
            e["_cap_prop"], e["_cap_frac"] = o["capacity_proportional"], o["capacity_fractional"]
        else:
            cl = kofn_classic_chain(n, k, lam, 1 / rp["T_m"], crews)
            A_cl, nu_cl, mttf_cl = cl.mass(cl.is_up), cl.flux(cl.is_up, cl.is_down), cl.mfpt(0, cl.is_down)
            d1 = check(f"§11 reduction {suffix}: A (§11, c=0, p_sw=1) vs v1 birth-death", o["A"], A_cl)
            d2 = check(f"§11 reduction {suffix}: nu", o["nu"], nu_cl)
            d3 = check(f"§11 reduction {suffix}: mttf_from_new", o["mttf_from_new"], mttf_cl)
            check(f"§11 reduction {suffix}: nu = pi_(w=k)*k*lambda", nu_cl, cl.p(n - k) * k * lam)
            e.update({"A": o["A"], "nu": o["nu"], "mttf_from_new": o["mttf_from_new"],
                      "A_classic": A_cl, "nu_classic": nu_cl, "mttf_from_new_classic": mttf_cl,
                      "_red_abs": max(d1, d2, d3), "_red_rel": max(d1 / o["A"], d2 / o["nu"], d3 / o["mttf_from_new"]),
                      "_cap_prop": o["capacity_proportional"], "_cap_frac": o["capacity_fractional"]})
        for key in ("U_sw", "switchover_frequency", "pi_switch_failed"):
            e.setdefault("_" + key, o[key])
        return e

    cid = f"kofn.group.{suffix}"
    expected, e, w = both(cid, run)
    inputs = {"n": n, "k": k, "lambda": fl(lam), **repair_inputs(rp), "crews": crews, "p_sw": fl(mpf(p_sw)),
              "T_sf": None if T_sf is None else fl(mpf(T_sf)), "t_sw_s": fl(mpf(t_sw_s))}
    notes = f"Repair set {sname}; {e['_states']} reachable states" + (f" (pruned unreachable: {e['_pruned']})" if e["_pruned"] else "") + ". "
    if kind == "basic":
        notes += "p_sw = 1: no switch states. "
        if crews is None:
            notes += ("Unlimited crews + p_sw = 1 => units independent: A equals the binomial sum_(j<=n-k) C(n,j) u^j (1-u)^(n-j) "
                      f"with u = 1 - 1/(1+lambda*E_R) (checked, diff {fl(e['_binom_diff']):.1e}). ")
        notes += "MTTF from new differs from the v1 exponential-repair chain because the dual-path repair is a two-stage mixture."
    elif kind == "switch":
        notes += ("Switch-failed states S(a,m) for every (a,m) with w-1 >= k; their only exit is S(a,m) -> (a,m+1) at 1/T_sf "
                  "(the spec table lists no other transition out of S: repairs/failures of the other units are frozen there). "
                  "U_sw uses t_sw_s/3600; nu_eff counts successful switchovers because t_sw > 0; "
                  f"U_sw/(1-A) = {fl(e['U_sw'] / (1 - e['A'])):.3g} (spec flags A_eff when this exceeds 0.1). "
                  f"Capacity (not expected keys; S(a,m) inherits w = n-a-m): proportional {g(e['_cap_prop'])}, fractional {g(e['_cap_frac'])}.")
    else:
        notes += (f"Reduction check: with c = 0 and p_sw = 1 the §11 chain must equal the v1 chain kOfNRepairable(n, k, lambda, mu = 1/T_m, crews). "
                  f"Max |difference| over A, nu, mttf: {fl(e['_red_abs']):.1e} (relative {fl(e['_red_rel']):.1e}); "
                  "*_classic keys are the v1 chain's values.")
    add(cid, G, KOFN_FORMULA, inputs, expected, notes + agree(w))
    kofn_rows.append((suffix, e["_states"], g(e["A"]), g(e["nu"]), g(e["mttf_from_new"]),
                      g(e.get("capacity_proportional", e.get("_cap_prop"))), g(e.get("capacity_fractional", e.get("_cap_frac"))),
                      g(e.get("U_sw", e.get("_U_sw"))), g(e.get("switchover_frequency", e.get("_switchover_frequency"))),
                      g(e.get("pi_switch_failed", e.get("_pi_switch_failed")))))
section("§11 k-of-n group with dual repair and switchover (`kofn.group.*`)", [
    "States N(a, m) for all a, m >= 0 with a + m <= n (w = n - a - m working; up iff w >= k). When p_sw < 1, a switch-failed "
    "state S(a, m) (down) is created for every (a, m) with w - 1 >= k. Rates exactly as the §11 table: survivable failures "
    "(w - 1 >= k) split into w*lambda*c*p_sw -> (a+1, m), w*lambda*(1-c)*p_sw -> (a, m+1), w*lambda*(1-p_sw) -> S(a, m); "
    "non-survivable failures (w - 1 < k) w*lambda*c -> (a+1, m), w*lambda*(1-c) -> (a, m+1) (no switchover); automatic recoveries "
    "a*s/T_a -> (a-1, m) and a*(1-s)/T_a -> (a-1, m+1) (not crew-limited); manual repairs min(m, r)/T_m -> (a, m-1); "
    "S(a, m) -> (a, m+1) at 1/T_sf. Unreachable states (a > 0 when c = 0) are pruned. Outputs as in the formula field; "
    "MTTF from new = mean first passage from (0, 0) into the down set (S states included).", "",
    "Cross-checks: (i) with unlimited crews and p_sw = 1 the n units are independent, so A must equal the binomial "
    "sum_(j<=n-k) C(n,j) u^j (1-u)^(n-j) with u = 1 - 1/(1 + lambda*E_R) (case 1 and the §17 G1 chains); "
    "(ii) case 6 reproduces the v1 birth-death chain (see the reduction table). Columns U_sw / sw freq / pi_S are zero "
    "for the p_sw = 1 cases by construction; the capacity columns of the switchover cases are informational only.", ""]
    + table(kofn_rows, ["case", "states", "A", "nu", "mttf_from_new", "cap prop", "cap frac", "U_sw", "sw freq", "pi_S"]))


# ----------------------------------------------------------------------------- §12 parallel first order
G = "parallel"
children = [("1e-3", "5"), ("4e-4", "12")]


def run_parallel():
    p_sw, T_sf, t_sw_s = mpf("0.97"), mpf("3"), mpf("20")
    U_perf, pen_sf, pen_mo = mpf(1), mpf(0), mpf(0)
    rows_ = []
    for lam_s, T_s in children:
        lam, T = mpf(lam_s), mpf(T_s)
        A_i = 1 / (1 + lam * T)
        U_i, nu_i = lam * T / (1 + lam * T), lam * A_i
        U_perf *= U_i
        pen_sf += nu_i * (1 - p_sw) * T_sf
        pen_mo += nu_i * p_sw * t_sw_s / 3600
        rows_.append((lam_s, T_s, g(A_i), g(U_i), g(nu_i)))
    return {"U_perfect": U_perf, "U_approx": U_perf + pen_sf + pen_mo, "penalty_switch_failure": pen_sf,
            "penalty_micro_outage": pen_mo, "_rows": rows_}


expected, e, w = both("parallel.firstorder.two_children", run_parallel)
add("parallel.firstorder.two_children", G,
    "U_perfect = prod U_i, U_i = lambda_i*T_i/(1+lambda_i*T_i); nu_i = lambda_i/(1+lambda_i*T_i); "
    "penalty_switch_failure = sum nu_i*(1-p_sw)*T_sf; penalty_micro_outage = sum nu_i*p_sw*t_sw_s/3600; "
    "U_approx = U_perfect + penalty_switch_failure + penalty_micro_outage",
    {"children": [{"lambda": fl(mpf(l)), "T_m": fl(mpf(T))} for l, T in children], "p_sw": 0.97, "T_sf": 3.0, "t_sw_s": 20.0},
    expected,
    f"§12 first-order formula (tolerance 1e-6 as the spec marks it first-order). Added term / (1 - U_perfect) = "
    f"{fl((e['penalty_switch_failure'] + e['penalty_micro_outage']) / (1 - e['U_perfect'])):.3g}; U_perfect = {fl(e['U_perfect']):.3e} < 0.01, "
    "so no first-order flag. Pure arithmetic (no linear solve).", rel=1e-6)
section("§12 Parallel with switchover, first order (`parallel.firstorder.two_children`)", [
    "Each child is a two-state unit: A_i = 1/(1 + lambda_i T_i), U_i = 1 - A_i, nu_i = lambda_i A_i. "
    "U_perfect = U_1 U_2; the two penalties are sum nu_i (1 - p_sw) T_sf and sum nu_i p_sw t_sw/3600 (t_sw = 20 s -> 1/180 h).", ""]
    + table(e["_rows"], ["lambda", "T", "A_i", "U_i", "nu_i"]) + ["",
    f"U_perfect = {g(e['U_perfect'])}, penalty_switch_failure = {g(e['penalty_switch_failure'])}, "
    f"penalty_micro_outage = {g(e['penalty_micro_outage'])}, U_approx = {g(e['U_approx'])}."])


# ----------------------------------------------------------------------------- §13 standby with switchover
def standby_chain(n, lam, mu, f, p_sw, T_sf, crews, sw_last=False):
    """v1 standby chain with the v2 switch-failed recovery 1/T_sf.
    States j = failed units (up iff j <= n-1) and SW_j (down) for j = 0..n-2: a switch happens only while a standby
    exists (spec §13), so the failure of the last working unit (j = n-1) goes straight to j = n at rate lambda.
    sw_last=True: the former literal reading with SW_(n-1) (kept for diagnosis only)."""
    lam, mu, f, p_sw, T_sf = mpf(lam), mpf(mu), mpf(f), mpf(p_sw), mpf(T_sf)
    ch = Chain(f"§13 standby n={n} f={fl(f)} crews={'inf' if crews is None else crews} SW_last={sw_last}")
    for j in range(n + 1):
        ch.state(("J", j), up=(j <= n - 1))
    sw_js = list(range(n if sw_last else n - 1))
    for j in sw_js:
        ch.state(("SW", j), up=False)
    for j in range(n):
        ch.rate(("J", j), ("J", j + 1), (n - 1 - j) * f * lam)          # standby failures
        if j in sw_js:
            ch.rate(("J", j), ("J", j + 1), lam * p_sw)                  # active failure, switch succeeds
            ch.rate(("J", j), ("SW", j), lam * (1 - p_sw))               # active failure, switch fails
        else:
            ch.rate(("J", j), ("J", j + 1), lam)
    for j in range(1, n + 1):
        ch.rate(("J", j), ("J", j - 1), (j if crews is None else min(j, crews)) * mu)
    for j in sw_js:
        ch.rate(("SW", j), ("J", j + 1), 1 / T_sf)
    return ch.prune_unreachable(("J", 0)).solve()


def standby_outputs(ch, n, lam, p_sw, t_sw_s):
    lam, p_sw, t_sw_s = mpf(lam), mpf(p_sw), mpf(t_sw_s)
    return {"A": ch.mass(ch.is_up), "nu": ch.flux(ch.is_up, ch.is_down),
            "U_sw": sum((ch.p(("J", j)) * lam * p_sw * t_sw_s / 3600 for j in range(0, n - 1)), mpf(0)),
            "mttf_from_new": ch.mfpt(("J", 0), ch.is_down)}


G = "standby"
STANDBY_CASES = [("n2_cold_crews_inf", 2, "1e-3", "0.2", "0", "0.95", "1", "10", None),
                 ("n3_warm_crews1", 3, "2e-3", "0.5", "0.3", "0.9", "4", "0", 1)]
sb_rows = []
for suffix, n, lam, mu, f, p_sw, T_sf, t_sw_s, crews in STANDBY_CASES:

    def run(n=n, lam=lam, mu=mu, f=f, p_sw=p_sw, T_sf=T_sf, t_sw_s=t_sw_s, crews=crews):
        ch = standby_chain(n, lam, mu, f, p_sw, T_sf, crews, sw_last=False)
        o = standby_outputs(ch, n, lam, p_sw, t_sw_s)
        alt = standby_outputs(standby_chain(n, lam, mu, f, p_sw, T_sf, crews, sw_last=True), n, lam, p_sw, t_sw_s)
        o["_states"] = len(ch.labels)
        o.update({"_alt_" + key: val for key, val in alt.items()})
        return o

    cid = f"standby.v2.{suffix}"
    expected, e, w = both(cid, run)
    notes = (f"States j = 0..{n} (up iff j <= {n - 1}) and SW_j for j = 0..{n - 2} (a switch happens only while a standby exists); "
             f"from j <= n-2: (n-1-j)*f*lambda -> j+1, lambda*p_sw -> j+1, lambda*(1-p_sw) -> SW_j; from j = n-1: lambda -> n (no switch); "
             f"j -> j-1 at min(j, crews)*mu; SW_j -> j+1 at 1/T_sf. U_sw = sum_(j<=n-2) pi_j*lambda*p_sw*t_sw_s/3600. "
             f"Former literal reading with SW_(n-1) (the last active failure could 'fail to switch' and wait T_sf before its repair): "
             f"A = {g(e['_alt_A'])}, nu = {g(e['_alt_nu'])}, mttf_from_new = {g(e['_alt_mttf_from_new'])} (identical).")
    if mpf(t_sw_s) == 0:
        notes += " t_sw = 0 so U_sw is structurally 0 (tolerance.abs covers it)."
    add(cid, G,
        "CTMC §13 (v1 standby chain, SW_j cleared at 1/T_sf): A = sum_(j<=n-1) pi_j; nu = up->down flux; "
        "U_sw = sum_(j<=n-2) pi_j*lambda*p_sw*t_sw_s/3600; mttf_from_new = mean first passage j=0 -> {n, SW_*}",
        {"n": n, "lambda": fl(mpf(lam)), "mu": fl(mpf(mu)), "f": fl(mpf(f)), "p_sw": fl(mpf(p_sw)), "T_sf": fl(mpf(T_sf)),
         "t_sw_s": fl(mpf(t_sw_s)), "crews": crews},
        expected, notes + agree(w), abs_tol=1e-12 if mpf(t_sw_s) == 0 else None)
    sb_rows.append((suffix, e["_states"], g(e["A"]), g(e["nu"]), g(e["U_sw"]), g(e["mttf_from_new"]), g(e["_alt_A"]), g(e["_alt_nu"])))
section("§13 Standby with switchover (`standby.v2.*`)", [
    "States j = failed units 0..n, up iff j <= n-1; switch-down states SW_j for j = 0..n-2 only, because a switch happens only "
    "while a standby exists (spec §13): from j <= n-2 standby failures (n-1-j) f lambda -> j+1, active failure lambda p_sw -> j+1 "
    "and lambda (1-p_sw) -> SW_j; from j = n-1 the last active failure goes straight to j = n at rate lambda; repairs j -> j-1 at "
    "min(j, crews) mu; SW_j -> j+1 at 1/T_sf. The former literal reading kept SW_(n-1) (an active failure with no standby left "
    "could still 'fail to switch' and wait T_sf before the repair of the last unit started); it is tabulated for diagnosis. The "
    "MTTF is the same under both readings because both exits from j = n-1 are down.", ""]
    + table(sb_rows, ["case", "states", "A", "nu", "U_sw", "mttf_from_new", "A (literal, SW_(n-1))", "nu (literal, SW_(n-1))"]))


# ----------------------------------------------------------------------------- §14 sub-health unit
def subhealth_chain(lam, rp, lam_sh, D, m, policy, p_d=None, T_d=None):
    lam, lam_sh, D, m = mpf(lam), mpf(lam_sh), mpf(D), mpf(m)
    c, s, T_a, T_m = rp["c"], rp["s"], rp["T_a"], rp["T_m"]
    ch = Chain(f"§14 subhealth {policy} c={fl(c)} m={fl(m)}")
    for lab, up in (("U", True), ("H", False), ("Hp", False), ("I", False), ("Da", False), ("Dm", False)):
        ch.state(lab, up)          # 'up' here = strict; measures are evaluated from pi directly
    ch.rate("U", "H", lam_sh)
    ch.rate("U", "Da", lam * c)
    ch.rate("U", "Dm", lam * (1 - c))
    ch.rate("H", "U", 1 / D)
    ch.rate("H", "Da", m * lam * c)
    ch.rate("H", "Dm", m * lam * (1 - c))
    if policy == "isolate":
        p_d, T_d = mpf(p_d), mpf(T_d)
        ch.rate("H", "I", p_d / T_d)
        ch.rate("H", "Hp", (1 - p_d) / T_d)
        ch.rate("Hp", "U", 1 / D)
        ch.rate("Hp", "Da", m * lam * c)
        ch.rate("Hp", "Dm", m * lam * (1 - c))
        ch.rate("I", "U", s / T_a)
        ch.rate("I", "Dm", (1 - s) / T_a)
    ch.rate("Da", "U", s / T_a)
    ch.rate("Da", "Dm", (1 - s) / T_a)
    ch.rate("Dm", "U", 1 / T_m)
    return ch.prune_unreachable("U").solve()


def subhealth_measures(ch, phi, phi_min, policy, p_d=None, T_d=None):
    phi, phi_min = mpf(phi), mpf(phi_min)
    pi = {lab: ch.p(lab) for lab in ("U", "H", "Hp", "I", "Da", "Dm")}
    sh = pi["H"] + pi["Hp"]
    thr_up = {"U"} | ({"H", "Hp"} if phi >= phi_min else set())
    out = {"pi_U": pi["U"], "pi_H": pi["H"], "pi_Hp": pi["Hp"], "pi_I": pi["I"], "pi_Da": pi["Da"], "pi_Dm": pi["Dm"],
           "A_strict": pi["U"], "A_tolerant": pi["U"] + sh, "A_perf": pi["U"] + phi * sh,
           "A_threshold": sum((pi[x] for x in thr_up), mpf(0)),
           "nu_threshold": ch.flux(lambda lab: lab in thr_up, lambda lab: lab not in thr_up),
           "p_H_given_not_down": sh / (pi["U"] + sh),
           "mttf_from_new": ch.mfpt("U", lambda lab: lab not in thr_up),
           "threshold_up_set": sorted(thr_up)}
    if policy == "isolate":
        out["nu_iso"] = pi["H"] * mpf(p_d) / mpf(T_d)
    tol_up = {"U", "H", "Hp"}
    out["nu_tolerant"] = ch.flux(lambda lab: lab in tol_up, lambda lab: lab not in tol_up)
    out["nu_strict"] = ch.flux(lambda lab: lab == "U", lambda lab: lab != "U")
    return out


G = "subhealth"
SH_FORMULA = ("CTMC §14 (U, H, H', I, D_a, D_m; unreachable states pruned); A_strict = pi_U; A_tolerant = pi_U+pi_H+pi_H'; "
              "A_perf = pi_U+phi*(pi_H+pi_H'); A_threshold = pi_U+[phi>=phi_min]*(pi_H+pi_H'); "
              "nu_threshold = flux from the threshold up-set to its complement; nu_iso = pi_H*p_d/T_d; "
              "p_H_given_not_down = (pi_H+pi_H')/(pi_U+pi_H+pi_H'); mttf_from_new = mean first passage U -> complement of the threshold up-set")
sh_rows = []
legacy4 = repair("0", "4")
SH_CASES = [
    ("tolerate_phi0.6", "1e-3", legacy4, "5e-3", "2", "0.6", "2", "tolerate", None, None, "0.7"),
    ("tolerate_phi0.8", "1e-3", legacy4, "5e-3", "2", "0.8", "2", "tolerate", None, None, "0.7"),
    ("isolate", "1e-3", pset("A")[1], "5e-3", "2", "0.6", "2", "isolate", "0.9", "0.05", "0.7"),
]
for suffix, lam, rp, lam_sh, D, phi, m, policy, p_d, T_d, phi_min in SH_CASES:
    keys = ["pi_U", "pi_H"] + (["pi_Hp", "pi_I"] if policy == "isolate" else []) + \
           ["pi_Da", "pi_Dm", "A_strict", "A_tolerant", "A_perf", "A_threshold", "nu_threshold"] + \
           (["nu_iso"] if policy == "isolate" else []) + ["p_H_given_not_down", "mttf_from_new"]

    def run(lam=lam, rp=rp, lam_sh=lam_sh, D=D, phi=phi, m=m, policy=policy, p_d=p_d, T_d=T_d, phi_min=phi_min, keys=keys):
        ch = subhealth_chain(lam, rp, lam_sh, D, m, policy, p_d, T_d)
        o = subhealth_measures(ch, phi, phi_min, policy, p_d, T_d)
        e = {k_: o[k_] for k_ in keys}
        e.update({"_states": len(ch.labels), "_pruned": ", ".join(ch.pruned), "_up_set": "+".join(o["threshold_up_set"]).replace("Hp", "H'"),
                  "_pi_Hp": o["pi_Hp"], "_pi_I": o["pi_I"], "_nu_iso": o.get("nu_iso", mpf(0))})
        return e

    cid = f"subhealth.unit.{suffix}"
    expected, e, w = both(cid, run)
    strict = mpf(phi) < mpf(phi_min)
    notes = (f"Policy {policy}; {e['_states']} reachable states (pruned: {e['_pruned'] or 'none'}). "
             f"phi = {phi} {'<' if strict else '>='} phi_min = {phi_min}, so the threshold up-set is {{{e['_up_set']}}} and "
             f"A_threshold = {'A_strict' if strict else 'A_tolerant'}; nu_threshold is the flux out of that set "
             f"({'it includes the U->H entries, which are failures under the strict measure' if strict else 'U->D and H->D transitions only'}). ")
    if rp["c"] == 0:
        notes += "c = 0 (legacy repair T_m): pi_Da is structurally 0 (tolerance.abs covers it). "
    if policy == "isolate":
        notes += "nu_iso = pi_H*p_d/T_d; p_H_given_not_down = (pi_H+pi_H')/(pi_U+pi_H+pi_H'). "
    notes += ("mttf_from_new = mean first passage from U into the complement of the threshold up-set "
              f"({'= 1/(lambda + lambda_sh) exactly, every exit from U is a failure' if strict else 'shorter than 1/lambda when m > 1 or isolation is detected'}). ")
    add(cid, G, SH_FORMULA,
        {"lambda": fl(mpf(lam)), **repair_inputs(rp), "lambda_sh": fl(mpf(lam_sh)), "D": fl(mpf(D)), "phi": fl(mpf(phi)), "m": fl(mpf(m)),
         "policy": policy, "p_d": None if p_d is None else fl(mpf(p_d)), "T_d": None if T_d is None else fl(mpf(T_d)), "phi_min": fl(mpf(phi_min))},
        expected, notes + agree(w), abs_tol=1e-12 if rp["c"] == 0 else None)
    sh_rows.append((suffix, g(e["pi_U"]), g(e["pi_H"]), g(e["_pi_Hp"]), g(e["_pi_I"]), g(e["pi_Da"]), g(e["pi_Dm"]),
                    g(e["A_perf"]), g(e["A_threshold"]), g(e["nu_threshold"]), g(e["_nu_iso"]), g(e["p_H_given_not_down"])))

p_sh, D_conv = mpf("0.01"), mpf("2")
expected, e, w = both("subhealth.unit.p_sh_conversion", lambda: {"lambda_sh": p_sh / ((1 - p_sh) * D_conv)})
add("subhealth.unit.p_sh_conversion", G, "lambda_sh = p_sh/((1-p_sh)*D)", {"p_sh": 0.01, "D": 2.0}, expected,
    "Steady-state sub-health probability converted to an entry rate (two-state U<->H balance: p_sh/(1-p_sh) = lambda_sh*D). "
    f"m*lambda*D flag not applicable (no lambda, m given). Exact arithmetic.")


def run_sh_reduction():
    lam, lam_sh, D, phi = mpf("1e-3"), mpf("2e-3"), mpf("1.5"), mpf("0.5")
    ch = subhealth_chain(lam, legacy4, lam_sh, D, "1", "tolerate")
    o = subhealth_measures(ch, phi, "0.7", "tolerate")
    cl = Chain("v1 degradedUnit up/degraded/down")
    cl.state("up", True)
    cl.state("deg", False)
    cl.state("down", False)
    cl.rate("up", "deg", lam_sh)
    cl.rate("deg", "up", 1 / D)
    cl.rate("up", "down", lam)
    cl.rate("deg", "down", lam)
    cl.rate("down", "up", 1 / legacy4["T_m"])
    cl.solve()
    A_tol_cl = cl.p("up") + cl.p("deg")
    A_perf_cl = cl.p("up") + phi * cl.p("deg")
    d1 = check("§14 reduction (m=1, c=0, tolerate): A_tolerant vs three-state chain", o["A_tolerant"], A_tol_cl)
    d2 = check("§14 reduction (m=1, c=0, tolerate): A_perf vs three-state chain", o["A_perf"], A_perf_cl)
    return {"A_tolerant": o["A_tolerant"], "A_perf": o["A_perf"], "_A_tol_cl": A_tol_cl, "_A_perf_cl": A_perf_cl,
            "_d": max(d1, d2), "_A_strict": o["A_strict"], "_pi_U": o["pi_U"], "_pi_H": o["pi_H"], "_pi_Dm": o["pi_Dm"],
            "_A_threshold": o["A_threshold"], "_nu_threshold": o["nu_threshold"], "_pH": o["p_H_given_not_down"]}


expected, e, w = both("subhealth.unit.reduction_to_degraded_unit", run_sh_reduction)
add("subhealth.unit.reduction_to_degraded_unit", G, SH_FORMULA,
    {"lambda": 1e-3, **repair_inputs(legacy4), "lambda_sh": 2e-3, "D": 1.5, "phi": 0.5, "m": 1.0,
     "policy": "tolerate", "p_d": None, "T_d": None, "phi_min": 0.7},
    expected,
    f"Reduction check: with m = 1, c = 0, policy tolerate the §14 chain is the v1 degradedUnit (up -> degraded lambda_deg = lambda_sh, "
    f"degraded -> up 1/D, up/degraded -> down lambda, down -> up 1/T_m; A_cap = pi_up + c_deg*pi_deg). Classic chain computed separately: "
    f"A_tolerant = {g(e['_A_tol_cl'])}, A_perf = {g(e['_A_perf_cl'])}; max |difference| {fl(e['_d']):.1e}. "
    f"(phi = 0.5 < phi_min = 0.7 here, so A_threshold would equal A_strict = {g(e['_A_strict'])}; not part of the expected keys.)" + agree(w))
sh_rows.append(("reduction_to_degraded_unit", g(e["_pi_U"]), g(e["_pi_H"]), "0", "0", "0", g(e["_pi_Dm"]), g(e["A_perf"]),
                g(e["_A_threshold"]), g(e["_nu_threshold"]), "0", g(e["_pH"])))
section("§14 Sub-health unit (`subhealth.unit.*`)", [
    "Six states U, H, H', I, D_a, D_m with the rates of the §14 table; the isolate-only rows (H -> I, H -> H', H' -> *, I -> *) "
    "are added only for policy isolate, and the reachability pass removes H', I under tolerate and D_a under c = 0. Measures are read "
    "off pi: A_strict = pi_U, A_tolerant = pi_U + pi_H + pi_H', A_perf = pi_U + phi (pi_H + pi_H'), A_threshold = pi_U + [phi >= phi_min](pi_H + pi_H'). "
    "nu_threshold is the probability flux out of the threshold up-set ({U} when phi < phi_min, {U, H, H'} otherwise) into its complement, "
    "as the spec defines the failure frequency; under the strict reading this flux includes the U -> H entries. "
    "nu_iso = pi_H p_d/T_d; p_H_given_not_down = (pi_H + pi_H')/(pi_U + pi_H + pi_H'). "
    "p_sh -> lambda_sh conversion: lambda_sh = p_sh/((1 - p_sh) D).", ""]
    + table(sh_rows, ["case", "pi_U", "pi_H", "pi_H'", "pi_I", "pi_Da", "pi_Dm", "A_perf", "A_threshold", "nu_threshold", "nu_iso", "p_H|not down"]))


# ----------------------------------------------------------------------------- straggler law
G = "straggler"
st_rows = []
for N, p_H_s in ((1000, "1e-3"), (16384, "2e-4")):

    def run(N=N, p_H_s=p_H_s):
        p_H, phi = mpf(p_H_s), mpf("0.6")
        p_slowed = 1 - (1 - p_H) ** N
        return {"p_slowed": p_slowed, "phi_job": 1 - p_slowed * (1 - phi)}

    expected, e, w = both(f"straggler.n{N}", run)
    add(f"straggler.n{N}", G, "p_slowed = 1-(1-p_H)^N; phi_job = 1 - p_slowed*(1-phi)",
        {"N": N, "p_H": fl(mpf(p_H_s)), "phi": 0.6}, expected,
        "§14 synchronous-job straggler law (tolerate policy): any slow unit slows the step to phi. Exact arithmetic.")
    st_rows.append((N, fl(mpf(p_H_s)), g(e["p_slowed"]), g(e["phi_job"])))
section("§14 Straggler law (`straggler.*`)", ["P(job slowed) = 1 - (1 - p_H)^N, E[phi_job] = 1 - P(slowed)(1 - phi), phi = 0.6.", ""]
        + table(st_rows, ["N", "p_H", "p_slowed", "phi_job"]))


# ----------------------------------------------------------------------------- §15 plane loss
G = "plane"
pl_rows = []
for P, f_s in ((7, "0.3"), (2, "0.5"), (4, "0.2")):

    def run(P=P, f_s=f_s):
        factor = 1 + mpf(f_s) / (P - 1)
        return {"phi_plane": 1 / factor, "step_time_factor": factor}

    expected, e, w = both(f"plane.p{P}_f{f_s}", run)
    add(f"plane.p{P}_f{f_s}", G, "step_time_factor = 1 + f_comm/(P-1); phi_plane = 1/step_time_factor",
        {"P": P, "f_comm": fl(mpf(f_s))}, expected,
        "§15: losing one of P equal planes stretches the communication share f_comm by P/(P-1). Exact arithmetic.")
    pl_rows.append((P, f_s, g(e["step_time_factor"]), g(e["phi_plane"])))
section("§15 Fabric plane loss (`plane.*`)", ["step_time_factor = 1 + f_comm/(P - 1), phi_plane = its reciprocal (CloudMatrix384: P = 7, f = 0.3 -> 0.952).", ""]
        + table(pl_rows, ["P", "f_comm", "step_time_factor", "phi_plane"]))


# ----------------------------------------------------------------------------- §16 recovery ladder
G = "ladder"
rungs = [("auto", "0.2", 20), ("auto", "0.3", 120), ("auto", "0.8", 300), ("auto", "0.9", 900), ("manual", "1.0", 14400)]


def run_ladder():
    reach, P = [], mpf(1)
    for kind, s_i, t_i in rungs:
        reach.append(P)
        P *= (1 - mpf(s_i))
    E_T = sum((Pi * t for Pi, (_, _, t) in zip(reach, rungs)), mpf(0))
    share = [Pi * t / E_T for Pi, (_, _, t) in zip(reach, rungs)]
    p_manual = next(Pi for Pi, (kind, _, _) in zip(reach, rungs) if kind == "manual")
    auto_mean = sum((Pi * t for Pi, (kind, _, t) in zip(reach, rungs) if kind == "auto"), mpf(0))
    manual_mean = sum((Pi * t for Pi, (kind, _, t) in zip(reach, rungs) if kind == "manual"), mpf(0))
    check("§16 ladder: sum of shares = 1", sum(share, mpf(0)), 1)
    check("§16 ladder: auto_mean_s + manual_mean_s = E_T_s", auto_mean + manual_mean, E_T)
    return {"E_T_s": E_T, "reach": reach, "share": share, "p_manual": p_manual, "auto_mean_s": auto_mean, "manual_mean_s": manual_mean}


expected, e, w = both("ladder.mindcluster_like", run_ladder)
add("ladder.mindcluster_like", G,
    "P_i = prod_(j<i)(1-s_j); E_T_s = sum P_i*t_i; share_i = P_i*t_i/E_T_s; p_manual = P_(first manual rung); "
    "auto_mean_s = sum_(auto) P_i*t_i; manual_mean_s = sum_(manual) P_i*t_i",
    {"rungs": [{"kind": k_, "s": fl(mpf(s_)), "t_s": t_} for k_, s_, t_ in rungs]}, expected,
    "§16 ladder (constant rung times, no scale law). `reach` and `share` are arrays over the rungs in order. "
    "manual_mean_s is the unconditional contribution sum_(manual rungs) P_i*t_i (so auto_mean_s + manual_mean_s = E_T_s); "
    "the conditional mean time given that a person is needed would be manual_mean_s/p_manual = 14400 s here. Exact arithmetic.")
section("§16 Recovery ladder (`ladder.mindcluster_like`)", [
    "P_1 = 1, P_i = prod_(j<i)(1 - s_j); E[T] = sum P_i t_i; share_i = P_i t_i / E[T]; p_manual = P at the first manual rung; "
    "auto_mean_s / manual_mean_s = the unconditional contributions of the auto / manual rungs to E[T].", "",
    "| rung | kind | s | t (s) | P_i | P_i t_i | share |", "|---|---|---|---|---|---|---|"]
    + [f"| {i + 1} | {k_} | {s_} | {t_} | {g(Pi)} | {g(Pi * t_)} | {g(sh)} |" for i, ((k_, s_, t_), Pi, sh) in enumerate(zip(rungs, e["reach"], e["share"]))]
    + ["", f"E[T] = {g(e['E_T_s'])} s, p_manual = {g(e['p_manual'])}, auto_mean_s = {g(e['auto_mean_s'])}, manual_mean_s = {g(e['manual_mean_s'])}."])


# ----------------------------------------------------------------------------- §17 waterfall
G = "waterfall"
X = {"lam": mpf("1e-3"), "rp": repair("0.9", "6", "0.95", "0.1"), "lam_sh": mpf("2e-3"), "D": mpf("1"), "phi": mpf("0.5"), "m": mpf("1"),
     "policy": "tolerate", "phi_min": mpf("0.7")}
Bleaf = {"lam": mpf("5e-5"), "T_m": mpf("24")}
Cleaf = {"lam": mpf("2e-4"), "T_m": mpf("8")}
G1 = {"n": 3, "k": 2, "crews": None}
G2 = {"p_sw": mpf("0.95"), "T_sf": mpf("2"), "t_sw_s": mpf("0")}


def two_state(lam, T):
    A = 1 / (1 + lam * T)
    return {"A": A, "U": 1 - A, "nu": lam * A}


def U_G2(p_sw, t_sw_s):
    C = two_state(Cleaf["lam"], Cleaf["T_m"])
    return C["U"] ** 2 + 2 * C["nu"] * (1 - p_sw) * G2["T_sf"] + 2 * C["nu"] * p_sw * t_sw_s / 3600


def x_unit_step(rp, measure):
    """X's §14 chain with the given repair, reduced to an equivalent two-state unit under `measure`."""
    ch = subhealth_chain(X["lam"], rp, X["lam_sh"], X["D"], X["m"], X["policy"])
    o = subhealth_measures(ch, X["phi"], X["phi_min"], X["policy"])
    A = {"strict": o["A_strict"], "threshold": o["A_threshold"], "tolerant": o["A_tolerant"], "perf": o["A_perf"]}[measure]
    nu = {"strict": o["nu_strict"], "threshold": o["nu_threshold"], "tolerant": o["nu_tolerant"], "perf": o["nu_tolerant"]}[measure]
    return {"A": A, "nu": nu, **two_state_eq(A, nu), "measures": o}


def g1_A(lam_eq, rp):
    ch = kofn_chain(G1["n"], G1["k"], lam_eq, rp, G1["crews"], "1", None)
    A = ch.mass(ch.is_up)
    check(f"§17 G1 chain (lambda_eq={fl(lam_eq):.6g}, c={fl(rp['c'])}, T_m={fl(rp['T_m']):.6g}): product-form binomial",
          A, binomial_kofn_A(G1["n"], G1["k"], 1 - 1 / (1 + lam_eq * E_R(rp))))
    return A


def run_waterfall():
    wf = {}
    # step 0: original transform
    lam_o = X["lam"] + X["lam_sh"]
    ER_o = (X["lam"] * X["rp"]["T_m"] + X["lam_sh"] * X["D"]) / lam_o
    A_Xo = 1 / (1 + lam_o * ER_o)
    A_B = two_state(Bleaf["lam"], Bleaf["T_m"])["A"]
    A_Co = two_state(Cleaf["lam"], Cleaf["T_m"])["A"]
    A0 = A_Xo ** 3 * A_B * A_Co ** 2
    wf["step 0 (original)"] = {"lambda_o_X": lam_o, "E_R_o_X": ER_o, "A_Xo": A_Xo, "A_G1 (3 copies in series)": A_Xo ** 3, "A_B": A_B,
                               "A_C (each)": A_Co, "A_G2 (series of C1, C2)": A_Co ** 2, "A_system": A0}
    # step 1: redundancy restored, configured switchover, manual-only repair (c = 0), sub-health strict
    rp1 = repair("0", X["rp"]["T_m"])
    x1 = x_unit_step(rp1, "strict")
    A_G1_1 = g1_A(x1["lambda_eq"], repair("0", x1["MTTR_eq"]))        # equivalent two-state unit (lambda_eq, MTTR_eq)
    A_G1_1_alt = g1_A(x1["lambda_eq"], rp1)                            # alternative: configured T_m instead of MTTR_eq
    U2 = U_G2(G2["p_sw"], G2["t_sw_s"])
    A1 = A_G1_1 * A_B * (1 - U2)
    wf["step 1 (+ redundancy)"] = {"X unit chain": "§14, c = 0, T_m = 6, measure strict", "A_X (strict)": x1["A"], "nu_X": x1["nu"],
                                   "lambda_eq_X": x1["lambda_eq"], "MTTR_eq_X": x1["MTTR_eq"],
                                   "G1 chain": "§11 n=3 k=2, lambda = lambda_eq, c = 0, T_m = MTTR_eq, crews = inf, p_sw = 1",
                                   "A_G1": A_G1_1, "A_G1 [alt: c = 0, T_m = 6 configured]": A_G1_1_alt, "A_B": A_B,
                                   "U_G2 (first order, p_sw = 0.95)": U2, "A_G2": 1 - U2, "A_system": A1,
                                   "A_system [alt]": A_G1_1_alt * A_B * (1 - U2)}
    # step 2: + automatic recovery (c, s, T_a as configured); sub-health still strict
    x2 = x_unit_step(X["rp"], "strict")
    A_G1_2 = g1_A(x2["lambda_eq"], X["rp"])                            # primary: lambda_eq + configured dual repair
    A_G1_2_alt = g1_A(x2["lambda_eq"], repair("0", x2["MTTR_eq"]))    # alternative: equivalent two-state (lambda_eq, MTTR_eq)
    A2 = A_G1_2 * A_B * (1 - U2)
    A2_alt = A_G1_2_alt * A_B * (1 - U2)
    wf["step 2 (+ automatic recovery)"] = {"X unit chain": "§14, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, measure strict", "A_X (strict)": x2["A"],
                                           "nu_X": x2["nu"], "lambda_eq_X": x2["lambda_eq"], "MTTR_eq_X": x2["MTTR_eq"],
                                           "E_R configured (c*T_a+(1-c*s)*T_m)": E_R(X["rp"]),
                                           "G1 chain": "§11 n=3 k=2, lambda = lambda_eq, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, crews = inf, p_sw = 1",
                                           "A_G1": A_G1_2, "A_G1 [alt: two-state (lambda_eq, MTTR_eq), c = 0]": A_G1_2_alt, "A_B": A_B, "A_G2": 1 - U2,
                                           "A_system": A2, "A_system [alt]": A2_alt}
    # step 3: + sub-health policy (threshold measure; phi = 0.5 < phi_min = 0.7 -> strict here)
    x3 = x_unit_step(X["rp"], "threshold")
    A_G1_3 = g1_A(x3["lambda_eq"], X["rp"])
    A3 = A_G1_3 * A_B * (1 - U2)
    A3_perfect = A_G1_3 * A_B * (1 - U_G2(mpf(1), mpf(0)))
    x3p = x_unit_step(X["rp"], "perf")
    A_G1_3p = g1_A(x3p["lambda_eq"], X["rp"])
    A3_perf = A_G1_3p * A_B * (1 - U2)
    check("§17 step 3 = step 2 (phi < phi_min: threshold measure is strict)", A3, A2)
    wf["step 3 (+ sub-health policy) = compensated"] = {
        "X unit chain": "§14 as step 2, measure threshold (phi = 0.5 < phi_min = 0.7 -> same as strict)",
        "A_X (threshold)": x3["A"], "nu_X": x3["nu"], "lambda_eq_X": x3["lambda_eq"], "MTTR_eq_X": x3["MTTR_eq"],
        "A_G1": A_G1_3, "A_B": A_B, "A_G2 (p_sw = 0.95)": 1 - U2, "A_G2 (p_sw = 1, t_sw = 0)": 1 - U_G2(mpf(1), mpf(0)),
        "A_system": A3, "A_system (p_sw = 1, t_sw = 0)": A3_perfect, "switchover_penalty": A3_perfect - A3, "gain = A_step3 - A_step0": A3 - A0,
        "A_X (performability measure)": x3p["A"], "lambda_eq_X (perf)": x3p["lambda_eq"], "MTTR_eq_X (perf)": x3p["MTTR_eq"],
        "A_G1 (perf)": A_G1_3p, "A_system (performability at step 3)": A3_perf}
    return {"A_step0": A0, "A_step1": A1, "A_step2": A2, "A_step3": A3, "switchover_penalty": A3_perfect - A3, "gain": A3 - A0,
            "_wf": wf, "_A2_alt": A2_alt, "_A3_perf": A3_perf, "_MTTR_eq2": x2["MTTR_eq"]}


expected, e, w = both("waterfall.small_tree", run_waterfall)
WF_MTTR_EQ2 = e["_MTTR_eq2"]          # kept for the ambiguity list (e is reused by later cases)
add("waterfall.small_tree", G,
    "step0: A = A_Xo^3*A_Bo*A_Co^2 with lambda_o = lambda+lambda_sh, E_R_o = (lambda*T_m+lambda_sh*D)/(lambda+lambda_sh), A = 1/(1+lambda_o*E_R_o); "
    "steps 1-3: A = A_G1*A_B*(1-U_G2); X -> §14 chain -> (A, nu) under the measure in force -> lambda_eq = nu/A, MTTR_eq = (1-A)/nu; "
    "G1 = §11 chain(n=3, k=2, lambda_eq, repair, crews=inf, p_sw=1) with repair = (c=0, T_m=MTTR_eq) at step 1 and the configured "
    "(c, s, T_a, T_m) at steps 2-3; G2 = §12 first order; switchover_penalty = A_step3(p_sw=1, t_sw=0) - A_step3; gain = A_step3 - A_step0",
    {"tree": "series[G1 = kofn(n=3, k=2, X), B, G2 = parallel(C1, C2)]",
     "X": {"lambda": fl(X["lam"]), **repair_inputs(X["rp"]), "lambda_sh": fl(X["lam_sh"]), "D": fl(X["D"]), "phi": fl(X["phi"]),
           "m": fl(X["m"]), "policy": "tolerate", "phi_min": fl(X["phi_min"])},
     "B": {"lambda": fl(Bleaf["lam"]), "c": 0.0, "s": None, "T_a": None, "T_m": fl(Bleaf["T_m"])},
     "C1": {"lambda": fl(Cleaf["lam"]), "c": 0.0, "s": None, "T_a": None, "T_m": fl(Cleaf["T_m"])},
     "C2": {"lambda": fl(Cleaf["lam"]), "c": 0.0, "s": None, "T_a": None, "T_m": fl(Cleaf["T_m"])},
     "G1": {"n": 3, "k": 2, "crews": None, "p_sw": 1.0, "t_sw_s": 0.0},
     "G2": {"p_sw": fl(G2["p_sw"]), "T_sf": fl(G2["T_sf"]), "t_sw_s": fl(G2["t_sw_s"])}},
    expected,
    "Modelling conventions used (all intermediates in golden-v2-report.md): G1 crews unlimited (not configured; v1 k-of-n default); "
    "G1 has no switchover (p_sw = 1). Step 1: G1 = §11 chain with the equivalent two-state unit (lambda_eq = nu/A, c = 0, T_m = MTTR_eq) "
    "from X's §14 chain (c = 0, strict). Steps 2-3: G1 = §11 chain with lambda_eq from X's §14 chain (strict / threshold) and the "
    f"CONFIGURED dual repair (c = 0.9, s = 0.95, T_a = 0.1, T_m = 6); the alternative 'equivalent two-state (lambda_eq, MTTR_eq)' reading "
    f"gives A_step2 = A_step3 = {g(e['_A2_alt'])} (difference {fl(e['_A2_alt'] - e['A_step2']):+.3e}). phi = 0.5 < phi_min = 0.7, so the threshold "
    f"measure is strict and A_step3 = A_step2 exactly. Performability at step 3 (X measured by A_perf) = {g(e['_A3_perf'])} (not an expected key). "
    "Tolerance 1e-6 because G2 is the §12 first-order formula." + agree(w), rel=1e-6)
wf_lines = [
    "Tree: series[G1 = kofn(3, 2, X), B, G2 = parallel(C1, C2)]. X: lambda = 1e-3, repair c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, "
    "sub-health lambda_sh = 2e-3, D = 1, phi = 0.5, m = 1, tolerate, phi_min = 0.7. B: lambda = 5e-5, T_m = 24. C1 = C2: lambda = 2e-4, T_m = 8, "
    "G2 switchover p_sw = 0.95, T_sf = 2, t_sw = 0. G1: crews unlimited, no switchover (assumptions, see ambiguities).", "",
    "Step 0 (original): every leaf becomes a two-state unit with lambda_o = lambda + lambda_sh and E[R_o] = (lambda T_m + lambda_sh D)/(lambda + lambda_sh); "
    "kofn -> 3 copies of X_o in series, parallel -> C1_o and C2_o in series.",
    "Step 1 (+ redundancy): structure restored; X's §14 chain with c = 0 (manual only), measured strict -> (A, nu) -> lambda_eq = nu/A, "
    "MTTR_eq = (1 - A)/nu; G1 = §11 chain(3, 2, lambda_eq, c = 0, T_m = MTTR_eq, crews = inf, p_sw = 1) (= v1 birth-death, = binomial); "
    "G2 = §12 first order with the configured switchover; B unchanged.",
    "Step 2 (+ automatic recovery): X's §14 chain with the configured dual repair, measured strict -> lambda_eq (= lambda + lambda_sh exactly, "
    "since under the strict measure every exit from U is a failure); G1 = §11 chain(3, 2, lambda_eq, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, crews = inf, p_sw = 1) "
    "as instructed ('lambda_eq from its own §14 chain and the configured dual repair parameters'). The alternative reading that keeps the "
    "equivalent two-state unit (c = 0, T_m = MTTR_eq) is tabulated as [alt].",
    "Step 3 (+ sub-health policy): X measured by the threshold rule; phi = 0.5 < phi_min = 0.7 so the up-set is {U} and step 3 = step 2. "
    "Switchover penalty = A(step 3, p_sw = 1, t_sw = 0) - A(step 3); gain = A_step3 - A_step0. Performability at step 3 is also listed.", ""]
for step, d in e["_wf"].items():
    wf_lines += [f"**{step}**", "", "| quantity | value |", "|---|---|"]
    for key, val in d.items():
        wf_lines.append(f"| {key} | {val if isinstance(val, str) else repr(fl(val))} |")
    wf_lines.append("")
section("§17 Waterfall (`waterfall.small_tree`) — every intermediate", wf_lines)


# ----------------------------------------------------------------------------- CloudMatrix384 counts
G = "cm384"
cm = {"nodes": 48, "npus_per_node": 8, "l1_per_node": 7, "sub_planes": 7, "l2_per_subplane": 16, "l2_ports": 48,
      "links_per_l1": 16, "transceivers_per_link": 2}


def run_cm():
    npus = cm["nodes"] * cm["npus_per_node"]
    l1 = cm["nodes"] * cm["l1_per_node"]
    l2 = cm["sub_planes"] * cm["l2_per_subplane"]
    links = l1 * cm["links_per_l1"]
    assert links % cm["sub_planes"] == 0
    links_sp = links // cm["sub_planes"]
    ports_sp = cm["l2_per_subplane"] * cm["l2_ports"]
    check("CM384: links_per_subplane = l2_ports_per_subplane", links_sp, ports_sp)
    return {"npus": npus, "l1_chips": l1, "l2_chips": l2, "l1_l2_links": links, "links_per_subplane": links_sp,
            "l2_ports_per_subplane": ports_sp, "transceiver_ends": links * cm["transceivers_per_link"]}


expected, e, w = both("cm384.counts", run_cm)
add("cm384.counts", G,
    "npus = nodes*npus_per_node; l1_chips = nodes*l1_per_node; l2_chips = sub_planes*l2_per_subplane; l1_l2_links = l1_chips*links_per_l1; "
    "links_per_subplane = l1_l2_links/sub_planes; l2_ports_per_subplane = l2_per_subplane*l2_ports; transceiver_ends = l1_l2_links*transceivers_per_link",
    cm, expected,
    "Integer counts; links_per_subplane equals l2_ports_per_subplane (every L1 chip of a sub-plane has one link to each of its 16 L2 chips, "
    "and each L2 chip has one port per node), which is the consistency check of the topology.")
section("CloudMatrix384 counts (`cm384.counts`)", [
    f"npus = {e['npus']}, l1_chips = {e['l1_chips']}, l2_chips = {e['l2_chips']}, l1_l2_links = {e['l1_l2_links']}, "
    f"links_per_subplane = {e['links_per_subplane']} = l2_ports_per_subplane = {e['l2_ports_per_subplane']}, transceiver_ends = {e['transceiver_ends']}."])


# ======================================================================= write outputs
today = datetime.date.today().isoformat()
out = {"version": "2.0", "generated": today, "tool": "python/mpmath (mp.dps=40); numpy LU + scipy null-space cross-check",
       "spec": SPEC,
       "conventions": {"units": "hours and per-hour unless the key ends in _s (seconds)",
                       "crews": "null = unlimited",
                       "legacy_repair": "c = 0 with s = T_a = null (manual-only, mttrHours = T_m)",
                       "tolerance": "rel 1e-9 for exact quantities, 1e-6 for first-order formulas (§12, §17); abs is present only for structurally zero entries"},
       "cases": cases}
with open(os.path.join(HERE, "golden_v2.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)

groups = {}
for c in cases:
    groups[c["group"]] = groups.get(c["group"], 0) + 1
np_worst = max(NPAGREE, key=lambda r: r[1])

lines = ["# HAC-D v2 golden vectors — independent verification report", "",
         f"Generated {today} by `compute_golden_v2.py` from `{SPEC}` only (no engine source read). "
         f"{len(cases)} cases in `golden_v2.json`: " + ", ".join(f"{k_} = {v}" for k_, v in groups.items()) + ".", "",
         "## Method", "",
         "Every CTMC is assembled from the state/transition table of its section (positive rates only; states that cannot be reached "
         "from the initial state are removed), the generator Q is formed, and pi Q = 0 with sum pi = 1 is solved with mpmath at 40 "
         "significant digits (one balance equation replaced by the normalisation; the residual max_j |(pi Q)_j| is asserted below 1e-34). "
         "Failure frequency nu = sum_(i up, j down) pi_i Q_ij. Mean first passage from the initial state into the down set solves "
         "(-Q_TT) t = 1 over the transient (up) states. The expected values are the mpmath results rounded to double.", "",
         "### numpy / scipy vs mpmath agreement", "",
         "Every case is computed twice: once from the mpmath solutions and once from numpy's double-precision LU solutions of the very "
         "same linear systems (stationary and first-passage); the table lists the largest relative difference over the case's expected "
         "values. Separately, each stationary vector is also recomputed as the null space of Q^T with scipy (SVD).", "",
         f"- Over all {len(cases)} cases the double-precision recomputation agrees with the mpmath expected values to "
         f"{fl(np_worst[1]):.1e} relative at worst (`{np_worst[0]}`, key `{np_worst[2]}`), about four orders of magnitude below the 1e-9 tolerance.",
         f"- Component level ({XC['chains']} stationary solves): numpy LU max absolute difference {fl(XC['pi_abs']):.1e}; the max relative "
         f"difference {fl(XC['pi_rel']):.1e} occurs on a state with pi = 2e-11 ({XC['worst_pi']}), where double precision has only ~8 "
         "significant digits — no expected value is that small. scipy null space: max relative component difference "
         f"{fl(XC['ns_rel']):.1e} (SVD, same tiny-component effect).",
         f"- First passage ({XC['mfpt_solves']} solves): numpy max relative difference {fl(XC['mfpt_rel']):.1e} (worst: {XC['worst_mfpt']}).", "",
         "| case | max rel diff (numpy vs mpmath) | worst key |", "|---|---|---|"]
for cid, wv, wk in NPAGREE:
    lines.append(f"| `{cid}` | {fl(wv):.1e} | {wk or '—'} |")
lines.append("")
for title, body in report_sections:
    lines += [f"## {title}", ""] + body + [""]
lines += ["## Identity and reduction checks", "",
          "| check | abs diff | rel diff |", "|---|---|---|"]
for name, d, r, note in checks:
    lines.append(f"| {name} | {fl(d):.1e} | {fl(r):.1e} |")
worst = max(r for _, _, r, _ in checks)
lines += ["", f"Largest relative difference over all checks: {fl(worst):.1e} (40-digit arithmetic; anything below 1e-30 is roundoff). "
          "The two reduction cases (`kofn.group.n3k2_setb_crews1_reduction_to_v1`, `subhealth.unit.reduction_to_degraded_unit`) carry the "
          "classic chain's values in their notes (and, for k-of-n, as `*_classic` expected keys).", ""]
lines += ["## Ambiguities in the specification and the reading used", "",
          "1. **§11 capacity of switch-failed states.** The spec defines w = n - a - m for (a, m) and says capacity `proportional` = w/n, "
          "`fractional` = min(1, w/k), but does not say what w is in S(a, m), where one more unit has failed and nothing has been repaired. "
          "I let S(a, m) inherit w = n - a - m (literal reading); the physically stricter choices would be w - 1 or 0 (group down). "
          "No expected value depends on this: the capacity keys are only requested for the p_sw = 1 cases, which have no S states "
          "(the switchover cases list their capacity under this reading in the notes, for information).",
          "2. **§11 behaviour inside S(a, m).** The table lists a single exit S(a, m) -> (a, m+1) at 1/T_sf. I followed it literally: while the "
          "switch failure is being recovered, the ongoing automatic/manual repairs of the other units and further failures are frozen. "
          "The failed unit then enters manual repair regardless of c.",
          "3. **§13 SW_(n-1).** The chain description given with the task defined SW_j for j = 0..n-1, i.e. an active failure with no standby "
          "left (j = n-1) could still 'fail to switch' and wait T_sf before the last repair started, while the spec's own U_sw sums only "
          "j <= n-2 ('a switch happens only while a standby exists'). Since the model review of 2026-10-11 the primary values use SW_j for "
          "j = 0..n-2 only (the engine was aligned the same day); the former literal values are kept in the notes of each standby case and "
          "in the §13 table (MTTF is identical; A and nu differ).",
          "4. **§14 failure frequency under the strict/threshold measure.** 'Flux from the up set (threshold rule) into the down set' makes "
          "every U -> H entry a failure when phi < phi_min. Used as written; nu_threshold for phi >= phi_min counts only transitions into "
          "I/D_a/D_m.",
          "5. **§16 manual_mean_s.** Taken as the unconditional contribution sum_(manual rungs) P_i t_i (161.28 s), so that "
          "auto_mean_s + manual_mean_s = E[T]; the conditional mean given a person is needed would be 14400 s.",
          "6. **§17 G1 at steps 2-3.** The task says to use the unit's lambda_eq (= nu/A from X's §14 chain) together with the *configured* "
          "dual repair (c, s, T_a, T_m) in the §11 chain, while step 1 uses the equivalent two-state unit (c = 0, T_m = MTTR_eq). "
          "Under the strict measure lambda_eq = lambda + lambda_sh exactly, but the configured E_R = 0.96 h differs from the unit's "
          f"MTTR_eq = {g(WF_MTTR_EQ2, 6)} h (sub-health episodes last D = 1 h, not a dual repair), so the two readings give different "
          "A_step2/A_step3 (about 1.4e-6 relative, i.e. at the tolerance); both are in the waterfall table and the case notes. "
          "Primary = configured repair (as instructed).",
          "7. **§17 G1 crews.** Not configured for kofn(3, 2, X); I used unlimited repair (the v1 k-of-n default, §2 table). G1 has no "
          "switchover (p_sw = 1, t_sw = 0); only G2 does.",
          "8. **§17 MTBF/MTTR ratios between steps 0 and 3** (mentioned in §17) are not requested and not computed; only A per step, the "
          "switchover penalty and the availability gain are.",
          "9. **Legacy repair in the §11/§14 chains.** With c = 0 the states with a > 0 (resp. D_a) are unreachable; s and T_a are then "
          "irrelevant and are written as null in the JSON inputs. Structurally zero expected values (pi_Da for c = 0, pi_Dm for c = s = 1, "
          "U_sw for t_sw = 0) carry an additional `tolerance.abs = 1e-12` because a relative test cannot be applied to 0.", "",
          "## JSON conventions", "",
          "`inputs` are hours / per hour except keys ending in `_s` (seconds); `crews: null` = unlimited; a legacy manual-only repair has "
          "`c = 0` and `s = T_a = null`. `tolerance.rel` = 1e-9 for CTMC and closed-form quantities, 1e-6 for the first-order §12 formula and the "
          "§17 waterfall that contains it; `tolerance.abs` appears only on cases with structurally zero entries. `expected.reach` and "
          "`expected.share` of the ladder case are arrays in rung order. `*_classic` keys of the k-of-n reduction case are the v1 one-dimensional "
          "chain's values (they must equal the §11 values).", ""]
with open(os.path.join(HERE, "golden-v2-report.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print(f"wrote {len(cases)} cases -> golden_v2.json, golden-v2-report.md")
print(f"numpy vs mpmath on expected values: worst {fl(np_worst[1]):.2e} ({np_worst[0]}, {np_worst[2]})")
print(f"component level: pi rel {fl(XC['pi_rel']):.2e} (abs {fl(XC['pi_abs']):.1e}), null-space rel {fl(XC['ns_rel']):.2e}, mfpt rel {fl(XC['mfpt_rel']):.2e}")
print(f"largest identity/reduction mismatch: {fl(worst):.1e}")
