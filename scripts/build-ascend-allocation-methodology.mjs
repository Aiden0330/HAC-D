#!/usr/bin/env node
/**
 * Build docs/ASCEND_ALLOCATION_METHODOLOGY.html — the Methodology volume of the Ascend allocation report set. Thin wrapper: the page
 * is rendered by methodologyHtml in @hac-d/reports (packages/reports/src/methodology.mjs, prose in content.mjs).
 * Data: docs/backup/ascend-allocation/{results,mechanisms}.json.
 * Usage: node scripts/build-ascend-allocation-methodology.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { methodologyHtml } from '@hac-d/reports';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const provenance = existsSync('docs/backup/ascend-allocation/provenance.json') ? json('docs/backup/ascend-allocation/provenance.json') : undefined; // the hacd run's footer provenance, when stored
const html = methodologyHtml({ results: json('docs/backup/ascend-allocation/results.json'), mechanisms: json('docs/backup/ascend-allocation/mechanisms.json'), provenance });
writeFileSync('docs/ASCEND_ALLOCATION_METHODOLOGY.html', html);
console.log(`written docs/ASCEND_ALLOCATION_METHODOLOGY.html (${(html.length / 1024).toFixed(0)} kB)`);
