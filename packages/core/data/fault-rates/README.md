# Failure-rate overrides (`FaultRateOverride`, packages/core/src/records/faultRates.ts)

Each file is a static JSON record validated by `FaultRateOverrideSchema` and applied with `applyFaultRates(scenario, override)`.
FIT = business-impact events per 10⁹ unit-hours (`basis: "per-unit"`) or card-hours (`basis: "per-card"`, converted × cards per
unit of the class's unit in the CloudMatrix384 geometry, as `unitFaultLibrary` does). Every entry carries `source` and `confidence`.

## remap-per-card-2026-10-09.json

The 54 events of the ai-cluster-reliability audited catalog (review-2026-10-09, `REFERENCE_EVENTS`) per card-hour, confidence
`assumed` (as the unit library), with the six `@roce` classes taking their UB analogue. Applied to
`topologyScenario('a3-ub384', N, { scaleOut: false, mechanisms: [] })` it reproduces `referenceCatalog(N)`
(packages/core/test/records.test.ts). Regenerate it (only if the catalog changes) from the repository root:

```sh
node --import tsx --input-type=module -e "
import { writeFileSync } from 'node:fs';
const { REFERENCE_EVENTS } = await import('./packages/core/src/scenario/referenceEvents.ts');
const { DOMAIN_UNIT } = await import('./packages/core/src/topology/index.ts');
const SRC = 'ai-cluster-reliability audited catalog (review-2026-10-09)';
const rates = {}, analogues = {};
for (const e of REFERENCE_EVENTS) {
  rates[e.id] = { unit: DOMAIN_UNIT[e.domainId], fit: e.fit, source: SRC, confidence: 'assumed' };
  if (e.domainId === 'FABRIC' || e.domainId === 'OPT') analogues[e.id + '@roce'] = e.id;
}
const out = { id: 'remap-per-card-2026-10-09', basis: 'per-card', source: SRC + ', revision event-budget-v3-sdc1.4-reviewed-85: 54 events = 18 hardware domains × {interruption, sub-health, silent}, business-impact FIT per card-hour (the ReMAP / reference basis); RoCE switches and links take the UB analogues', rates, analogues };
writeFileSync('packages/core/data/fault-rates/remap-per-card-2026-10-09.json', JSON.stringify(out, null, 2) + '\n');
"
```

### Reconciliation 2026-10-21 (v5)

The 54 values were checked against `remap/remap-latest/references/expert-review-2026-10-09/inputs.json` (revision
`event-budget-v3-sdc1.4-reviewed-85`, sha256 in `catalog`): all equal to 1e-9. Each entry now carries the catalog's own evidence
labels in `note` (legacy `fitEvidence` / `evidence` / `status`, zh), and the file-level `catalog` block records the rate basis
(business-impact events per 10⁹ NPU-equivalent exposure hours, not device FIT), the anchor (10,000 cards ↔ 30 h hard MTBF, class
totals 3,333.3 / 69.0 / 48.3 FIT per card) and why every value stays `assumed`: the catalog labels each one a prior pending audit
or a user modelling assumption. The regeneration command above produces the values; the notes and the `catalog` block were added by
the reconciliation script of that date (see `docs/markdown/V5_PARAMETER_RECONCILIATION.md`).
