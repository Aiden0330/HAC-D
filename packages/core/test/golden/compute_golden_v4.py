"""
Independent golden vectors for the v4 topology templates (docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2), computed from the
specification without reading the TypeScript engine:
  * folded Clos counts: leaf down ports d = floor(k*o/(1+o)); t tiers carry d*k*(k/2)^(t-2) ports (one switch when P <= k);
    tier 1 = ceil(P/d), middle tiers ceil(H/(k/2)), top tier ceil(H/k), H = ceil(P/o); links = P + (t-1)*H;
  * template hardware counts at the built-in 10k / 100k / 200k / 500k NPUs and at 384 / 1k / 8,192 / 12,345 / 20k / 50k
    (and pod-aligned sizes): nodes, CPUs, cabinets, SuperPoDs,
    communication cabinets and L2 chips with the port-count fill of the last pod, L1 chips, UB links, scale-out Clos;
  * per-unit FIT: catalog FIT per card-hour x 384 / (units in one CloudMatrix384 pod: 48 nodes, 192 CPUs, 12 compute cabinets,
    336 + 112 UB chips, 5,376 L1-L2 links, paper geometry), the hard FIT per NPU of each unit type and the job's hard
    interruption rate sum(count x FIT_unit) / 1e9 per hour.
The 54 catalog events are read as data from src/scenario/referenceEvents.ts (the JSON array literal).
Run: python3 compute_golden_v4.py  -> golden_v4.json
"""
import json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'src', 'scenario', 'referenceEvents.ts')
text = open(SRC, encoding='utf-8').read()
arr = text[text.index('REFERENCE_EVENTS: ReferenceEvent[] = ') + len('REFERENCE_EVENTS: ReferenceEvent[] = '):]
arr = arr[:arr.rindex(']') + 1]
EVENTS = json.loads(arr)
assert len(EVENTS) == 54

def clos(P, k, o=1.0, tpl=2):
    P = math.ceil(P)
    if P <= 0:
        return {"tiers": 0, "perTier": [], "switches": 0, "links": 0, "transceivers": 0}
    if P <= k:
        return {"tiers": 1, "perTier": [1], "switches": 1, "links": P, "transceivers": P * tpl}
    d = max(1, math.floor(k * o / (1 + o)))
    t = 2
    while P > d * k * (k / 2) ** (t - 2):
        t += 1
    H = math.ceil(P / o)
    per = [math.ceil(P / d)] + [math.ceil(H / (k / 2)) for _ in range(t - 2)] + [math.ceil(H / k)]
    links = P + (t - 1) * H
    return {"tiers": t, "perTier": per, "switches": sum(per), "links": links, "transceivers": links * tpl}

# template geometry (paper / vendor / assumed values as stated in the plan)
CM384 = dict(npn=8, cpn=4, l1=7, npr=4, crk=12, comm=4, sub=7, l2ps=16, l2p=48, lpl1=16, tpl=2, rdma=2)
A950 = dict(npn=8, cpn=4, l1=7, npr=8, crk=128, comm=32, sub=7, l2ps=math.ceil(1024 * 16 / 48), l2p=48, lpl1=16, tpl=2, rdma=2)
TEMPLATES = {
    'a2-roce': dict(npn=8, cpn=4, npr=8, pod=None, so=dict(ports=1, k=64, o=1, tpl=2)),
    'a3-ub384': dict(npn=8, cpn=4, npr=4, pod=CM384, so=dict(ports=2, k=64, o=1, tpl=2)),
    'a950-ub2': dict(npn=8, cpn=4, npr=8, pod=A950, so=dict(ports=2, k=64, o=1, tpl=2)),
}

def counts(tid, N, fill='proportional', scale_out=True):
    T = TEMPLATES[tid]
    nodes = math.ceil(N / T['npn'])
    out = {"npus": N, "nodes": nodes, "cpus": nodes * T['cpn'], "cabinets": math.ceil(nodes / T['npr'])}
    p = T['pod']
    if p:
        npp = p['npr'] * p['crk']
        pods = max(1, math.ceil(nodes / npp))
        full = nodes // npp
        rem = nodes - full * npp
        l2full = p['sub'] * p['l2ps']
        def l2_for(n):
            per_sub = math.ceil(n * p['l1'] * p['lpl1'] / p['sub'] / p['l2p'])
            return p['sub'] * min(p['l2ps'], per_sub)
        if fill == 'proportional':
            l2rem = l2_for(rem) if rem > 0 else 0
            l2 = full * l2full + l2rem
            comm = full * p['comm'] + (min(p['comm'], math.ceil(l2rem * p['comm'] / l2full)) if rem > 0 else 0)
        else:
            l2 = pods * l2full
            comm = pods * p['comm']
        links = nodes * p['l1'] * p['lpl1']
        out.update({"pods": pods, "commCabinets": comm, "l1": nodes * p['l1'], "l2": l2, "ubLinks": links, "ubTransceivers": links * p['tpl']})
    if scale_out:
        so = T['so']
        c = clos(N * so['ports'], so['k'], so['o'], so['tpl'])
        out.update({"roPorts": N * so['ports'], "roTiers": c['tiers'], "roSwitches": c['switches'], "roLinks": c['links']})
        for i, n in enumerate(c['perTier']):
            out["roTier%d" % (i + 1)] = n
    return out

# per-unit FIT under the CloudMatrix384 pod geometry
POD = {"npus": 384, "nodes": 48, "cpus": 192, "cabinets": 12, "ubChips": 336 + 112, "ubLinks": 5376}
CARDS = {"npu": 1, "job": 1, "cpu": POD["npus"] / POD["cpus"], "node": POD["npus"] / POD["nodes"], "cabinet": POD["npus"] / POD["cabinets"],
         "ub-switch": POD["npus"] / POD["ubChips"], "ub-link": POD["npus"] / POD["ubLinks"], "roce-switch": POD["npus"] / POD["ubChips"], "roce-link": POD["npus"] / POD["ubLinks"]}
UNIT = {"CORE": "npu", "SRAM": "npu", "IOD": "npu", "MODULE": "npu", "MEMT": "npu", "MEMP": "npu", "NIC": "npu", "STORAGE": "job", "UNKNOWN": "job", "CPU": "cpu",
        "DDR": "node", "SSD": "node", "BOXIO": "node", "MGMT": "node", "POWER": "cabinet", "COOL": "cabinet", "FABRIC": "ub-switch", "OPT": "ub-link"}
ROCE = {"FABRIC": "roce-switch", "OPT": "roce-link"}

def hard_fit_per_unit():
    f = {}
    for e in EVENTS:
        if e['type'] != 'hard':
            continue
        u = UNIT[e['domainId']]
        f[u] = f.get(u, 0) + e['fit'] * CARDS[u]
        if e['domainId'] in ROCE:
            r = ROCE[e['domainId']]
            f[r] = f.get(r, 0) + e['fit'] * CARDS[r]
    return f

def hard_rates(tid, N, fill='proportional', scale_out=True):
    c = counts(tid, N, fill, scale_out)
    f = hard_fit_per_unit()
    unit_count = {"npu": N, "job": N, "cpu": c['cpus'], "node": c['nodes'], "cabinet": c['cabinets']}
    if TEMPLATES[tid]['pod']:
        unit_count["ub-switch"] = c['l1'] + c['l2']
        unit_count["ub-link"] = c['ubLinks']
    if scale_out:
        unit_count["roce-switch"] = c['roSwitches']
        unit_count["roce-link"] = c['roLinks']
    per_npu = {u: f[u] * n / N for u, n in unit_count.items()}
    total = sum(f[u] * n for u, n in unit_count.items()) / 1e9
    return per_npu, total

cases = []
for (P, k, o) in [(1000, 64, 1), (2048, 64, 1), (2049, 64, 1), (10000, 64, 1), (50000, 64, 1), (100000, 64, 1), (100000, 128, 1), (40, 64, 1), (64, 64, 1), (65, 64, 1), (20000, 64, 3), (8192, 128, 1)]:
    c = clos(P, k, o, 2)
    exp = {"tiers": c['tiers'], "switches": c['switches'], "links": c['links'], "transceivers": c['transceivers']}
    for i, n in enumerate(c['perTier']):
        exp["tier%d" % (i + 1)] = n
    cases.append({"id": "clos-%d-k%d-o%g" % (P, k, o), "group": "clos", "inputs": {"ports": P, "radix": k, "oversubscription": o, "transceiversPerLink": 2}, "expected": exp})
for tid in TEMPLATES:
    for N in [384, 1000, 8192, 10000, 12345, 20000, 50000, 100000, 200000, 500000]:
        for fill in (['proportional', 'full-pod'] if TEMPLATES[tid]['pod'] else ['proportional']):
            c = counts(tid, N, fill)
            per_npu, total = hard_rates(tid, N, fill)
            exp = {k: v for k, v in c.items()}
            for u, v in per_npu.items():
                exp["hardFitPerNpu." + u] = v
            exp["hardFitPerNpuTotal"] = total * 1e9 / N
            exp["hardPerHour"] = total
            cases.append({"id": "%s-%d-%s" % (tid, N, fill), "group": "template", "inputs": {"template": tid, "npus": N, "fabricFill": fill}, "expected": exp})
# calibration: CloudMatrix384 without scale-out network reproduces the per-card catalog (hard FIT per NPU = 3,333.33)
for N in [384, 3840, 38400, 99840]:  # pod-aligned sizes (whole CloudMatrix384 pods)
    per_npu, total = hard_rates('a3-ub384', N, 'proportional', scale_out=False)
    catalog = sum(e['fit'] for e in EVENTS if e['type'] == 'hard') * N / 1e9
    cases.append({"id": "calibration-%d" % N, "group": "calibration", "inputs": {"npus": N}, "expected": {"hardPerHour": total, "catalogHardPerHour": catalog}, "tolerance": {"rel": 1e-9}})
# per-unit FIT of every fault type (60 = 54 catalog events + 6 RoCE analogues)
for e in EVENTS:
    u = UNIT[e['domainId']]
    cases.append({"id": "fit-%s" % e['id'], "group": "fit", "inputs": {"id": e['id']}, "expected": {"fitPerUnit": e['fit'] * CARDS[u], "cardsPerUnit": CARDS[u]}})
    if e['domainId'] in ROCE:
        r = ROCE[e['domainId']]
        cases.append({"id": "fit-%s@roce" % e['id'], "group": "fit", "inputs": {"id": e['id'] + '@roce'}, "expected": {"fitPerUnit": e['fit'] * CARDS[r], "cardsPerUnit": CARDS[r]}})

with open(os.path.join(HERE, 'golden_v4.json'), 'w') as f:
    json.dump({"generated_by": "compute_golden_v4.py", "cases": cases}, f, indent=1)
print(len(cases), "cases")
for c in cases[:12]:
    print(c['id'], c['expected'])
for c in cases:
    if c['group'] == 'template' and c['inputs']['npus'] in (10000, 100000, 200000, 500000) and c['inputs']['fabricFill'] == 'proportional':
        e = c['expected']
        print(c['id'], {k: (round(v, 1) if isinstance(v, float) else v) for k, v in e.items() if not k.startswith('hardFitPerNpu.')})
