#!/usr/bin/env node
/**
 * Relocation check of v5 T10: render the six Ascend allocation reports with the @hac-d/reports recipes from the data files in
 * docs/backup/… and compare them byte-for-byte (as utf8 strings) with the committed docs/*.html. Paths are resolved from this file,
 * not from the working directory.
 * Usage: node packages/reports/test/reproduce.mjs   (prints OK / the first differing line per file; exit code 1 on any mismatch)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findingsHtml, methodologyHtml, bomHtml, FINDINGS_FILES } from '../src/index.mjs';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
// v5.8 line endings normalised: a Windows checkout with core.autocrlf has CRLF pages (.gitattributes now asks for LF on checkout)
const read = (rel) => readFileSync(REPO + rel, 'utf8').replace(/\r\n/g, '\n');
const json = (rel) => JSON.parse(read(rel));
const maybe = (rel) => (existsSync(REPO + rel) ? json(rel) : undefined);

/** the six reports: [docs file, render()] — rendered with the provenance the hacd run stored next to the data (v5 footers) */
export function cases() {
  const DATA = 'docs/backup/ascend-allocation/';
  const results = json(`${DATA}results.json`);
  const mechanisms = json(`${DATA}mechanisms.json`);
  const provenance = maybe(`${DATA}provenance.json`), bomProvenance = maybe(`${DATA}bom-provenance.json`);
  // v6.3 the records as resolved by the hacd run (Figure 1 of the Findings pages is drawn from them)
  const records = maybe(`${DATA}records.json`) ?? {};
  const studyDir = mechanisms.source?.dir ? `${mechanisms.source.dir.replace(/\/$/, '')}/` : 'docs/backup/arch-mechanism-shapley/';
  const study = (arch) => (existsSync(REPO + `${DATA}${arch}.json`) ? json(`${DATA}${arch}.json`) : json(`${studyDir}${arch}.json`));
  return [
    ...Object.entries(FINDINGS_FILES).map(([arch, suffix]) => [`docs/ASCEND_ALLOCATION_FINDINGS_${suffix}.html`, () => findingsHtml(arch, { results, mechanisms, shapley: study(arch), record: records[arch], provenance })]),
    ['docs/ASCEND_ALLOCATION_METHODOLOGY.html', () => methodologyHtml({ results, mechanisms, provenance })],
    ['docs/ASCEND_BOM_100K.html', () => bomHtml({ bom: json(`${DATA}bom.json`), provenance: bomProvenance })],
  ];
}

/** null when equal, else a description of the first differing line */
export function firstDiff(got, want) {
  if (got === want) return null;
  const a = got.split('\n'), b = want.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const clip = (s) => (s === undefined ? '<end of file>' : s.length > 300 ? `${s.slice(0, 300)} …` : s);
  return `first difference at line ${i + 1} (rendered ${a.length} lines, file ${b.length} lines)\n  rendered: ${clip(a[i])}\n  file:     ${clip(b[i])}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let bad = 0;
  for (const [file, render] of cases()) {
    const d = firstDiff(render(), read(file));
    if (d) bad++;
    console.log(d ? `DIFF ${file}: ${d}` : `OK   ${file}`);
  }
  process.exit(bad ? 1 : 0);
}
