"""
Independent golden vectors for the v6 口径 normaliser (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.4), computed in pure Python
from the written specification — the module header of packages/core/src/ingest/koujing.ts and MODEL_REFERENCE.md §26 — without
reading the TypeScript under test:

    FIT_class,unit = Σ_devices FIT_device × devicesPerUnit × impactFactor_class   (business-impact FIT per unit-hour)
    FIT_device     = λ_device × 1e9, λ from the stated unit:
                       FIT → v / 1e9;  per_1e6_h → v / 1e6;  per_h → v;  mtbf_h → 1 / v;
                       afr → −ln(1 − v) / 8760   (exponential; v / 8760 is the first-order value, reported for the record)

Synthetic inputs (no internal data): device rows and mapping rows are defined here and copied into golden_v6.json so the TypeScript
harness (test/ingest_v6.test.ts) rebuilds exactly these tables. Expected values: FIT per device after the unit conversion and the
per-class sums. Run: python3 packages/core/test/golden/compute_golden_v6.py
"""
import json, math, pathlib

HOURS_PER_YEAR = 8760.0

def lam(value, unit):
    if unit == 'FIT': return value / 1e9
    if unit == 'per_1e6_h': return value / 1e6
    if unit == 'per_h': return value
    if unit == 'mtbf_h': return 1.0 / value
    if unit == 'afr': return -math.log(1.0 - value) / HOURS_PER_YEAR
    raise ValueError(unit)

def fit(value, unit):
    return lam(value, unit) * 1e9

CASES = [
    {
        'id': 'G7a-pass-through',
        'note': 'one device, one per unit, impact 1, stated in FIT: the value passes through unchanged',
        'devices': [{'device': 'DDR5 DIMM', 'value': 30.0, 'unit': 'FIT', 'source': 'FIT-DB', 'sourceType': 'vendor'}],
        'mapping': [{'device': 'DDR5 DIMM', 'unit': 'node', 'class': 'DDR-hard', 'devicesPerUnit': 1, 'impactFactor': 1.0, 'impactBasis': 'none', 'impactConfidence': 'measured'}],
    },
    {
        'id': 'G7b-two-devices-one-class',
        'note': 'FIT and per-10^6-h devices summed into one class with devices per unit and impact factors',
        'devices': [
            {'device': 'DDR5 DIMM', 'value': 30.0, 'unit': 'FIT', 'source': 'FIT-DB', 'sourceType': 'vendor'},
            {'device': 'VRM', 'value': 0.02, 'unit': 'per_1e6_h', 'source': 'FIT-DB', 'sourceType': 'prediction'},
        ],
        'mapping': [
            {'device': 'DDR5 DIMM', 'unit': 'node', 'class': 'DDR-hard', 'devicesPerUnit': 8, 'impactFactor': 0.5, 'impactBasis': 'field ratio', 'impactConfidence': 'derived'},
            {'device': 'VRM', 'unit': 'node', 'class': 'DDR-hard', 'devicesPerUnit': 2, 'impactFactor': 0.25, 'impactBasis': 'FMEA', 'impactConfidence': 'assumed'},
        ],
    },
    {
        'id': 'G7c-afr-and-mtbf',
        'note': 'annual failure fraction (exponential conversion) and MTBF hours, two classes on two units',
        'devices': [
            {'device': 'NVMe SSD', 'value': 0.0144, 'unit': 'afr', 'source': 'field returns', 'sourceType': 'field'},
            {'device': 'PSU 3kW', 'value': 2.0e6, 'unit': 'mtbf_h', 'source': 'PSU datasheet', 'sourceType': 'vendor'},
        ],
        'mapping': [
            {'device': 'NVMe SSD', 'unit': 'node', 'class': 'SSD-hard', 'devicesPerUnit': 2, 'impactFactor': 0.9, 'impactBasis': 'field ratio', 'impactConfidence': 'measured'},
            {'device': 'PSU 3kW', 'unit': 'cabinet', 'class': 'POWER-hard', 'devicesPerUnit': 2, 'impactFactor': 0.1, 'impactBasis': 'N+1, double fault', 'impactConfidence': 'derived'},
        ],
    },
    {
        'id': 'G7d-one-device-two-classes',
        'note': 'one device feeding a hard and a slow class (classes stay apart, each its own sum); per-hour unit',
        'devices': [{'device': 'UB optical module', 'value': 1.2e-7, 'unit': 'per_h', 'source': 'optics vendor', 'sourceType': 'vendor'}],
        'mapping': [
            {'device': 'UB optical module', 'unit': 'ub-link', 'class': 'OPT-hard', 'devicesPerUnit': 2, 'impactFactor': 0.3, 'impactBasis': 'link-level retry absorbs 70 %', 'impactConfidence': 'derived'},
            {'device': 'UB optical module', 'unit': 'ub-link', 'class': 'OPT-slow', 'devicesPerUnit': 2, 'impactFactor': 0.6, 'impactBasis': 'degraded links from field', 'impactConfidence': 'derived'},
        ],
    },
    {
        'id': 'G7e-many-devices',
        'note': 'five devices of mixed units into three classes',
        'devices': [
            {'device': 'HBM stack', 'value': 12.5, 'unit': 'FIT', 'source': 'vendor', 'sourceType': 'vendor'},
            {'device': 'NPU die', 'value': 0.35, 'unit': 'per_1e6_h', 'source': 'prediction', 'sourceType': 'prediction'},
            {'device': 'CPU', 'value': 1.5e6, 'unit': 'mtbf_h', 'source': 'vendor', 'sourceType': 'vendor'},
            {'device': 'Fan', 'value': 0.03, 'unit': 'afr', 'source': 'field', 'sourceType': 'field'},
            {'device': 'Rack PDU', 'value': 4.0e-7, 'unit': 'per_h', 'source': 'field', 'sourceType': 'field'},
        ],
        'mapping': [
            {'device': 'HBM stack', 'unit': 'npu', 'class': 'MEMP-hard', 'devicesPerUnit': 8, 'impactFactor': 0.2, 'impactBasis': 'ECC', 'impactConfidence': 'derived'},
            {'device': 'NPU die', 'unit': 'npu', 'class': 'CORE-hard', 'devicesPerUnit': 1, 'impactFactor': 1.0, 'impactBasis': 'none', 'impactConfidence': 'measured'},
            {'device': 'CPU', 'unit': 'cpu', 'class': 'CPU-hard', 'devicesPerUnit': 1, 'impactFactor': 0.8, 'impactBasis': 'field', 'impactConfidence': 'derived'},
            {'device': 'Fan', 'unit': 'cabinet', 'class': 'COOL-hard', 'devicesPerUnit': 12, 'impactFactor': 0.05, 'impactBasis': 'N+2 fans', 'impactConfidence': 'derived'},
            {'device': 'Rack PDU', 'unit': 'cabinet', 'class': 'POWER-hard', 'devicesPerUnit': 2, 'impactFactor': 0.5, 'impactBasis': 'dual feed', 'impactConfidence': 'derived'},
        ],
    },
]

out = {'generated_by': 'compute_golden_v6.py (pure Python, independent of the TypeScript)', 'hours_per_year': HOURS_PER_YEAR, 'cases': []}
for c in CASES:
    dev_fit = {d['device']: fit(d['value'], d['unit']) for d in c['devices']}
    cls = {}
    for m in c['mapping']:
        cls[m['class']] = cls.get(m['class'], 0.0) + dev_fit[m['device']] * m['devicesPerUnit'] * m['impactFactor']
    first_order = {d['device']: d['value'] / HOURS_PER_YEAR * 1e9 for d in c['devices'] if d['unit'] == 'afr'}
    out['cases'].append({'id': c['id'], 'note': c['note'], 'inputs': {'devices': c['devices'], 'mapping': c['mapping']},
                         'expected': {'deviceFit': dev_fit, 'classFit': cls, 'afrFirstOrderFit': first_order}})

path = pathlib.Path(__file__).with_name('golden_v6.json')
path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
print('wrote', path, 'cases', len(out['cases']))
for c in out['cases']:
    print(' ', c['id'], {k: round(v, 6) for k, v in c['expected']['classFit'].items()})
