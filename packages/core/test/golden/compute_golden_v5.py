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
    Σ slow_u·n_u and silent rate Σ sdc_u·n_u; U_ℓ = 100·C_ℓ / (3600·D), D = 1 + (Σ_ℓ C_ℓ + F) / 3600 (percentage points of A_op).
    Identities: Σ_ℓ λ_ℓ = λ_hw, Σ_ℓ C_ℓ = ΣC.
  * G3 chainSplit / mttrDecomposition — §19, §19.1, §19.2, §24.1, §24.2: recursive enumeration of the rung tree
    predict → netfail → transparent custom rungs → ordered detection-delayed rungs (default replay → hotswap → elastic →
    process) → delayed custom rungs → global, recording per terminal its probability and the pause by contributor:
    `detect` (t_d, charged by replay / hotswap / process / detection-delayed custom rungs / global), the rung's own success
    time under its id (`custom:<id>` for custom rungs; elastic charges t_sync), `failed:<rung>` for the failure time of every
    rung tried and failed before the terminal, `globalAuto` = p_global·T_auto and `globalManual` = p_global·(G − T_auto).
    Σ contributions = the class mean pause (identity with the engine's meanPauseS, ≤ 1e-9 relative). Job level: rate-weighted
    means; stages = globalAuto split as the automatic stages (thirds when absent, else the given stages rescaled to T_auto),
    manual = globalManual; MTTR = Σ contributions.
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
Run: python3 compute_golden_v5.py  → golden_v5.json   (Python 3.9, standard library only)
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


def chain_split(detect_s, global_s, auto_s, params, applicable, order=None):
    """Enumerate the rung tree (the recursion of compute_golden_v3.chain) and book every terminal's pause by contributor."""
    custom = params.get('custom') or {}
    capp = applicable.get('custom') or {}
    customs = lambda pos: [(('custom', cid), capp.get(cid, 0.0), cr) for cid, cr in custom.items() if cr.get('position', 'transparent') == pos and capp.get(cid, 0.0) > 0]
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
def class_splits(t):
    """chain split of every hard class of a table; also the max relative deviation from the engine's meanPauseS (reported only)"""
    rec = t['recovery']
    d, G, A = detect_seconds(rec), global_seconds(rec), rec['automatic']['seconds']
    out = OrderedDict()
    worst = 0.0
    for r in t['rows']:
        if r.get('recoveryStages'):
            raise RuntimeError('%s: per-class recovery stages present; the class global recovery g_i (§24.2) is not modelled here' % r['id'])
        sp = chain_split(d, G, A, t['params'], r['applicable'], t.get('order'))
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
    return exp, {'lam': lam, 'sumLP': sumLP, 'F': F, 'phi': phi, 'aRun': aRun, 'other': other}


def by_layer(t, splits, form):
    lam = OrderedDict((l, 0.0) for l in LAYERS)
    c = OrderedDict((l, 0.0) for l in LAYERS)
    for r in t['rows']:
        l = LAYER_OF_UNIT[r['unit']]
        lam[l] += r['ratePerHour']
        c[l] += r['ratePerHour'] * splits[r['id']]['meanS']
    slow = OrderedDict((l, 0.0) for l in LAYERS)
    sdcr = OrderedDict((l, 0.0) for l in LAYERS)
    for x in t['slowSdcByClass']:
        l = LAYER_OF_UNIT[x['unit']]
        slow[l] += x['slowPerUnitPerHour'] * x['count']
        sdcr[l] += x['sdcPerUnitPerHour'] * x['count']
    iso_total = form['other']['isolation'][0] * form['other']['isolation'][1]
    sdc_total = form['other']['sdcDetected'][0] * form['other']['sdcDetected'][1]
    slow_sum, sdc_sum = sum(slow.values()), sum(sdcr.values())
    iso = OrderedDict((l, iso_total * slow[l] / slow_sum if slow_sum > 0 else 0.0) for l in LAYERS)
    sdc = OrderedDict((l, sdc_total * sdcr[l] / sdc_sum if sdc_sum > 0 else 0.0) for l in LAYERS)
    D = 1 + (sum(c.values()) + form['F']) / 3600  # formula (3); equals 1 + Σ_ℓ (C_ℓ + iso_ℓ + sdc_ℓ)/3600 when there are no false alarms
    U = OrderedDict((l, 100 * c[l] / (3600 * D)) for l in LAYERS)
    exp = OrderedDict()
    for l in LAYERS:
        exp['%s.lam' % l] = lam[l]
        exp['%s.c' % l] = c[l]
        exp['%s.slowRate' % l] = slow[l]
        exp['%s.sdcRate' % l] = sdcr[l]
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
    stages = OrderedDict((k, contrib['globalAuto'] * st[k] / A) for k in ('startup', 'read', 'communication'))
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
def prune(values, ids, threshold, dominated, reference):
    """values: {arch: {id: {'aOp': x, 'delivered': y}}}; the Methodology §4 rule."""
    archs = list(values.keys())
    verdicts = OrderedDict()
    lists = {'reference': [], 'candidate': [], 'goodput': [], 'pruned': [], 'capability': []}
    for mid in ids:
        present = [a for a in archs if mid in values[a]]
        missing = [a for a in archs if mid not in values[a]]
        aop = [values[a][mid]['aOp'] for a in present]
        dlv = [values[a][mid]['delivered'] for a in present]
        v = OrderedDict()
        v['aOp'] = {'min': min(aop), 'max': max(aop)} if aop else None
        v['delivered'] = {'min': min(dlv), 'max': max(dlv)} if dlv else None
        v['dominatedBy'] = dominated.get(mid)
        v['missing'] = missing
        if mid in reference:
            verdict = 'reference'
        elif not present:
            verdict = 'capability'
        elif mid in dominated:
            verdict = 'pruned'
        elif min(aop) >= threshold:
            verdict = 'candidate'
        elif min(dlv) >= threshold:
            verdict = 'goodput'
        else:
            verdict = 'pruned'
        v['verdict'] = verdict
        verdicts[mid] = v
        lists[verdict].append(mid)
    return {'verdicts': verdicts, 'lists': lists}


def values_from_studies(studies, scale):
    out = OrderedDict()
    for arch, st in studies.items():
        gains = st['perSize'][str(scale)]['gains']
        out[arch] = OrderedDict((g['id'], {'aOp': g['aOp']['shapley'], 'delivered': g['delivered']['shapley']}) for g in gains)
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

for name in ['native950-500k', 'native950-500k.recommended', 'cm384-200k', 'a3server-10k.derated']:
    a = ANALYSIS[name]
    cases.append({
        'id': 'byLayer.%s' % name, 'group': 'byLayer',
        'inputs': {'table': TABLES[name], 'design': a['t']['design'], 'layerOfUnit': LAYER_OF_UNIT, 'engineAOp': a['t']['aOp']},
        'expected': by_layer(a['t'], a['splits'], a['form']), 'tolerance': {'rel': 1e-9, 'abs': 1e-12},
    })

for name in ['native950-500k', 'native950-500k.recommended', 'cm384-200k.recommended', 'native950-500k.recommended-derated-k1']:
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

for name, arch in [('native950-500k.recommended-derated-k1', 'native950'), ('cm384-200k.recommended-derated-k1', 'cm384')]:
    a = ANALYSIS[name]
    f = a['form']
    rec = results['archs'][arch]['sizes'][str(a['t']['design']['npus'])]['recommended']
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
    'inputs': {'studies': 'docs/backup/arch-mechanism-shapley/{%s}.json' % ','.join(ARCHS), 'scale': 500000, 'ids': ids, 'threshold': THRESHOLD, 'dominated': DOMINATED, 'reference': REFERENCE,
               'values': values},
    'expected': pr, 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
})
# cross-check against the published verdicts (mechanisms.json) — reported, never used as the expectation
try:
    with open(os.path.join(ROOT, 'docs', 'backup', 'ascend-allocation', 'mechanisms.json'), encoding='utf-8') as f:
        published = {m['id']: m.get('verdict') for m in json.load(f)['mechanisms']}
    for mid, v in pr['verdicts'].items():
        if published.get(mid) != v['verdict']:
            findings.append('prune: %s rule verdict %s vs published %s' % (mid, v['verdict'], published.get(mid)))
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
    'inputs': {'studies': syn_studies, 'scale': 500000, 'ids': syn_ids, 'threshold': THRESHOLD, 'dominated': SYN_DOMINATED, 'reference': SYN_REFERENCE, 'values': syn_values},
    'expected': prune(syn_values, syn_ids, THRESHOLD, SYN_DOMINATED, SYN_REFERENCE), 'tolerance': {'rel': 1e-12, 'abs': 1e-15},
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
