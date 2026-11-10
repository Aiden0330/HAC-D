/**
 * Writes packages/core/data/fault-rates/field-llama3-2026-11.json — the field-level case of the report set (tool review
 * 2026-11-09, recommendation 3): the hard-interruption total of a measured synchronous training cluster spread over the 18
 * interruption classes in the proportions of the audited catalog. Run from the repository root:
 *   node scripts/build-field-rates.mjs
 * Total: 419 unplanned job interruptions in 54 days on 16,384 GPUs (the Llama 3 report, library record
 * gpu.interruption_rate.llama3_h100; survey Table 3-2) = 1 per 50,676 GPU-hours = 19,733 events per 10⁹ card-hours, against the
 * catalog's 3,333.3 (its anchor: 30 h between hard interruptions at 10,000 cards, fixed by the user). Only the interruption
 * classes are in the record; the sub-health and silent-corruption classes keep the catalog's values (no field anchor).
 */
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = 'packages/core/data/fault-rates';
const cat = JSON.parse(readFileSync(`${DIR}/remap-per-card-2026-10-09.json`, 'utf8'));
const INTERRUPTIONS = 419, DAYS = 54, GPUS = 16384;
const fieldFit = (INTERRUPTIONS / (DAYS * 24 * GPUS)) * 1e9;
const hard = Object.entries(cat.rates).filter(([id]) => id.endsWith('-hard'));
const catalogFit = hard.reduce((a, [, r]) => a + r.fit, 0);
const factor = fieldFit / catalogFit;
const SRC = `field total of the Llama 3 training cluster (${INTERRUPTIONS} unplanned job interruptions in ${DAYS} days on ${GPUS.toLocaleString('en-US')} GPUs, arXiv 2407.21783; HAC-D library record gpu.interruption_rate.llama3_h100) spread over the classes in the proportions of the ${cat.id} catalog`;
const rates = Object.fromEntries(hard.map(([id, r]) => [id, {
  unit: r.unit, fit: r.fit * factor, source: SRC, confidence: 'assumed',
  derivation: `catalog ${id}: ${r.fit.toFixed(3)} FIT per card-hour × ${factor.toFixed(4)} (${fieldFit.toFixed(1)} / ${catalogFit.toFixed(1)} FIT per card-hour, field total / catalog total)`,
  note: 'the total is derived from a published count; the split over the classes and the transfer to another platform are assumptions',
}]));
const out = {
  id: 'field-llama3-2026-11',
  basis: 'per-card',
  source: `field-level case (tool review 2026-11-09): ${SRC}; interruption classes only — sub-health and silent-corruption classes keep the catalog's values`,
  catalog: {
    rateBasis: { zh: '每十亿卡·小时的作业非计划中断（同步训练，实测总量）；类别间比例取审核目录', en: 'unplanned job interruptions per 10⁹ card-hours (synchronous training, measured total); the split over the classes is the audited catalog’s' },
    anchor: { referenceCards: GPUS, hardMtbfHours: (DAYS * 24) / INTERRUPTIONS, classFit: { hard: fieldFit }, note: `${INTERRUPTIONS} interruptions / (${DAYS} × 24 h × ${GPUS} GPUs); the catalog's own anchor is ${cat.catalog.anchor.hardMtbfHours} h at ${cat.catalog.anchor.referenceCards.toLocaleString('en-US')} cards; factor ${factor.toFixed(4)} on every interruption class` },
    confidenceNote: 'a bound, not a measurement of this hardware: the event is a job interruption of a GPU cluster of another vendor (about 78 % hardware by the source); every class is tagged assumed',
  },
  rates,
  analogues: Object.fromEntries(Object.entries(cat.analogues ?? {}).filter(([k]) => k.includes('-hard'))),
};
writeFileSync(`${DIR}/${out.id}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(`${DIR}/${out.id}.json: ${hard.length} classes, field ${fieldFit.toFixed(1)} FIT per card-hour, catalog ${catalogFit.toFixed(1)}, factor ${factor.toFixed(4)}`);
