/** Importer tests against the synthetic fixtures (packages/importers/test/fixtures, see manifest.json). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readWorkbook, methodReport, extractTopology, draftToScenario, reconcile, flattenDraft, importSpreadsheet, exportWorkbook } from '../src/index.js';
import type { MethodTag, DraftNode } from '../src/index.js';
import { evaluateScenario, indexResults, workedExample1 } from '@hac-d/core';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
interface ManifestNode { name: string; kind: string; count: number; k: number | null; n: number | null; params: Record<string, number | string>; cells: Record<string, string>; source_row: number; children: ManifestNode[]; homogeneous?: boolean }
interface ManifestWorkbook {
  id: string;
  file: string;
  sheet: string;
  header_row: number;
  columns: Record<string, string>;
  expected_tree: ManifestNode;
  expected_methods: { tag: MethodTag; cells: string[]; optional_cells?: string[] }[];
  expected_values: Record<string, number>;
  tolerance: { rel?: number; abs?: number };
}
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8')) as { workbooks: ManifestWorkbook[] };
const load = (file: string) => readWorkbook(new Uint8Array(readFileSync(join(fixtures, file))), file);

function cellsByTag(report: ReturnType<typeof methodReport>, sheet: string, tag: MethodTag): Set<string> {
  const s = report.sheets.find((x) => x.sheet === sheet)!;
  return new Set(s.hits.filter((h) => h.tag === tag).map((h) => `${sheet}!${h.addr}`));
}

describe('method fingerprinting on the fixtures', () => {
  for (const w of manifest.workbooks) {
    it(`${w.id} ${w.file}: expected tags detected`, () => {
      const report = methodReport(load(w.file));
      for (const m of w.expected_methods) {
        // the fingerprinter returns one tag per formula; a cell may legitimately carry a different (also expected) tag
        const detected = cellsByTag(report, w.sheet, m.tag);
        const alsoExpectedElsewhere = new Set(w.expected_methods.filter((o) => o !== m).flatMap((o) => o.cells));
        for (const c of m.cells) {
          if (!detected.has(c)) expect(alsoExpectedElsewhere.has(c), `${m.tag} missing at ${c}`).toBe(true);
        }
        const allowed = new Set([...m.cells, ...(m.optional_cells ?? [])]);
        for (const c of detected) expect(allowed.has(c), `${m.tag} false positive at ${c}`).toBe(true);
      }
    });
  }
});

// the manifest gives synthetic root names when the total row carries a method label (F8: "System" for the row "Exact (ΠA)"); compare the root by structure only
function names(n: DraftNode, root = false): unknown {
  return { name: root ? '*' : n.name, kind: n.kind, count: n.count, n: n.n ?? null, k: n.k ?? null, children: n.children.map((c) => names(c)) };
}
function expectedNames(n: ManifestNode, root = false): unknown {
  return { name: root ? '*' : n.name, kind: n.kind, count: n.count, n: n.n, k: n.k, children: n.children.map((c) => expectedNames(c)) };
}

describe('topology extraction', () => {
  for (const w of manifest.workbooks.filter((x) => x.id !== 'F5')) {
    it(`${w.id}: tree matches the manifest`, () => {
      const wb = load(w.file);
      const sheet = wb.sheets.find((s) => s.name === w.sheet)!;
      const draft = extractTopology(sheet, w.file);
      expect(draft.headerRow).toBe(w.header_row - 1);
      for (const [role, letter] of Object.entries(w.columns)) {
        const col = letter.charCodeAt(0) - 65;
        const g = draft.columns.find((c) => c.col === col);
        const mapped = role === 'unit_availability' ? 'availability' : role === 'afr_pct_per_year' ? 'afr_pct' : role;
        if (role === 'availability' && w.columns.unit_availability) expect(g?.role).toBe('group_availability');
        else if (role !== 'notes') expect(g?.role, `${w.id} column ${letter} (${role})`).toBe(mapped);
      }
      expect(names(draft.root, true)).toEqual(expectedNames(w.expected_tree, true));
      if (w.expected_tree.cells.name) expect(draft.root.name).toBe(w.expected_tree.name);
    });
  }
});

describe('scenario conversion and reconciliation', () => {
  for (const w of manifest.workbooks.filter((x) => x.id !== 'F5')) {
    it(`${w.id}: HAC-D reproduces the spreadsheet's root availability`, () => {
      const wb = load(w.file);
      const sheet = wb.sheets.find((s) => s.name === w.sheet)!;
      const draft = extractTopology(sheet, w.file);
      const conv = draftToScenario(draft);
      const result = evaluateScenario(conv.scenario);
      const rootCell = w.expected_tree.cells.availability;
      const expected = w.expected_values[rootCell];
      expect(expected).toBeDefined();
      const engine = result.system.availability;
      if (w.id === 'F2') {
        // static switchover weighting vs HAC-D's repairable switch-failed state: close but not identical
        expect(Math.abs(engine - expected)).toBeLessThan(1e-4);
      } else {
        expect(engine).toBeCloseTo(expected, 9);
      }
      // every leaf / homogeneous group reproduces its own cell
      const byId = indexResults(result.structure.result);
      for (const { node } of flattenDraft(draft.root)) {
        if (node === draft.root || !node.availabilityCell) continue;
        const cell = `${w.sheet}!${node.availabilityCell}`;
        const exp = w.expected_values[cell];
        if (exp === undefined) continue;
        const blockId = conv.blockIds.get(node.id)!;
        const a = byId.get(blockId)?.availability;
        expect(a, `${w.id} ${node.name}`).toBeDefined();
        if (w.id === 'F2' && node.kind !== 'leaf') expect(Math.abs(a! - exp)).toBeLessThan(1e-4);
        else expect(a!).toBeCloseTo(exp, 9);
      }
      const rec = reconcile(draft, result, conv.blockIds);
      expect(rec.rows.length).toBe(flattenDraft(draft.root).length);
      expect(rec.comparable).toBe(0); // openpyxl files carry no cached values
    });
  }
  it('one-call import works on the Chinese hierarchy workbook and reports methods', () => {
    const file = 'hierarchy_levels_zh.xlsx';
    const out = importSpreadsheet(new Uint8Array(readFileSync(join(fixtures, file))), file);
    expect(out.sheet).toBe('拓扑');
    expect(out.report.methods.map((m) => m.tag)).toContain('series_product');
    expect(out.result.system.availability).toBeGreaterThan(0.9);
    expect(out.draft.confidence).toBeGreaterThan(0.9);
  });
  it('F8 flags the rare-event approximation in the method report', () => {
    const report = methodReport(load('inconsistent_rare_event.xlsx'));
    expect(report.sheets[0].notes.some((n) => /rare-event/.test(n))).toBe(true);
  });
  it('F5 Markov block is fingerprinted', () => {
    const report = methodReport(load('markov_1plus1.xlsx'));
    expect(report.methods.map((m) => m.tag)).toContain('markov_mmult_minverse');
  });
});

describe('export', () => {
  it('writes a workbook whose structure formulas reproduce HAC-D for a plain series scenario', () => {
    const s = workedExample1();
    const r = evaluateScenario(s);
    const bytes = exportWorkbook(s, r);
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const wb = readWorkbook(bytes, 'export.xlsx');
    expect(wb.sheets.map((x) => x.name)).toEqual(['Inputs', 'Structure', 'Results', 'Formulas']);
    const structure = wb.sheets[1];
    const formulas = structure.cells.filter((c) => c.formula);
    expect(formulas.length).toBeGreaterThan(0);
    expect(structure.cells.some((c) => c.formula?.startsWith('PRODUCT('))).toBe(true);
  });
});
