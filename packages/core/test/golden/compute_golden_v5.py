"""
Independent golden vectors for the v5 budget numerics (docs/markdown/PLAN_V5_REPORT_PIPELINE.md §3 "Goldens", task T9),
computed in pure Python from the written specification — the Methodology formulas (1)–(5) in packages/reports/src/content.mjs
(FORMULAS), docs/markdown/MODEL_REFERENCE.md §18 (MTTR mixture), §19 / §19.1 / §19.2 (mechanism chain and rung order) and
§24.1 / §24.2 (custom rungs, recovery stages) — without reading the TypeScript modules under test
(budget/kpiForm, mttr/decompose, layers, strategy/requirement, strategy/window, study/prune).

Inputs (inputs_v5/*.table.json, written by dump_inputs_v5.mjs; the engine is used there only to build the scenarios and to
read back the per-class table): class id, fault unit, unit count, hard rate λ_i (1/h), mechanism applicability a_i, the chain
parameters, the recovery block (detection coverage / auto / timeout, automatic attempt seconds / success / stages, manual
seconds), the sdc block, the per-unit sub-health and silent-corruption rates, the isolation / detected-silent / false-alarm
rates (sub-health occupancy and SDC models are covered by the v2 / v3 goldens and are taken as inputs here).
Engine OUTPUTS present in the tables (meanPauseS, aOp, aRun, delivered) enter an expected value only where the case is an
identity check, declared below:
  * G1 kpiForm — the MTBF / MTTR form of A_op, formula (1):
        λ_hw = Σ λ_i,  ΣC = Σ λ_i t̄_i,  MTTR_hw = ΣC / λ_hw,  MTBF_hw = 1 / λ_hw,
        other classes: isolation λ_iso × G;  detected silent corruption λ_sdc × (t_d + t_rec + t_step | t_d + G);
                       false alarms λ_fa × t_mig;  F = Σ_k λ_k t_k,
        A_run = 1 / (1 + (ΣC + F) / 3600)                      ← identity: must equal the engine's running fraction (≤ 1e-9)
        φ = 1 − A_op / A_run                                   ← identity on the engine's A_op (declared)
        t_d = p_d·t_auto + (1 − p_d)·t_timeout (§18),  G = T_auto + (1 − p_s)·T_manual (§18)   ← recomputed from the recovery block
    t̄_i is the Python chain mean of G3 (independent); the engine's meanPauseS is only compared with it.
  * G2 byLayer — formula (3): C_ℓ = Σ_{i∈ℓ} λ_i t̄_i, λ_ℓ = Σ_{i∈ℓ} λ_i with the unit → layer map of the Methodology §3
    (job → cluster; roce-switch, roce-link → scaleout; ub-switch, ub-link → superpod; cabinet; node, cpu → node; npu);
    the isolation and detected-silent pauses are split over the layers in proportion to the layer's sub-health rate
    Σ slow_u·n_u and detected silent rate Σ sdc_u·n_u·q_u (v5.5; q_u the class coverage of §24.3: an absolute class coverage or
    the job's, compounded with the conditional detectors' gains; equal to the raw-rate split while every q_u is the job's);
    U_ℓ = 100·C_ℓ / (3600·D), D = 1 + (Σ_ℓ C_ℓ + F) / 3600 (percentage points of A_op; F includes the predictor's false alarms).
    Identities: Σ_ℓ λ_ℓ = λ_hw, Σ_ℓ C_ℓ = ΣC.
  * G3 chainSplit / mttrDecomposition — §19, §19.1, §19.2, §24.1, §24.2: recursive enumeration of the rung tree
    predict → netfail → transparent custom rungs → ordered detection-delayed rungs (default replay → hotswap → elastic →
    process) → delayed custom rungs → global, recording per terminal its probability and the pause by contributor:
    `detect` (t_d, charged by replay / hotswap / process / detection-delayed custom rungs / global), the rung's own success
    time under its id (`custom:<id>` for custom rungs; elastic charges t_sync), `failed:<rung>` for the failure time of every
    rung tried and failed before the terminal, `globalAuto` = p_global·T_auto and `globalManual` = p_global·(G − T_auto).
    Σ contributions = the class mean pause (identity with the engine's meanPauseS, ≤ 1e-9 relative). Job level: rate-weighted
    means; stages = each class's globalAuto split by its own automatic stages (thirds when absent, else the given stages rescaled
    to T_auto; a class's `recoveryStages` override the job's stage by stage), manual = globalManual; MTTR = Σ contributions.
    v5.5 (§24.2): a class with its own stages runs its chain on g_i = G − (A − A_i) and A_i = Σ stages_i (no recovery scale law
    in the tables), so the identity holds with R-RUNTIME-SNAPSHOT applied (a3server-10k.snapshot).
  * G4 requirementFromKpi — formula (2) on the derated design: B = 3600·((1 − φ)/A* − 1) − F, total budget 3600·(1/A* − 1),
    MTBF needed at today's MTTR = MTTR_hw / B, MTTR needed at today's MTBF = B·MTBF_hw, ratio today MTTR_hw / MTBF_hw and the
    two factors (required / today).
  * G5 the closed-form uniform hardware factor where the derated mean binds (formula (4), ARINC): with every hard class
    scaled by k and nothing else, A_op(k) = (1 − φ) / (1 + (k·ΣC₁ + F)/3600) ⇒ k* = (3600·((1 − φ)/A* − 1) − F) / ΣC₁ on the
    derated recommended design at k = 1. Compared with results.json's recommended.k (bisection).
  * G6 pruneByShapley — Methodology §4 rule on the stored 23-player studies (docs/backup/arch-mechanism-shapley/*.json,
    perSize['500000'].gains[].{aOp,delivered}.shapley): reference set → 'reference'; absent from every study → 'capability';
    dominated on the same stage → 'pruned'; min over the four architectures of the A_op Shapley ≥ 0.0015 → 'candidate';
    else min delivered Shapley ≥ 0.0015 → 'goodput'; else 'pruned'. Plus a synthetic table that exercises every branch.
  v5.6 — the effective-goodput basis (docs/markdown/MODEL_REFERENCE.md §30; the report's metric since 2026-10-28):
  * G1e the loss form of the effective goodput, formula (1′):
        W = τ/2 + lag (or the measured / one-step value),  r_i = t̄_i + P_rb,i·W,  Q_hw = Σ λ_i P_rb,i W,  Σλr = ΣC + Q_hw,
        R_eff = Σλr / λ_hw,  Q_other = λ_sdc,det·W without step recovery (0 with it),  save = δ/τ,
        ℓ_local = Σ λ_i ℓ_i / 3600 (from the per-class local loss),  Φ = (1 − P_blocked)·φ_perf·(1 − ℓ_local)·(1 − o),
        G_eff = (1 − p_sdc)·Φ·(1 − δ/τ − (Σλr + F + Q_other)/3600)   ← identity: must equal the engine's effectiveGoodput (≤ 1e-9)
                                                                      while the headline model is the first-order one
    P_rb,i, ℓ_i, P_blocked, φ_perf, o and p_sdc are engine outputs of the chain, the pool and the silent-corruption model
    (covered by the v2 / v3 goldens) and enter as declared inputs; t̄_i is the Python chain mean of G3.
  * G2e lossBreakdown — formula (3′): Q_ℓ = Σ_{i∈ℓ} λ_i P_rb,i W, U_ℓ = (downtime − p_sdc)·C_ℓ/(ΣC + F) + rollback·Q_ℓ/(ΣQ + Q_other)
    with the engine's ledger lines (declared inputs; under the first-order model the two lines are (1 − p_sdc)(ΣC + F)/3600 and
    (1 − p_sdc)(ΣQ + Q_other)/3600, checked), the other lines save / otherClasses / factors and the closure Σ U_ℓ + lines = 1 − G_eff.
  * G4e requirementFromKpi on the effective basis — formula (2′): Φ′ = G_eff / (1 − S), S = δ/τ + (Σλr + F + Q_other)/3600,
    B = 3600·(1 − δ/τ − G*/Φ′) − F − Q_other, total budget 3600·(1 − G*), the terms { 3600 δ/τ, F + Q_other, total − save − other − B },
    MTBF needed at today's R_eff = R_eff/B, R_eff allowed at today's MTBF = B·MTBF_hw (null when B ≤ 0), the factors.
  * G5e the all-moves identity: when no move set is feasible (results.json recommended.feasible false, k = 1) the derated
    all-moves design's loss form reproduces the engine's effective goodput (G1e on that table) and formula (2′) says B ≤ 0;
    the first-order k* of G5 is computed only where the mean binds (recommended.binding 'mean').
  * G6e pruneByShapley on the effective goodput: the candidate test reads the effective-goodput Shapley (min over the
    architectures ≥ 0.0015), the goodput test the delivered Shapley, as the set record's prune.metric = 'effective' says.
  v5.7 — the sixth model review (MODEL_REFERENCE.md §31):
  * G1e: the acceptance value G_eff is the exact renewal model's, (1 − p_sdc)·Φ·renewal (declared identity on the engine's
    effectiveGoodputExact and renewal goodput); the loss form above is `effectiveFirstOrder` and closes on the engine's first-order
    goodput (1 − p_sdc)·Φ·g_fo in every regime (F4).
  * G2e: the ledger is the exact one (ledgerExact): its seven loss lines add up to 1 − G_eff (identity) and the layers take their
    shares of its downtime and rollback lines in proportion to C_ℓ and Q_ℓ; the closure is checked in every regime.
  * G4e: Φ′ = (1 − p_sdc)·Φ, the product of the throughput factors, never G_eff/(1 − S) (F1); terms.other = F + Q_other +
    3600·G*·p_sdc/((1 − p_sdc)Φ) (the episode pauses with the other classes, as in 3′: M1), terms.factors = 3600·G*(1/Φ − 1).
  * G6 / G6e: a test passes only with a gain on top of the reference set where the studies carry it (`onReference`, F3); every
    verdict states whether its deciding Shapley comparison clears the sampled half-width at the deciding architecture (F6); a
    synthetic table exercises both.
Run: /usr/bin/python3 compute_golden_v5.py  → golden_v5.json   (Python 3.9, standard library only)
"""
import json
import math
import os
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, 'inputs_v5')
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
RESULTS = os.path.join(ROOT, 'docs', 'backup', 'ascend-allocation', 'results.json')
SHAPLEY_DIR = os.path.join(ROOT, 'docs', 'backup', 'arch-mechanism-shapley')

TARGET = 0.985
THRESHOLD = 0.0015
REFERENCE = ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST']
DOMINATED = {'R-WARM-PROCESS': 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH': 'R-RUNTIME-SNAPSHOT'}
ARCHS = ['native950', 'ubl128', 'cm384', 'a3server']

LAYERS = ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu']
LAYER_OF_UNIT = {'job': 'cluster', 'roce-switch': 'scaleout', 'roce-link': 'scaleout', 'ub-switch': 'superpod', 'ub-link': 'superpod',
                 'cabinet': 'cabinet', 'node': 'node', 'cpu': 'node', 'npu': 'npu'}

findings = []  # anything that did not match inside the Python itself (reported, never patched)


def load(name):
    with open(os.path.join(INP, name), encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- §18 recovery block
def detect_seconds(rec):
    d = rec['detection']
    return d['coverage'] * d['autoSeconds'] + (1 - d['coverage']) * d['timeoutSeconds']


def global_seconds(rec):
    a = rec['automatic']
    return a['seconds'] + (1 - a['successProbability']) * rec['manual']['seconds']


def automatic_stages(rec):
    """§24.2: explicit stages rescaled to automatic.seconds when their sum differs, else thirds of the attempt."""
    a = rec['automatic']
    A = a['seconds']
    st = a.get('stages')
    if not st:
        return {'startup': A / 3, 'read': A / 3, 'communication': A / 3}
    tot = st['startup'] + st['read'] + st['communication']
    return {k: st[k] * A / tot for k in ('startup', 'read', 'communication')}


# ---------------------------------------------------------------- §19 / §24.1 chain with contributions
DELAYED_RUNGS = ['replay', 'hotswap', 'elastic', 'process']
TERMINALS = ['predict', 'netfail', 'replay', 'hotswap', 'elastic', 'process', 'global']


def rung_order(order):
    out = []
    for r in (order or []):
        if r in DELAYED_RUNGS and r not in out:
            out.append(r)
    for r in DELAYED_RUNGS:
        if r not in out:
            out.append(r)
    return out


CUSTOM_RUNG_ORDER = ['R-LINK-LOCAL', 'R-FABRIC-DEGRADE', 'H-CONTROL-CONTINUITY']


def custom_rung_rank(ids):
    """v5.5: custom rungs are tried in a canonical order — the library's audited rungs first, then any other id as inserted"""
    return lambda cid: CUSTOM_RUNG_ORDER.index(cid) if cid in CUSTOM_RUNG_ORDER else len(CUSTOM_RUNG_ORDER) + list(ids).index(cid)


def chain_split(detect_s, global_s, auto_s, params, applicable, order=None):
    """Enumerate the rung tree (the recursion of compute_golden_v3.chain) and book every terminal's pause by contributor."""
    custom = params.get('custom') or {}
    capp = applicable.get('custom') or {}
    rank = custom_rung_rank(custom.keys())
    customs = lambda pos: [(('custom', cid), capp.get(cid, 0.0), custom[cid]) for cid in sorted(custom.keys(), key=rank) if custom[cid].get('position', 'transparent') == pos and capp.get(cid, 0.0) > 0]
    front = [(kind, applicable.get(kind, 0.0), params[kind]) for kind in ['predict', 'netfail'] if params.get(kind) and applicable.get(kind, 0.0) > 0]
    delayed = [(kind, applicable.get(kind, 0.0), params[kind]) for kind in rung_order(order) if params.get(kind) and applicable.get(kind, 0.0) > 0]
    rungs = front + customs('transparent') + delayed + customs('delayed')
    contrib = OrderedDict((k, 0.0) for k in ['detect', 'predict', 'netfail', 'replay', 'hotswap', 'elastic', 'process'])
    for cid in custom:
        contrib['custom:' + cid] = 0.0
    for k in ['netfail', 'replay', 'hotswap', 'elastic', 'process']:
        contrib['failed:' + k] = 0.0
    for cid in custom:
        contrib['failed:custom:' + cid] = 0.0
    contrib['globalAuto'] = 0.0
    contrib['globalManual'] = 0.0
    probs = OrderedDict((k, 0.0) for k in TERMINALS)
    for cid in custom:
        probs['custom:' + cid] = 0.0

    def book_failed(p, failed):
        for key, tf in failed:
            contrib['failed:' + key] += p * tf

    def terminal(term, p, own_key, own_time, with_detect, failed):
        probs[term] += p
        if with_detect:
            contrib['detect'] += p * detect_s
        contrib[own_key] += p * own_time
        book_failed(p, failed)

    def rec(i, p, failed):
        if p <= 0:
            return
        if i == len(rungs):
            probs['global'] += p
            contrib['detect'] += p * detect_s
            contrib['globalAuto'] += p * auto_s
            contrib['globalManual'] += p * (global_s - auto_s)
            book_failed(p, failed)
            return
        kind, frac, prm = rungs[i]
        rec(i + 1, p * (1 - frac), failed)  # not applicable to this share of the class's events
        tried = p * frac
        if isinstance(kind, tuple):
            key = 'custom:' + kind[1]
            s_ = prm['success']
            terminal(key, tried * s_, key, prm['successSeconds'], bool(prm.get('detectionDelay')), failed)
            rec(i + 1, tried * (1 - s_), failed + [(key, prm.get('failureSeconds', 0.0))])
            return
        if kind == 'predict':
            r = prm['recall']
            terminal('predict', tried * r, 'predict', prm['migrationSeconds'], False, failed)
            rec(i + 1, tried * (1 - r), failed)  # a missed prediction charges no time
            return
        s = prm['success']
        if kind == 'netfail':
            terminal('netfail', tried * s, 'netfail', prm['successSeconds'], False, failed)
        elif kind == 'replay':
            terminal('replay', tried * s, 'replay', prm['successSeconds'], True, failed)
        elif kind == 'hotswap':
            terminal('hotswap', tried * s, 'hotswap', prm['successSeconds'], True, failed)
        elif kind == 'elastic':
            terminal('elastic', tried * s, 'elastic', prm['syncSeconds'], False, failed)
        else:
            terminal('process', tried * s, 'process', prm['successSeconds'], True, failed)
        rec(i + 1, tried * (1 - s), failed + [(kind, prm['failureSeconds'])])

    rec(0, 1.0, [])
    mean_s = sum(contrib.values())
    assert abs(sum(probs.values()) - 1) < 1e-12
    return {'contrib': contrib, 'probs': probs, 'meanS': mean_s}


# ---------------------------------------------------------------- per-table derivations
def class_recovery(rec, row):
    """§24.2 (v5.5): a class with its own recovery stages keeps the job's stage for every stage it does not override; its automatic
    attempt is A_i = Σ stages_i and its global recovery g_i = G − (A − A_i)·(T_auto(N)/A) — the stage saving scaled like the attempt.
    The tables carry no recovery scale law, so T_auto(N) = A and g_i = G − (A − A_i); the manual share (1 − p_s)·T_manual is unchanged."""
    if rec['automatic'].get('scale') is not None:
        raise RuntimeError('a recovery scale law is not modelled here')
    A = rec['automatic']['seconds']
    st = automatic_stages(rec)
    rs = row.get('recoveryStages') or {}
    stages = OrderedDict((k, rs[k] if rs.get(k) is not None else st[k]) for k in ('startup', 'read', 'communication'))
    A_i = sum(stages.values())
    return stages, A_i, global_seconds(rec) - (A - A_i)


def class_splits(t):
    """chain split of every hard class of a table on its own global recovery and attempt (§24.2); also the max relative
    deviation from the engine's meanPauseS (reported only)"""
    rec = t['recovery']
    d = detect_seconds(rec)
    out = OrderedDict()
    worst = 0.0
    for r in t['rows']:
        _stages, A_i, g_i = class_recovery(rec, r)
        sp = chain_split(d, g_i, A_i, t['params'], r['applicable'], t.get('order'))
        out[r['id']] = sp
        if r['meanPauseS'] > 0:
            worst = max(worst, abs(sp['meanS'] - r['meanPauseS']) / r['meanPauseS'])
    return out, worst


def kpi_form(t, splits):
    """formula (1); t̄_i from the Python chain; φ from the engine's A_op (identity, declared)"""
    rec = t['recovery']
    d_check, G_check = detect_seconds(rec), global_seconds(rec)
    if abs(d_check - t['detectS']) > 1e-9 or abs(G_check - t['globalS']) > 1e-9:
        findings.append('detectS/globalS of the engine (%g, %g) differ from the recovery block (%g, %g)' % (t['detectS'], t['globalS'], d_check, G_check))
    lam = 0.0
    sumLP = 0.0
    for r in t['rows']:
        lam += r['ratePerHour']
        sumLP += r['ratePerHour'] * splits[r['id']]['meanS']
    o = t['other']
    sdc = t['sdc'] or {}
    if sdc.get('stepRecovery'):
        sdc_pause = sdc['detection']['detectSeconds'] + sdc['stepRecovery']['recoverSeconds'] + sdc['stepRecovery']['stepSeconds']
    else:
        sdc_pause = sdc['detection']['detectSeconds'] + o['globalRecoveryS']
    other = OrderedDict([
        ('isolation', (o['isolationPerHour'], o['globalRecoveryS'])),
        ('sdcDetected', (o['sdcDetectedPerHour'], sdc_pause)),
        ('falseAlarm', (o['falseAlarmPerHour'], o['predictMigrationS'] or 0.0)),
    ])
    F = sum(rate * pause for rate, pause in other.values())
    aRun = 1 / (1 + (sumLP + F) / 3600)
    if abs(aRun - t['aRun']) > 1e-9:
        findings.append('A_run closure: formula %r vs engine %r' % (aRun, t['aRun']))
    phi = 1 - t['aOp'] / aRun
    exp = OrderedDict()
    exp['lamHw'] = lam
    exp['sumLP'] = sumLP
    exp['mttrS'] = sumLP / lam
    exp['mtbfHwH'] = 1 / lam
    for oid, (rate, pause) in other.items():
        exp['other.%s.ratePerHour' % oid] = rate
        exp['other.%s.pauseS' % oid] = pause
        exp['other.%s.sPerH' % oid] = rate * pause
        if rate > 0:
            exp['other.%s.mtbfH' % oid] = 1 / rate
    exp['F'] = F
    exp['aRun'] = aRun
    exp['phi'] = phi
    exp['detectS'] = d_check
    exp['globalS'] = G_check
    form = {'lam': lam, 'sumLP': sumLP, 'F': F, 'phi': phi, 'aRun': aRun, 'other': other}
    # v5.6 the loss form of the effective goodput (formula 1′) beside the A_op form
    if 'tauS' in t:
        src = t.get('recomputeSource', 'tau/2')
        W = (t['tauS'] / 2 if src == 'tau/2' else (t['stepTimeS'] or 0.0) if src == 'step' else t['measuredRecomputeS']) + (t.get('rollbackLagS') or 0.0)
        if abs(W - t['recomputeS']) > 1e-9 * max(1.0, W):
            findings.append('recompute per rollback: %r from the source %s vs engine %r' % (W, src, t['recomputeS']))
        q_hw = sum(r['ratePerHour'] * r['pRollback'] * W for r in t['rows'])
        local = sum(r['ratePerHour'] * r['localLossS'] for r in t['rows']) / 3600
        fac = t['factors']
        if abs(local - fac['localLossFraction']) > 1e-9:
            findings.append('local loss fraction: Σλℓ/3600 = %r vs engine %r' % (local, fac['localLossFraction']))
        q_other = 0.0 if sdc.get('stepRecovery') else o['sdcDetectedPerHour'] * W
        save = t['deltaS'] / t['tauS']
        factor = (1 - fac['blocked']) * fac['performance'] * (1 - local) * (1 - fac['overhead'])
        sum_loss = sumLP + q_hw
        g_eff = (1 - fac['pauseFraction']) * factor * (1 - save - (sum_loss + F + q_other) / 3600)
        # v5.7 the loss form is the first-order model: it closes on the engine's first-order goodput in every regime
        g_fo_engine = (1 - fac['pauseFraction']) * factor * t['firstOrderGoodput']
        if t['firstOrderGoodput'] > 0 and abs(g_eff - g_fo_engine) > 1e-9:
            findings.append('effective goodput closure: formula %r vs engine first order %r' % (g_eff, g_fo_engine))
        # v5.7 the acceptance value is the exact renewal model's: (1 − p_sdc)·Φ·renewal (declared identity on the engine outputs)
        g_exact = (1 - fac['pauseFraction']) * factor * t['renewalGoodput']
        if abs(g_exact - t['effective']) > 1e-9:
            findings.append('exact effective goodput: (1 − p)Φ·renewal %r vs engine %r' % (g_exact, t['effective']))
        form.update({'W': W, 'qHw': q_hw, 'sumLoss': sum_loss, 'lossS': sum_loss / lam, 'qOther': q_other, 'save': save, 'factor': factor, 'pauseFrac': fac['pauseFraction'], 'effective': g_exact, 'effectiveFirstOrder': g_eff, 'effectiveEngine': t['effective'], 'headlineModel': t.get('headlineModel'), 'ledger': t.get('ledger')})
    return exp, form


def kpi_form_eff(form):
    """the exported fields of the loss form (formula 1′); v5.7 `effective` is the exact-renewal acceptance value (1 − p)Φ·renewal and
    `effectiveFirstOrder` the Python loss form (an identity on the engine's first-order goodput in every regime)"""
    exp = OrderedDict()
    exp['recomputeS'] = form['W']
    exp['hardRecomputeSPerH'] = form['qHw']
    exp['sumLoss'] = form['sumLoss']
    exp['lossS'] = form['lossS']
    exp['otherRecomputeSPerH'] = form['qOther']
    exp['saveFrac'] = form['save']
    exp['factor'] = form['factor']
    exp['pauseFrac'] = form['pauseFrac']
    exp['effective'] = form['effective']
    exp['effectiveFirstOrder'] = form['effectiveFirstOrder']
    return exp


def requirement_eff(form, target):
    """formula (2′) on the derated design's loss form; v5.7 Φ′ = (1 − p_sdc)·Φ, the product of the throughput factors (sixth review F1),
    and the episode pauses p_sdc counted with the other classes (M1)"""
    p = form['pauseFrac']
    phi = form['factor']
    phi_prime = (1 - p) * phi
    B = 3600 * (1 - form['save'] - target / phi_prime) - form['F'] - form['qOther']
    total = 3600 * (1 - target)
    mtbf = 1 / form['lam']
    loss = form['lossS']
    reachable = B > 0
    out = OrderedDict([
        ('B', B), ('totalBudget', total), ('todayLossS', loss),
        ('terms.save', 3600 * form['save']), ('terms.other', form['F'] + form['qOther'] + 3600 * target * p / ((1 - p) * phi)), ('terms.factors', 3600 * target * (1 / phi - 1)),
        ('ratioToday', loss / mtbf),
    ])
    if reachable:
        out['mtbfAtTodayMttrH'] = loss / B
        out['mttrAtTodayMtbfS'] = B * mtbf
        out['mtbfFactor'] = (loss / B) / mtbf
        out['mttrFactor'] = B * mtbf / loss
    out['reachable'] = 1.0 if reachable else 0.0
    return out


def loss_breakdown(t, splits, form):
    """formula (3′): the layers' shares of the engine ledger's downtime and rollback lines, the other lines, the closure;
    v5.7 the ledger is the exact-renewal one (the acceptance value's), split in proportion to C_ℓ and Q_ℓ"""
    W = form['W']
    c = OrderedDict((l, 0.0) for l in LAYERS)
    q = OrderedDict((l, 0.0) for l in LAYERS)
    for r in t['rows']:
        l = LAYER_OF_UNIT[r['unit']]
        c[l] += r['ratePerHour'] * splits[r['id']]['meanS']
        q[l] += r['ratePerHour'] * r['pRollback'] * W
    L = form['ledger']
    pauses = sum(c.values()) + form['F']
    recompute = sum(q.values()) + form['qOther']
    down = max(0.0, L['downtime'] - form['pauseFrac'])
    # v5.7 the exact ledger's seven loss lines add up to 1 − G_eff (exact): an identity on the engine outputs
    lines_sum = L['downtime'] + L['save'] + L['rollback'] + L['slowdown'] + L['local'] + L['blocked'] + L['overhead']
    if abs(lines_sum - (1 - form['effective'])) > 1e-9:
        findings.append('exact ledger lines %r vs 1 − G_eff %r' % (lines_sum, 1 - form['effective']))
    share = lambda cc, qq: 100 * ((down * cc / pauses if pauses > 0 else 0.0) + (L['rollback'] * qq / recompute if recompute > 0 else 0.0))
    exp = OrderedDict()
    hard = 0.0
    for l in LAYERS:
        exp['byLayer.%s' % l] = share(c[l], q[l])
        exp['recompute.%s' % l] = q[l]
        hard += exp['byLayer.%s' % l]
    exp['hard'] = hard
    exp['total'] = 100 * (1 - form['effective'])
    exp['other'] = exp['total'] - hard
    exp['lines.save'] = 100 * L['save']
    exp['lines.otherClasses'] = share(form['F'], form['qOther']) + 100 * form['pauseFrac']
    exp['lines.factors'] = 100 * (L['slowdown'] + L['local'] + L['blocked'] + L['overhead'])
    closure = hard + exp['lines.save'] + exp['lines.otherClasses'] + exp['lines.factors'] - exp['total']
    if abs(closure) > 1e-9:
        findings.append('loss split closure: Σ U_ℓ + lines − (1 − G_eff) = %r' % closure)
    exp['closure'] = closure
    return exp


def by_layer(t, splits, form):
    lam = OrderedDict((l, 0.0) for l in LAYERS)
    c = OrderedDict((l, 0.0) for l in LAYERS)
    for r in t['rows']:
        l = LAYER_OF_UNIT[r['unit']]
        lam[l] += r['ratePerHour']
        c[l] += r['ratePerHour'] * splits[r['id']]['meanS']
    slow = OrderedDict((l, 0.0) for l in LAYERS)
    sdcr = OrderedDict((l, 0.0) for l in LAYERS)
    sdcd = OrderedDict((l, 0.0) for l in LAYERS)
    # §24.3 (v5.5): the class's immediate detection coverage q_i = 1 − (1 − q_i,abs | q)·Π_k (1 − c_k) over its conditional detectors;
    # the detected-corruption pause is split by the detected rate Σ sdc_u·n_u·q_u (equal to the raw split while every q_u = q)
    q_job = ((t.get('sdc') or {}).get('detection') or {}).get('coverage', 0.0)
    for x in t['slowSdcByClass']:
        l = LAYER_OF_UNIT[x['unit']]
        slow[l] += x['slowPerUnitPerHour'] * x['count']
        sdcr[l] += x['sdcPerUnitPerHour'] * x['count']
        q_abs = x.get('sdcCoverage')
        miss = 1.0
        for gain in (x.get('sdcExtraDetection') or {}).values():
            miss *= (1 - gain)
        q_i = min(1.0, max(0.0, 1 - (1 - (q_abs if q_abs is not None else q_job)) * miss))
        sdcd[l] += x['sdcPerUnitPerHour'] * x['count'] * q_i
    iso_total = form['other']['isolation'][0] * form['other']['isolation'][1]
    sdc_total = form['other']['sdcDetected'][0] * form['other']['sdcDetected'][1]
    slow_sum, sdcd_sum = sum(slow.values()), sum(sdcd.values())
    iso = OrderedDict((l, iso_total * slow[l] / slow_sum if slow_sum > 0 else 0.0) for l in LAYERS)
    sdc = OrderedDict((l, sdc_total * sdcd[l] / sdcd_sum if sdcd_sum > 0 else 0.0) for l in LAYERS)
    D = 1 + (sum(c.values()) + form['F']) / 3600  # formula (3): F includes the predictor's false alarms, which no layer owns (v5.5: so does the engine)
    U = OrderedDict((l, 100 * c[l] / (3600 * D)) for l in LAYERS)
    exp = OrderedDict()
    for l in LAYERS:
        exp['%s.lam' % l] = lam[l]
        exp['%s.c' % l] = c[l]
        exp['%s.slowRate' % l] = slow[l]
        exp['%s.sdcRate' % l] = sdcr[l]
        exp['%s.sdcDetectedRate' % l] = sdcd[l]
        exp['%s.iso' % l] = iso[l]
        exp['%s.sdc' % l] = sdc[l]
        exp['%s.U' % l] = U[l]
    exp['sumLam'] = sum(lam.values())
    exp['sumC'] = sum(c.values())
    exp['sumIso'] = sum(iso.values())
    exp['sumSdc'] = sum(sdc.values())
    exp['D'] = D
    exp['hardU'] = sum(U.values())
    assert abs(exp['sumLam'] - form['lam']) < 1e-12 * form['lam'] and abs(exp['sumC'] - form['sumLP']) < 1e-12 * form['sumLP']
    return exp


def decomposition(t, splits):
    rec = t['recovery']
    lam = sum(r['ratePerHour'] for r in t['rows'])
    contrib = OrderedDict()
    probs = OrderedDict()
    for r in t['rows']:
        w = r['ratePerHour'] / lam
        for k, v in splits[r['id']]['contrib'].items():
            contrib[k] = contrib.get(k, 0.0) + w * v
        for k, v in splits[r['id']]['probs'].items():
            probs[k] = probs.get(k, 0.0) + w * v
    A = rec['automatic']['seconds']
    st = automatic_stages(rec)
    # §24.2 (v5.5): each class's global attempt split by its own stages, p_global,i · t_stage,i (= globalAuto_i · t_stage,i / A_i), rate-weighted
    stages = OrderedDict((k, 0.0) for k in ('startup', 'read', 'communication'))
    for r in t['rows']:
        w = r['ratePerHour'] / lam
        st_i, A_i, _g = class_recovery(rec, r)
        ga = splits[r['id']]['contrib']['globalAuto']
        if A_i > 0:
            for k in stages:
                stages[k] += w * ga * st_i[k] / A_i
    stages['manual'] = contrib['globalManual']
    exp = OrderedDict()
    for cid, sp in splits.items():
        for k, v in sp['contrib'].items():
            exp['class.%s.contrib.%s' % (cid, k)] = v
        for k, v in sp['probs'].items():
            exp['class.%s.probs.%s' % (cid, k)] = v
        exp['class.%s.meanS' % cid] = sp['meanS']
    for k, v in contrib.items():
        exp['job.contrib.%s' % k] = v
    for k, v in probs.items():
        exp['job.probs.%s' % k] = v
    for k, v in stages.items():
        exp['job.stages.%s' % k] = v
    exp['job.mttrS'] = sum(contrib.values())
    exp['job.recovery.tDetS'] = detect_seconds(rec)
    exp['job.recovery.automaticS'] = A
    exp['job.recovery.successProbability'] = rec['automatic']['successProbability']
    exp['job.recovery.manualS'] = rec['manual']['seconds']
    exp['job.recovery.globalS'] = global_seconds(rec)
    for k, v in st.items():
        exp['job.recovery.stages.%s' % k] = v
    # the plan's check: Σ stages = globalAuto + globalManual share of the MTTR
    assert abs(sum(stages.values()) - contrib['globalAuto'] - contrib['globalManual']) < 1e-12
    return exp


def requirement(form, target):
    B = 3600 * ((1 - form['phi']) / target - 1) - form['F']
    mttrS = form['sumLP'] / form['lam']
    mtbfHwH = 1 / form['lam']
    return OrderedDict([
        ('B', B),
        ('totalBudget', 3600 * (1 / target - 1)),
        ('mtbfAtTodayMttrH', mttrS / B),
        ('mttrAtTodayMtbfS', B * mtbfHwH),
        ('ratioToday', mttrS / mtbfHwH),
        ('mtbfFactor', (mttrS / B) / mtbfHwH),
        ('mttrFactor', B * mtbfHwH / mttrS),
    ])


# ---------------------------------------------------------------- G6 pruning rule
def prune(values, ids, threshold, dominated, reference, metric='aOp'):
    """values: {arch: {id: {'aOp': x, 'delivered': y, 'effective': z, 'onReference': {...}, 'halfWidthBy': {...}}}}; the Methodology §4
    rule on the metric (v5.6: 'effective'). v5.7 (sixth review F3, F6): a test passes only with a gain on top of the reference set
    (when the studies carry it), and each verdict states whether its deciding Shapley comparison clears the sampled half-width at
    the deciding architecture (the minimum); margin in half-widths, None for infinity."""
    archs = list(values.keys())
    verdicts = OrderedDict()
    lists = {'reference': [], 'candidate': [], 'goodput': [], 'pruned': [], 'capability': []}
    for mid in ids:
        present = [a for a in archs if mid in values[a]]
        missing = [a for a in archs if mid not in values[a]]
        aop = [values[a][mid]['aOp'] for a in present]
        dlv = [values[a][mid]['delivered'] for a in present]
        eff = [values[a][mid]['effective'] for a in present if 'effective' in values[a][mid]]
        main = eff if metric == 'effective' else aop
        v = OrderedDict()
        v['aOp'] = {'min': min(aop), 'max': max(aop)} if aop else None
        v['delivered'] = {'min': min(dlv), 'max': max(dlv)} if dlv else None
        v['effective'] = {'min': min(eff), 'max': max(eff)} if eff else None
        v['dominatedBy'] = dominated.get(mid)
        v['missing'] = missing
        main_key = 'effective' if metric == 'effective' else 'aOp'

        def ref_min(k):
            xs = [values[a][mid]['onReference'][k] for a in present if values[a][mid].get('onReference')]
            return min(xs) if xs else None
        on_ref = OrderedDict((k, ref_min(k)) for k in ('aOp', 'effective', 'delivered'))

        def test(k, vals):
            ref_ok = not (on_ref[k] is not None and on_ref[k] <= 0)
            margin = None
            if ref_ok:
                at, low = -1, float('inf')
                for i, a in enumerate(present):
                    x = values[a][mid].get(k, float('nan'))
                    if x < low:
                        at, low = i, x
                hw = values[present[at]][mid].get('halfWidthBy', {}).get(k) if at >= 0 else None
                if hw is not None and hw > 0:
                    margin = abs(low - threshold) / hw
            reached = bool(vals) and min(vals) >= threshold
            return {'pass': reached and ref_ok, 'refFail': reached and not ref_ok, 'margin': margin, 'resolved': not (margin is not None and margin < 1)}

        no_ref, resolved, margin = False, True, None
        if mid in reference:
            verdict = 'reference'
        elif not present:
            verdict = 'capability'
        elif mid in dominated:
            verdict = 'pruned'
        else:
            tm, td = test(main_key, main), test('delivered', dlv)
            if tm['pass']:
                verdict, resolved, margin = 'candidate', tm['resolved'], tm['margin']
            else:
                verdict = 'goodput' if td['pass'] else 'pruned'
                resolved = tm['resolved'] and td['resolved']
                ms = [m for m in (tm['margin'], td['margin']) if m is not None]
                margin = min(ms) if ms else None
                no_ref = tm['refFail'] or (not td['pass'] and td['refFail'])
        v['onReference'] = on_ref
        v['noReferenceGain'] = no_ref
        v['resolved'] = resolved
        v['margin'] = margin
        v['verdict'] = verdict
        verdicts[mid] = v
        lists[verdict].append(mid)
    return {'verdicts': verdicts, 'lists': lists}


def values_from_studies(studies, scale):
    out = OrderedDict()
    for arch, st in studies.items():
        gains = st['perSize'][str(scale)]['gains']
        out[arch] = OrderedDict((g['id'], dict([('aOp', g['aOp']['shapley']), ('delivered', g['delivered']['shapley'])] + ([('effective', g['effective']['shapley'])] if 'effective' in g else []) + ([('onReference', g['onReference'])] if g.get('onReference') else []) + ([('halfWidthBy', g['halfWidthBy'])] if g.get('halfWidthBy') else []))) for g in gains)
    return out


# ---------------------------------------------------------------- cases
cases = []
with open(RESULTS, encoding='utf-8') as f:
    results = json.load(f)

TABLES = OrderedDict([
    ('native950-500k', 'native950-500k.table.json'),
    ('native950-500k.derated', 'native950-500k.derated.table.json'),
    ('cm384-200k', 'cm384-200k.table.json'),
    ('cm384-200k.derated', 'cm384-200k.derated.table.json'),
    ('a3server-10k', 'a3server-10k.table.json'),
    ('a3server-10k.derated', 'a3server-10k.derated.table.json'),
    ('native950-500k.recommended', 'native950-500k.recommended.table.json'),
    ('cm384-200k.recommended', 'cm384-200k.recommended.table.json'),
    ('native950-500k.recommended-derated-k1', 'native950-500k.recommended-derated-k1.table.json'),
    ('cm384-200k.recommended-derated-k1', 'cm384-200k.recommended-derated-k1.table.json'),
    ('native950-500k.recommended-derated-k', 'native950-500k.recommended-derated-k.table.json'),
    ('cm384-200k.recommended-derated-k', 'cm384-200k.recommended-derated-k.table.json'),
    # v5.5 (fifth review D4 / M1 / M2): one mechanism each on today's a3server 10k
    ('a3server-10k.snapshot', 'a3server-10k.snapshot.table.json'),
    ('a3server-10k.predict', 'a3server-10k.predict.table.json'),
    ('a3server-10k.abft', 'a3server-10k.abft.table.json'),
])
ANALYSIS = OrderedDict()
for name, fname in TABLES.items():
    t = load(fname)
    splits, worst = class_splits(t)
    exp, form = kpi_form(t, splits)
    ANALYSIS[name] = {'t': t, 'splits': splits, 'form': form, 'worst': worst}
    if worst > 1e-9:
        findings.append('%s: Python chain mean pause differs from the engine meanPauseS by up to %.3g relative' % (name, worst))
    cases.append({
        'id': 'kpiForm.%s' % name, 'group': 'kpiForm',
        'inputs': {'table': fname, 'design': t['design'], 'engineAOp': t['aOp'], 'identity': ['aRun (formula = engine running fraction)', 'phi uses the engine A_op']},
        'expected': exp, 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

for name in ['native950-500k', 'native950-500k.recommended', 'cm384-200k', 'a3server-10k.derated', 'a3server-10k.predict', 'a3server-10k.abft']:
    a = ANALYSIS[name]
    cases.append({
        'id': 'byLayer.%s' % name, 'group': 'byLayer',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'layerOfUnit': LAYER_OF_UNIT, 'engineAOp': a['t']['aOp']},
        'expected': by_layer(a['t'], a['splits'], a['form']), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

for name in ['native950-500k', 'native950-500k.recommended', 'cm384-200k.recommended', 'native950-500k.recommended-derated-k1', 'a3server-10k.snapshot', 'a3server-10k.predict']:
    a = ANALYSIS[name]
    cases.append({
        'id': 'chain.%s' % name, 'group': 'chainSplit',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'detectS': a['t']['detectS'], 'globalS': a['t']['globalS'], 'autoS': a['t']['recovery']['automatic']['seconds'],
                   'params': a['t']['params'], 'order': a['t'].get('order'), 'recovery': a['t']['recovery'],
                   'applicable': OrderedDict((r['id'], r['applicable']) for r in a['t']['rows']), 'ratePerHour': OrderedDict((r['id'], r['ratePerHour']) for r in a['t']['rows']),
                   'engineMeanPauseS': OrderedDict((r['id'], r['meanPauseS']) for r in a['t']['rows']), 'engineMeanPauseMaxRelDiff': a['worst'],
                   'identity': ['class meanS = engine meanPauseS']},
        'expected': decomposition(a['t'], a['splits']), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

for name in ['native950-500k.derated', 'cm384-200k.derated', 'a3server-10k.derated']:
    a = ANALYSIS[name]
    cases.append({
        'id': 'requirement.%s' % name, 'group': 'requirement',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'target': TARGET, 'from': 'kpiForm.%s' % name},
        'expected': requirement(a['form'], TARGET), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

# v5.6 G1e: the loss form of the effective goodput on every table that carries its inputs
for name in TABLES:
    a = ANALYSIS[name]
    if 'W' not in a['form']:
        continue
    cases.append({
        'id': 'kpiFormEff.%s' % name, 'group': 'kpiFormEff',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'engineEffective': a['t']['effective'], 'headlineModel': a['t'].get('headlineModel'),
                   'identity': ['effective (formula 1′ = engine effectiveGoodput while first order)', 'P_rb,i, ℓ_i, P_blocked, φ_perf, o, p_sdc are engine outputs taken as inputs']},
        'expected': kpi_form_eff(a['form']), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })
# v5.6 G2e: the layer losses on the goodput basis
for name in ['native950-500k', 'native950-500k.derated', 'native950-500k.recommended-derated-k1', 'cm384-200k', 'a3server-10k.derated', 'a3server-10k.predict']:
    a = ANALYSIS[name]
    if 'W' not in a['form']:
        continue
    cases.append({
        'id': 'lossByLayer.%s' % name, 'group': 'lossByLayer',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'layerOfUnit': LAYER_OF_UNIT, 'engineLedger': a['t'].get('ledger'), 'identity': ['the ledger lines are engine outputs']},
        'expected': loss_breakdown(a['t'], a['splits'], a['form']), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })
# v5.6 G4e: formula (2′) on the derated designs (today's and the all-moves design)
for name in ['native950-500k.derated', 'cm384-200k.derated', 'a3server-10k.derated', 'native950-500k.recommended-derated-k1', 'cm384-200k.recommended-derated-k1']:
    a = ANALYSIS[name]
    if 'W' not in a['form']:
        continue
    cases.append({
        'id': 'requirementEff.%s' % name, 'group': 'requirementEff',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'target': TARGET, 'from': 'kpiFormEff.%s' % name},
        'expected': requirement_eff(a['form'], TARGET), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

for name, arch in [('native950-500k.recommended-derated-k1', 'native950'), ('cm384-200k.recommended-derated-k1', 'cm384')]:
    a = ANALYSIS[name]
    f = a['form']
    rec = results['archs'][arch]['sizes'][str(a['t']['design']['npus'])]['recommended']
    if rec.get('feasible') is False or rec['binding'] == 'none':
        # v5.6 G5e: no move set reaches the target — the all-moves design at k = 1; the loss form must say B ≤ 0 on its derated twin
        r_eff = requirement_eff(f, TARGET)
        if r_eff['B'] > 0:
            findings.append('%s: results.json says not feasible but formula (2′) gives B = %.6g > 0' % (name, r_eff['B']))
        if abs(a['t']['design']['k'] - 1) > 0 or abs(rec['k'] - 1) > 0:
            findings.append('%s: the all-moves design should be at k = 1 (table %r, results %r)' % (name, a['t']['design']['k'], rec['k']))
        cases.append({
            'id': 'allMoves.%s' % name, 'group': 'allMoves',
            'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'target': TARGET, 'resultsFeasible': rec.get('feasible'), 'resultsBinding': rec['binding'], 'resultsK': rec['k'], 'resultsCeiling': rec.get('ceiling'),
                       'construction': 'applyMechanisms(base, every candidate, REMAP_LATEST_PARAMS) → deratedOf → applyLevers(every lever, DERATE_DEFAULT); k = 1'},
            'expected': OrderedDict([('B', r_eff['B']), ('effective', f['effective']), ('reachable', 0.0), ('k', 1.0)]),
            'tolerance': {'rel': 1e-9, 'abs': 1e-12},
            'note': 'v5.6: the 98.5 % effective-goodput goal is out of reach on the default set (the saves alone cost δ/τ = 1.67 % nominal, 2.5 % derated); the window rule returns the all-moves design at k = 1 with feasible false; the first-order k* case of G5 needs the mean to bind and is skipped here.',
        })
        continue
    if rec['binding'] != 'mean':
        raise RuntimeError('%s: recommended.binding is %r, the closed form needs the mean to bind' % (name, rec['binding']))
    # (a) the first-order closed form (φ, F frozen at k = 1) — the check that it agrees with the engine's bisection root to ~1e-5
    k_star = (3600 * ((1 - f['phi']) / TARGET - 1) - f['F']) / f['sumLP']
    rel = abs(k_star - rec['k']) / rec['k']
    if rel > 2e-5:
        findings.append('%s: closed-form k* = %.12g vs results.json recommended.k = %.12g (relative %.3g > 2e-5)' % (name, k_star, rec['k'], rel))
    cases.append({
        'id': 'kStar.%s' % name, 'group': 'kStar',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'target': TARGET, 'resultsK': rec['k'], 'resultsBinding': rec['binding'], 'resultsEscalated': rec.get('escalated'),
                   'construction': 'applyMechanisms(base, mechanisms, REMAP_LATEST_PARAMS) → deratedOf → applyLevers(levers, DERATE_DEFAULT); then withHardwareFactors(k) on every class with failure.value > 0',
                   'phi': f['phi'], 'F': f['F'], 'sumC1': f['sumLP'], 'relDiffToResultsK': rel},
        'expected': OrderedDict([('kStar', k_star), ('sumC1', f['sumLP']), ('F', f['F']), ('phi', f['phi']), ('aOpAtKStar', TARGET)]),
        'tolerance': {'kStarVsResultsRel': 2e-5, 'aOpAbs': 3e-7, 'rel': 1e-9, 'abs': 1e-12},
        'note': 'First-order closed form: kStar has φ and F frozen at k = 1; resultsK is the engine bisection root of A_op,der(k) = A* with φ evaluated at k (the defining "mean binds" k). φ moves with k through the silent-corruption window, so the two agree to ~1e-5 relative (decision of 2026-10-21): tolerances 2e-5 on k and 3e-7 on A_op(kStar) − A*.',
    })
    # (b) the exact identity at the engine's k: the derated design at results.json's k has (1 − φ(k)) / (1 + (ΣC(k) + F)/3600) = A*
    #     with φ(k) the declared identity on that table's engine A_op, and ΣC(k) = k·ΣC₁ (the hardware pause sum scales exactly)
    ak = ANALYSIS[name.replace('-k1', '-k')]
    fk = ak['form']
    if abs(ak['t']['design']['k'] - rec['k']) > 0:
        raise RuntimeError('%s: the k table was dumped at k = %r, results.json has %r' % (name, ak['t']['design']['k'], rec['k']))
    a_op_form = (1 - fk['phi']) / (1 + (fk['sumLP'] + fk['F']) / 3600)
    k_times_sum_c1 = rec['k'] * f['sumLP']
    if abs(a_op_form - TARGET) > 1e-9:
        findings.append('%s at results.k: formula A_op %.15g vs A* %.15g' % (name, a_op_form, TARGET))
    if abs(fk['sumLP'] - k_times_sum_c1) > 1e-9 * k_times_sum_c1:
        findings.append('%s at results.k: ΣC(k) = %.12g vs k·ΣC₁ = %.12g' % (name, fk['sumLP'], k_times_sum_c1))
    if abs(fk['F'] - f['F']) > 1e-9 * f['F']:
        findings.append('%s at results.k: F(k) = %.12g vs F(1) = %.12g (F should not move with k)' % (name, fk['F'], f['F']))
    cases.append({
        'id': 'kExact.%s' % name.replace('-k1', '-k'), 'group': 'kExact',
        'inputs': {'table': TABLES[name.replace('-k1', '-k')], 'design': ak['t']['design'], 'target': TARGET, 'resultsK': rec['k'], 'sumC1': f['sumLP'], 'phiAtK1': f['phi'],
                   'engineAOp': ak['t']['aOp'], 'identity': ['phi uses the engine A_op of the table at k'],
                   'construction': 'applyMechanisms(base, mechanisms, REMAP_LATEST_PARAMS) → deratedOf → applyLevers(levers, DERATE_DEFAULT) → withHardwareFactors(resultsK)'},
        'expected': OrderedDict([('sumCk', fk['sumLP']), ('kTimesSumC1', k_times_sum_c1), ('F', fk['F']), ('phi', fk['phi']), ('aOpFormula', a_op_form), ('target', TARGET),
                                 ('phiShiftFromK1', fk['phi'] - f['phi'])]),
        'tolerance': {'rel': 1e-9, 'abs': 1e-12, 'aOpAbs': 1e-9},
        'note': 'Identity at the engine\'s bisection root: formula (1) evaluated on the derated design at results.json\'s k reproduces A* to 1e-9; ΣC(k) = k·ΣC₁ shows that only the hardware pause scales; phiShiftFromK1 is the φ(k) − φ(1) that the first-order form of (a) neglects.',
    })

# G6 — stored studies
studies = OrderedDict()
for arch in ARCHS:
    with open(os.path.join(SHAPLEY_DIR, arch + '.json'), encoding='utf-8') as f:
        studies[arch] = json.load(f)
values = values_from_studies(studies, 500000)
player_ids = list(values['native950'].keys())
for arch in ARCHS:
    assert list(values[arch].keys()) == player_ids, arch
ids = player_ids + ['I-CONTAIN']
pr = prune(values, ids, THRESHOLD, DOMINATED, REFERENCE)
cases.append({
    'id': 'prune.stored-500k', 'group': 'prune',
    'inputs': {'studies': 'docs/backup/arch-mechanism-shapley/{%s}.json' % ','.join(ARCHS), 'scale': 500000, 'ids': ids, 'threshold': THRESHOLD, 'dominated': DOMINATED, 'reference': REFERENCE, 'metric': 'aOp',
               'values': values},
    'expected': pr, 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})
# v5.6 G6e: the same studies under the effective-goodput rule (the set record's prune.metric)
pr_eff = prune(values, ids, THRESHOLD, DOMINATED, REFERENCE, 'effective')
cases.append({
    'id': 'pruneEff.stored-500k', 'group': 'pruneEff',
    'inputs': {'studies': 'docs/backup/arch-mechanism-shapley/{%s}.json' % ','.join(ARCHS), 'scale': 500000, 'ids': ids, 'threshold': THRESHOLD, 'dominated': DOMINATED, 'reference': REFERENCE, 'metric': 'effective',
               'values': values},
    'expected': pr_eff, 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})
# cross-check against the published verdicts (mechanisms.json) — reported, never used as the expectation
try:
    with open(os.path.join(ROOT, 'docs', 'backup', 'ascend-allocation', 'mechanisms.json'), encoding='utf-8') as f:
        published = {m['id']: m.get('verdict') for m in json.load(f)['mechanisms']}
    for mid, v in pr_eff['verdicts'].items():
        if published.get(mid) != v['verdict']:
            findings.append('prune (effective): %s rule verdict %s vs published %s' % (mid, v['verdict'], published.get(mid)))
except (OSError, KeyError, ValueError) as e:
    findings.append('prune: could not cross-check mechanisms.json (%s)' % e)

# G6 — synthetic studies exercising every branch (threshold edge: exactly 0.0015 counts as ≥). The ids are real library ids
# with hand-set values (the engine looks every id up in the mechanism library; the roles below are the synthetic ones).
SYN_ARCHS = ['alpha', 'beta', 'gamma']
SYN = OrderedDict([
    ('D-SDC', ([0.0001, 0.0002, 0.0003], [0.0, 0.0, 0.0])),                        # reference, kept whatever its values
    ('D-HARD', ([0.0015, 0.002, 0.003], [0.001, 0.001, 0.001])),                    # min A_op exactly at the threshold → candidate
    ('C-LOSSLESS', ([0.01, 0.02, 0.03], [0.0, 0.0, 0.0])),                          # candidate
    ('D-ABFT', ([0.00149999, 0.002, 0.003], [0.0015, 0.0016, 0.0017])),             # A_op just below, delivered exactly at the threshold → goodput
    ('D-NET-SDC', ([-0.001, 0.0, 0.001], [0.002, 0.003, 0.004])),                   # goodput
    ('D-SLOW', ([0.0014, 0.0014, 0.0014], [0.0014, 0.0014, 0.0014])),               # below both thresholds → pruned
    ('R-WARM-PROCESS', ([0.01, 0.01, 0.01], [0.01, 0.01, 0.01])),                   # dominated by D-HARD here → pruned although large
])
SYN_DOMINATED = {'R-WARM-PROCESS': 'D-HARD'}
SYN_REFERENCE = ['D-SDC']
syn_studies = OrderedDict()
for j, arch in enumerate(SYN_ARCHS):
    syn_studies[arch] = {'perSize': {'500000': {'gains': [{'id': mid, 'aOp': {'shapley': v[0][j]}, 'delivered': {'shapley': v[1][j]}} for mid, v in SYN.items()]}}}
syn_ids = list(SYN.keys()) + ['I-CONTAIN']                                          # I-CONTAIN absent from every study → capability
syn_values = values_from_studies(syn_studies, 500000)
cases.append({
    'id': 'prune.synthetic', 'group': 'prune',
    'inputs': {'studies': syn_studies, 'scale': 500000, 'ids': syn_ids, 'threshold': THRESHOLD, 'dominated': SYN_DOMINATED, 'reference': SYN_REFERENCE, 'metric': 'aOp', 'values': syn_values},
    'expected': prune(syn_values, syn_ids, THRESHOLD, SYN_DOMINATED, SYN_REFERENCE), 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})
# v5.6 G6e synthetic: effective values that move verdicts against the A_op ones (C-LOSSLESS falls below on the effective goodput, D-SLOW rises)
SYN_EFF = OrderedDict([('D-SDC', [0.0, 0.0, 0.0]), ('D-HARD', [0.0015, 0.0015, 0.0015]), ('C-LOSSLESS', [0.001, 0.02, 0.03]), ('D-ABFT', [-0.001, -0.001, -0.001]),
                       ('D-NET-SDC', [0.0, 0.0, 0.0]), ('D-SLOW', [0.0016, 0.002, 0.0015]), ('R-WARM-PROCESS', [0.01, 0.01, 0.01])])
syn_eff_studies = OrderedDict()
for j, arch in enumerate(SYN_ARCHS):
    syn_eff_studies[arch] = {'perSize': {'500000': {'gains': [{'id': mid, 'aOp': {'shapley': v[0][j]}, 'delivered': {'shapley': v[1][j]}, 'effective': {'shapley': SYN_EFF[mid][j]}} for mid, v in SYN.items()]}}}
syn_eff_values = values_from_studies(syn_eff_studies, 500000)
cases.append({
    'id': 'pruneEff.synthetic', 'group': 'pruneEff',
    'inputs': {'studies': syn_eff_studies, 'scale': 500000, 'ids': syn_ids, 'threshold': THRESHOLD, 'dominated': SYN_DOMINATED, 'reference': SYN_REFERENCE, 'metric': 'effective', 'values': syn_eff_values},
    'expected': prune(syn_eff_values, syn_ids, THRESHOLD, SYN_DOMINATED, SYN_REFERENCE, 'effective'), 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})

# v5.7 G6e synthetic (sixth review F3, F6): reference gains and half-widths. C-ASYNC reaches the threshold but loses on top of the
# reference set (pruned, noReferenceGain); H-SDC-SCREEN the same on the effective goodput but gains delivered on the reference set
# (goodput); R-FABRIC-DEGRADE a candidate within its half-width (unresolved); R-LINK-LOCAL a resolved candidate; D-SLOW pruned below
# the threshold within its half-width (unresolved); D-HARD carries no reference gain (a study written before v5.7: the test is skipped).
SYN_REF = OrderedDict([
    # id: (effective Shapley per arch, delivered Shapley per arch, onReference per arch or None, effective half-width per arch)
    ('D-SDC', ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], None, [0.0, 0.0, 0.0])),
    ('C-ASYNC', ([0.0017, 0.002, 0.0019], [0.0009, 0.001, 0.0011], {'aOp': 0.0, 'effective': -0.0013, 'delivered': -0.0011}, [0.00045, 0.00046, 0.00044])),
    ('H-SDC-SCREEN', ([0.002, 0.003, 0.004], [0.004, 0.005, 0.006], {'aOp': 0.0, 'effective': -0.0001, 'delivered': 0.002}, [0.0001, 0.0001, 0.0001])),
    ('R-FABRIC-DEGRADE', ([0.0016, 0.0017, 0.0018], [0.001, 0.001, 0.001], {'aOp': 0.0002, 'effective': 0.0004, 'delivered': 0.0003}, [0.0003, 0.0003, 0.0003])),
    ('R-LINK-LOCAL', ([0.01, 0.009, 0.011], [0.008, 0.008, 0.008], {'aOp': 0.003, 'effective': 0.004, 'delivered': 0.003}, [0.0006, 0.0006, 0.0006])),
    ('D-SLOW', ([0.0014, 0.0016, 0.0017], [0.0002, 0.0002, 0.0002], {'aOp': 0.0001, 'effective': 0.0001, 'delivered': 0.0001}, [0.0002, 0.0002, 0.0002])),
    ('D-HARD', ([0.003, 0.003, 0.003], [0.002, 0.002, 0.002], None, [0.0001, 0.0001, 0.0001])),
])
syn_ref_studies = OrderedDict()
for j, arch in enumerate(SYN_ARCHS):
    gains = []
    for mid, (eff, dlv, ref, hw) in SYN_REF.items():
        g = {'id': mid, 'aOp': {'shapley': 0.0}, 'delivered': {'shapley': dlv[j]}, 'effective': {'shapley': eff[j]}, 'halfWidthBy': {'aOp': 0.0, 'effective': hw[j], 'delivered': 0.0001}}
        if ref is not None:
            g['onReference'] = ref
        gains.append(g)
    syn_ref_studies[arch] = {'perSize': {'500000': {'gains': gains}}}
syn_ref_ids = list(SYN_REF.keys())
syn_ref_values = values_from_studies(syn_ref_studies, 500000)
cases.append({
    'id': 'pruneEff.reference-synthetic', 'group': 'pruneEff',
    'inputs': {'studies': syn_ref_studies, 'scale': 500000, 'ids': syn_ref_ids, 'threshold': THRESHOLD, 'dominated': {}, 'reference': ['D-SDC'], 'metric': 'effective', 'values': syn_ref_values},
    'expected': prune(syn_ref_values, syn_ref_ids, THRESHOLD, {}, ['D-SDC'], 'effective'), 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})

out = {
    'generated_by': 'compute_golden_v5.py',
    'version': '5.0',
    'spec': 'PLAN_V5_REPORT_PIPELINE.md §3 / §7 T9; Methodology formulas (1)–(5) (packages/reports/src/content.mjs FORMULAS, LAYERS_TEXT, MECH_TEXT); MODEL_REFERENCE.md §18, §19, §19.1, §19.2, §24.1, §24.2',
    'inputs': 'inputs_v5/*.table.json (dump_inputs_v5.mjs), docs/backup/ascend-allocation/results.json (recommended plans: mechanisms, levers, k, binding), docs/backup/arch-mechanism-shapley/*.json',
    'findings': findings,
    'cases': cases,
}
with open(os.path.join(HERE, 'golden_v5.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1)

print(len(cases), 'cases')
for c in cases:
    e = c['expected']
    if c['group'] == 'prune':
        print(c['id'], {k: v['verdict'] for k, v in e['verdicts'].items()})
    elif c['group'] == 'chainSplit':
        print(c['id'], 'mttrS=%.9g' % e['job.mttrS'], 'stages', {k: round(e['job.stages.' + k], 6) for k in ('startup', 'read', 'communication', 'manual')}, 'pGlobal=%.6g' % e['job.probs.global'])
    else:
        print(c['id'], {k: (round(v, 9) if isinstance(v, float) else v) for k, v in e.items() if not k.startswith('other.') and '.slowRate' not in k and '.sdcRate' not in k})
print('findings:', len(findings))
for x in findings:
    print(' -', x)
