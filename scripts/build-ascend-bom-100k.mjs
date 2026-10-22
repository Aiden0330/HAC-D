#!/usr/bin/env node
/**
 * Build docs/ASCEND_BOM_100K.html — the hardware component counts of the alternative topology designs of a 100,000-NPU Ascend
 * cluster. Thin wrapper: the page is rendered by bomHtml in @hac-d/reports (packages/reports/src/bom.mjs).
 * Input: docs/backup/ascend-allocation/bom.json (written by scripts/ascend-bom-100k.ts from HAC-D's topologyBom).
 * Usage: node scripts/build-ascend-bom-100k.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { bomHtml } from '@hac-d/reports';

const provenance = existsSync('docs/backup/ascend-allocation/bom-provenance.json') ? JSON.parse(readFileSync('docs/backup/ascend-allocation/bom-provenance.json', 'utf8')) : undefined; // the hacd bom run's footer provenance, when stored
const html = bomHtml({ bom: JSON.parse(readFileSync('docs/backup/ascend-allocation/bom.json', 'utf8')), provenance });
writeFileSync('docs/ASCEND_BOM_100K.html', html);
console.log('wrote docs/ASCEND_BOM_100K.html', (html.length / 1024).toFixed(0), 'KiB');
