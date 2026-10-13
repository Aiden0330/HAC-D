"""
Independent golden vectors for the v3.5 statistics (docs/MODEL_REFERENCE.md §21, §23): Student-t quantiles, chi-square
quantiles, regularized incomplete gamma / beta, Wilson score intervals and Garwood (exact Poisson) rate intervals,
computed with SciPy without reading the TypeScript engine.
Run: python3 compute_golden_stats.py  → golden_stats.json
"""
import json, math
from scipy import stats, special

cases = []
for df in [1, 2, 3, 5, 10, 30, 100, 199, 1999, 100000]:
    for p in [0.9, 0.975, 0.995]:
        cases.append({"id": f"tq.df{df}.p{p}", "group": "tq", "inputs": {"p": p, "df": df}, "expected": {"q": float(stats.t.ppf(p, df))}, "tolerance": {"rel": 1e-9}})
for df in [1, 2, 4, 10, 22, 42, 202]:
    for p in [0.025, 0.05, 0.5, 0.95, 0.975]:
        cases.append({"id": f"chi2q.df{df}.p{p}", "group": "chi2q", "inputs": {"p": p, "df": df}, "expected": {"q": float(stats.chi2.ppf(p, df))}, "tolerance": {"rel": 1e-9}})
for a, x in [(0.5, 0.3), (1, 1), (2.5, 1.0), (5, 8), (10, 3), (50, 45), (100, 130), (3, 30)]:
    cases.append({"id": f"gammainc.a{a}.x{x}", "group": "gammainc", "inputs": {"a": a, "x": x}, "expected": {"p": float(special.gammainc(a, x)), "q": float(special.gammaincc(a, x))}, "tolerance": {"rel": 1e-10, "abs": 1e-300}})
for x, a, b in [(0.2, 0.5, 0.5), (0.5, 2, 3), (0.9, 5, 0.5), (0.01, 100, 0.5), (0.999, 0.5, 10), (0.3, 1000, 0.5)]:
    cases.append({"id": f"betainc.x{x}.a{a}.b{b}", "group": "betainc", "inputs": {"x": x, "a": a, "b": b}, "expected": {"i": float(special.betainc(a, b, x))}, "tolerance": {"rel": 1e-10, "abs": 1e-300}})

def wilson(k, n, c):
    z = stats.norm.ppf(1 - (1 - c) / 2)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - half), min(1.0, centre + half)
for k, n, c in [(0, 10, 0.95), (3, 10, 0.95), (173, 200, 0.95), (200, 200, 0.95), (5, 5, 0.99), (1, 1000, 0.9), (90, 100, 0.95)]:
    lo, hi = wilson(k, n, c)
    cases.append({"id": f"wilson.k{k}.n{n}.c{c}", "group": "wilson", "inputs": {"k": k, "n": n, "confidence": c}, "expected": {"low": lo, "high": hi}, "tolerance": {"rel": 1e-10, "abs": 1e-15}})

def garwood(k, E, c):
    a = 1 - c
    if k == 0:
        return 0.0, float(stats.chi2.ppf(c, 2) / (2 * E))
    return float(stats.chi2.ppf(a / 2, 2 * k) / (2 * E)), float(stats.chi2.ppf(1 - a / 2, 2 * k + 2) / (2 * E))
for k, E, c in [(0, 1e6, 0.95), (2, 1e6, 0.95), (10, 5e5, 0.95), (1, 1000, 0.9), (100, 1e7, 0.99), (37, 2.6e6, 0.95)]:
    lo, hi = garwood(k, E, c)
    cases.append({"id": f"garwood.k{k}.E{E}.c{c}", "group": "garwood", "inputs": {"events": k, "exposureHours": E, "confidence": c}, "expected": {"fit": k / E * 1e9, "lowerFit": lo * 1e9, "upperFit": hi * 1e9}, "tolerance": {"rel": 1e-9, "abs": 1e-12}})

out = {"version": "3.5", "generated": "2026-10-13", "tool": "python/scipy stats.t.ppf, stats.chi2.ppf, special.gammainc/gammaincc/betainc; Wilson and Garwood formulas", "spec": "docs/MODEL_REFERENCE.md §21 (Student-t, Wilson), §23 (Garwood)", "cases": cases}
with open(__file__.replace("compute_golden_stats.py", "golden_stats.json"), "w") as f:
    json.dump(out, f, indent=1)
print(len(cases), "cases")
