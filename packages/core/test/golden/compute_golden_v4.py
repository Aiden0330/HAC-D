"""
Independent golden vectors for the v4 topology templates (docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2), computed from the
specification without reading the TypeScript engine:
  * folded Clos counts: leaf down ports d = floor(k*o/(1+o)); t tiers carry d*k*(k/2)^(t-2) ports (one switch when P <= k);
    tier 1 = ceil(P/d), middle tiers ceil(H/(k/2)), top tier ceil(H/k), H = ceil(P/o); links = P + (t-1)*H;
  * template hardware counts at the built-in 10k / 100k / 200k / 500k NPUs and at 384 / 1k / 8,192 / 12,345 / 20k / 50k
    (and pod-aligned sizes): nodes, CPUs, cabinets, SuperPoDs,
  * v4.2 mesh and blade UB fabrics (docs: SuperpodSchema.fabric): Atlas 950 'mesh-clos' (2D full mesh of t trays × p NPUs per
    cabinet = t·C(p,2) + p·C(t,2) direct links, 72 low-radix switches per cabinet, u optical links per NPU into pod switches of
    radix r: ⌈pod NPUs·u / r⌉ per pod), the UB-Mesh paper 'mesh-4d' (plus cabinet pairs sharing a row or column of a g × g grid),
    Atlas 960E 'blade-clos' (LinkBlade chips per cabinet, LinkDevices ⌈pod NPUs × 5.5 / 176⌉, NPO engines and 800G-equivalent
    links per NPU); scale-out split over independent planes (each a Clos over ⌈NPUs × ports / planes⌉ ports);
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
# v4.2 Atlas 950 as shipped: 16 + 4 cabinets, 8 trays × 8 NPUs and 16 CPUs per cabinet, mesh-clos (72 LRS per cabinet, 2 × 800G per NPU, 128-port pod switches)
A950_1K = dict(fabric='mesh-clos', npn=8, cpn=2, npr=8, crk=16, comm=4, rsw=72, up=2, radix=128, tpl=2, opt=None, eng=0.0, grid=4, backup=0)
A950_8K = dict(A950_1K, crk=128, comm=32)
A950_4D = dict(A950_8K, fabric='mesh-4d', up=0.5, radix=64)
A950_2L = dict(fabric='two-level', npn=8, cpn=2, npr=8, crk=16, comm=4, l1=7, sub=7, l2ps=math.ceil(128 * 16 / 48), l2p=48, lpl1=16, tpl=2)
# v4.2 Atlas 960E: 56 + 14 cabinets of 9 blades × 8 NPUs and 18 CPUs, 5 LinkBlade chips per cabinet, 5.5 LinkDevice ports per NPU (radix 176), NPO
A960E = dict(fabric='blade-clos', npn=8, cpn=2, npr=9, crk=56, comm=14, rsw=5, up=5.5, radix=176, tpl=0, opt=48000 / 2 / 4096, eng=5500 / 4096, grid=0, backup=0)
TEMPLATES = {
    'a2-roce': dict(npn=8, cpn=4, npr=8, pod=None, so=dict(ports=1, planes=1, k=64, o=1, tpl=2)),
    'a3-ub384': dict(npn=8, cpn=4, npr=4, pod=CM384, so=dict(ports=2, planes=1, k=64, o=1, tpl=2)),
    'a950-ub2': dict(npn=8, cpn=2, npr=8, pod=A950_1K, so=dict(ports=2, planes=2, k=128, o=1, tpl=2)),
    'a960e-ub': dict(npn=8, cpn=2, npr=9, pod=A960E, so=dict(ports=4, planes=4, k=1024, o=1, tpl=2)),
}
# superpod variants of the Atlas 950 template (the scenario's topology.superpod replaced by the preset with these fields)
VARIANTS = {
    'a950-8k': ('a950-ub2', A950_8K, dict(preset='atlas950-8k')),
    'a950-4d': ('a950-ub2', A950_4D, dict(preset='atlas950-8k', fabric='mesh-4d', podUplinksPerNpu=0.5, podSwitchRadix=64)),
    'a950-2l': ('a950-ub2', A950_2L, dict(preset='atlas950-1k', fabric='two-level')),
}

def mesh_links(t, p):
    return t * p * (p - 1) // 2 + p * t * (t - 1) // 2

def grid_pairs(r, g):
    if g <= 1 or r <= 1:
        return 0
    full_rows, last = divmod(r, g)
    pairs = full_rows * g * (g - 1) // 2 + last * (last - 1) // 2
    for j in range(g):
        n = full_rows + (1 if j < last else 0)
        pairs += n * (n - 1) // 2
    return pairs

def counts(tid, N, fill='proportional', scale_out=True, pod=None):
    T = TEMPLATES[tid]
    p = pod or T['pod']
    npn, npr, cpn = (p['npn'], p['npr'], p['cpn']) if p else (T['npn'], T['npr'], T['cpn'])
    nodes = math.ceil(N / npn)
    cabinets = math.ceil(nodes / npr)
    out = {"npus": N, "nodes": nodes, "cpus": nodes * cpn, "cabinets": cabinets}
    if p and p.get('fabric', 'two-level') != 'two-level':
        npp = p['npr'] * p['crk']
        pods = max(1, math.ceil(nodes / npp))
        full, rem = divmod(nodes, npp)
        npus = nodes * p['npn']
        sw_for = lambda n: math.ceil(n * p['npn'] * p['up'] / p['radix'])
        per_pod = sw_for(npp)
        if fill == 'proportional':
            rem_sw = min(per_pod, sw_for(rem)) if rem > 0 else 0
            pod_sw = full * per_pod + rem_sw
            comm = full * p['comm'] + (min(p['comm'], math.ceil(rem_sw * p['comm'] / per_pod)) if rem > 0 else 0)
        else:
            pod_sw = pods * per_pod
            comm = pods * p['comm']
        full_cab, last = divmod(nodes, p['npr'])
        mesh = 0 if p['fabric'] == 'blade-clos' else full_cab * mesh_links(p['npr'], p['npn']) + (mesh_links(last, p['npn']) if last else 0)
        rack_mesh = 0
        if p['fabric'] == 'mesh-4d' and p['grid'] > 1:
            gg = p['grid'] * p['grid']
            fg, lr = divmod(cabinets, gg)
            rack_mesh = fg * grid_pairs(gg, p['grid']) + grid_pairs(lr, p['grid'])
        # NPO fields belong to blade-clos only: 800G-equivalent links and engines, no pluggable transceivers
        blade = p['fabric'] == 'blade-clos'
        opt = math.ceil(npus * (p['opt'] if blade and p['opt'] is not None else p['up']))
        rack_sw = cabinets * p['rsw']
        out.update({"pods": pods, "commCabinets": comm, "l1": 0, "l2": 0, "ubLinks": opt, "ubTransceivers": 0 if blade else opt * p['tpl'],
                    "rackSwitches": rack_sw, "podSwitches": pod_sw, "meshLinks": mesh, "rackMeshLinks": rack_mesh,
                    "opticalEngines": math.ceil(npus * p['eng']) if blade else 0, "ubSwitches": rack_sw + pod_sw})
    elif p:
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
        pl = so['planes']
        c = clos(N * so['ports'] / pl, so['k'], so['o'], so['tpl'])
        out.update({"roPorts": math.ceil(N * so['ports'] / pl) * pl, "roTiers": c['tiers'], "roSwitches": c['switches'] * pl, "roLinks": c['links'] * pl})
        for i, n in enumerate(c['perTier']):
            out["roTier%d" % (i + 1)] = n * pl
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

def hard_rates(tid, N, fill='proportional', scale_out=True, pod=None):
    c = counts(tid, N, fill, scale_out, pod)
    f = hard_fit_per_unit()
    unit_count = {"npu": N, "job": N, "cpu": c['cpus'], "node": c['nodes'], "cabinet": c['cabinets']}
    if TEMPLATES[tid]['pod']:
        unit_count["ub-switch"] = c['ubSwitches'] if 'ubSwitches' in c else c['l1'] + c['l2']
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
            exp.pop('ubSwitches', None)
            cases.append({"id": "%s-%d-%s" % (tid, N, fill), "group": "template", "inputs": {"template": tid, "npus": N, "fabricFill": fill}, "expected": exp})
# v4.2 Atlas 950 superpod variants: the 8,192-NPU roadmap pod, the UB-Mesh paper's 4D mesh, the CloudMatrix384-style two-level copy; 960E pod sizes
VAR_SIZES = {'a950-8k': [8192, 10000, 100000, 500000, 524288], 'a950-4d': [1024, 8192, 20000, 100000, 500000], 'a950-2l': [1024, 10000, 100000]}
for vid, (tid, pod, sp_over) in VARIANTS.items():
    for N in VAR_SIZES[vid]:
        for fill in ['proportional', 'full-pod']:
            c = counts(tid, N, fill, True, pod)
            per_npu, total = hard_rates(tid, N, fill, True, pod)
            exp = dict(c)
            exp.pop('ubSwitches', None)
            for u, v in per_npu.items():
                exp["hardFitPerNpu." + u] = v
            exp["hardFitPerNpuTotal"] = total * 1e9 / N
            exp["hardPerHour"] = total
            cases.append({"id": "%s-%d-%s" % (vid, N, fill), "group": "template", "inputs": {"template": tid, "npus": N, "fabricFill": fill, "superpod": sp_over}, "expected": exp})
for N in [4032, 4096, 8064]:
    for fill in ['proportional', 'full-pod']:
        c = counts('a960e-ub', N, fill)
        per_npu, total = hard_rates('a960e-ub', N, fill)
        exp = dict(c); exp.pop('ubSwitches', None)
        for u, v in per_npu.items():
            exp["hardFitPerNpu." + u] = v
        exp["hardFitPerNpuTotal"] = total * 1e9 / N
        exp["hardPerHour"] = total
        cases.append({"id": "a960e-ub-%d-%s" % (N, fill), "group": "template", "inputs": {"template": 'a960e-ub', "npus": N, "fabricFill": fill}, "expected": exp})
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
