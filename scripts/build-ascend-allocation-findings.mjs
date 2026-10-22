#!/usr/bin/env node
/**
 * Build docs/ASCEND_ALLOCATION_FINDINGS_{950,UBL128,CM384,A3SERVER}.html — the Findings volume of the Ascend allocation report set,
 * one file per topology. Thin wrapper: the page is rendered by findingsHtml in @hac-d/reports (packages/reports/src/findings.mjs).
 * Inputs: docs/backup/ascend-allocation/results.json, docs/backup/ascend-allocation/mechanisms.json,
 * docs/backup/arch-mechanism-shapley/<arch>.json.
 * Usage: node scripts/build-ascend-allocation-findings.mjs [native950|ubl128|cm384|a3server …]   (no args = all four)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { findingsHtml, FINDINGS_FILES } from '@hac-d/reports';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const results = json('docs/backup/ascend-allocation/results.json');
const mechanisms = json('docs/backup/ascend-allocation/mechanisms.json');
// the provenance the hacd run stored next to the data (footer); absent → the recipe's generic footer
const provenance = existsSync('docs/backup/ascend-allocation/provenance.json') ? json('docs/backup/ascend-allocation/provenance.json') : undefined;

const want = process.argv.slice(2);
for (const arch of want.length ? want : Object.keys(FINDINGS_FILES)) {
  if (!results.archs[arch]) throw new Error(`unknown arch ${arch}`);
  const html = findingsHtml(arch, { results, mechanisms, shapley: json(`docs/backup/arch-mechanism-shapley/${arch}.json`), provenance });
  const out = `docs/ASCEND_ALLOCATION_FINDINGS_${FINDINGS_FILES[arch]}.html`;
  writeFileSync(out, html);
  console.log('written', `${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
