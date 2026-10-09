/**
 * Export a HAC-D scenario and its evaluation as a workbook with live formulas (audit in Excel):
 * Inputs (components, E[R] and unit availability formulas), Structure (block tree with the
 * combination formula of every block next to HAC-D's value), Results (measures, waterfall), Formulas.
 */
import * as XLSX from 'xlsx';
import { listBlocks, indexResults, compensationWaterfall, type Block, type EvaluationResult, type Scenario } from '@hac-d/core';

type Row = (string | number | null | { f: string } | { v: number; z?: string })[];

function sheetFromRows(rows: Row[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      maxC = Math.max(maxC, c);
      const addr = XLSX.utils.encode_cell({ r, c });
      if (cell === null || cell === undefined) return;
      if (typeof cell === 'object' && 'f' in cell) ws[addr] = { t: 'n', f: cell.f };
      else if (typeof cell === 'object') ws[addr] = { t: 'n', v: cell.v, z: cell.z };
      else if (typeof cell === 'number') ws[addr] = { t: 'n', v: cell };
      else ws[addr] = { t: 's', v: cell };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: maxC } });
  ws['!cols'] = Array.from({ length: maxC + 1 }, (_, i) => ({ wch: i === 0 ? 28 : 14 }));
  return ws;
}

const col = (c: number) => XLSX.utils.encode_col(c);

/** plain decimal literal for a formula (no exponent notation: some evaluators mis-parse `1e-5`) */
function lit(x: number): string {
  if (!Number.isFinite(x)) return '0';
  if (x === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const decimals = Math.min(30, Math.max(0, 15 - mag));
  return x.toFixed(decimals).replace(/\.?0+$/, '');
}

export function exportWorkbook(s: Scenario, r: EvaluationResult): Uint8Array {
  const wb = XLSX.utils.book_new();

  // ---- Inputs ----
  const inputsHeader: Row = ['id', 'name', 'count', 'λ (/h)', 'β (CCF share)', 'λ_indep = λ·(1 − β)', 'auto coverage c', 'auto success s', 'T_auto (h)', 'T_manual (h)', 'E[R] (h) = c·T_a + (1 − c·s)·T_m', 'A_unit = 1/(1 + λ_indep·E[R])', 'A_class = A_unit^count', 'HAC-D λ_aggregate (/h)', 'confidence', '口径'];
  const inputs: Row[] = [inputsHeader];
  const inputRow = new Map<string, number>(); // component id → 1-based row
  for (const c of r.components) {
    const comp = s.components.find((x) => x.id === c.id)!;
    const rr = inputs.length + 1;
    inputRow.set(c.id, rr);
    const cov = c.autoCoverage ?? 0;
    const suc = c.autoSuccess ?? 1;
    inputs.push([
      c.id,
      c.name,
      c.count,
      c.lambdaPerUnitPerHour,
      comp.ccf?.beta ?? 0,
      { f: `D${rr}*(1-E${rr})` },
      cov,
      suc,
      c.mttrAutoHours ?? 0,
      c.mttrManualHours ?? c.mttrHours,
      { f: `G${rr}*I${rr}+(1-G${rr}*H${rr})*J${rr}` },
      { f: `1/(1+F${rr}*K${rr})` },
      { f: `L${rr}^C${rr}` },
      c.lambdaAggregatePerHour,
      c.confidence ?? comp.failure.provenance?.confidence ?? '',
      c.koujing ?? '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(inputs), 'Inputs');

  // ---- Structure ----
  const header: Row = ['block id', 'name', 'kind', 'depth', 'n', 'k', 'count', 'formula availability', 'HAC-D availability (compensated)', 'Δ (formula − HAC-D)', 'HAC-D original', 'HAC-D MTBF (h)', 'HAC-D MTTR (h)', 'note'];
  const rows: Row[] = [header];
  const byId = indexResults(r.structure.result);
  const rowOfBlock = new Map<string, number>();
  const order: { b: Block; depth: number }[] = [];
  const walk = (b: Block, depth: number) => {
    order.push({ b, depth });
    switch (b.kind) {
      case 'series':
      case 'parallel':
        b.children.forEach((c) => walk(c, depth + 1));
        break;
      case 'kofn':
      case 'standby':
      case 'repeat':
        walk(b.unit, depth + 1);
        break;
      default:
        break;
    }
  };
  walk(r.structure.root, 0);
  order.forEach(({ b }, i) => rowOfBlock.set(b.id, i + 2));
  const refA = (id: string) => `H${rowOfBlock.get(id)}`;
  /** Inputs row of the component class a leaf was built from — only when the leaf carries the class's own λ and E[R] (template-derived units such as the hot-spare node pool reuse an id with other parameters) */
  const compOf = (b: Extract<Block, { kind: 'leaf' }>) => {
    const base = b.id.split('#')[0].split(':')[0];
    const rr = inputRow.get(base);
    if (!rr) return undefined;
    const c = r.components.find((x) => x.id === base);
    const comp = s.components.find((x) => x.id === base);
    if (!c || !comp) return undefined;
    const lamInd = c.lambdaPerUnitPerHour * (1 - (comp.ccf?.beta ?? 0));
    const er = b.repair ? b.repair.coverage * b.repair.autoMttrH + (1 - b.repair.coverage * b.repair.successProbability) * b.repair.manualMttrH : b.mttr;
    const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    return close(b.lambda, lamInd) && close(er, c.mttrHours) ? rr : undefined;
  };
  for (const { b, depth } of order) {
    const res = byId.get(b.id);
    const rr = rowOfBlock.get(b.id)!;
    let formula: Row[number] = null;
    let note = '';
    switch (b.kind) {
      case 'leaf': {
        const ir = compOf(b);
        const count = Math.max(1, Math.round(b.count ?? 1));
        if (ir) formula = { f: `Inputs!L${ir}^${count}` };
        else {
          // synthetic unit built by a template (node pool, replica, common cause): embed its λ and E[R]
          const er = b.repair ? b.repair.coverage * b.repair.autoMttrH + (1 - b.repair.coverage * b.repair.successProbability) * b.repair.manualMttrH : b.mttr;
          formula = { f: `(1/(1+${lit(b.lambda)}*${lit(er)}))^${count}` };
          note = `synthetic unit: λ = ${b.lambda.toPrecision(6)} /h and E[R] = ${er.toPrecision(6)} h embedded`;
        }
        if (b.subhealth) note = (note ? note + '; ' : '') + 'sub-health modelled by HAC-D (not expressible as a cell formula)';
        if (b.repair && b.repair.coverage > 0) note = (note ? note + '; ' : '') + 'dual-path repair via E[R]';
        break;
      }
      case 'series':
        formula = { f: `PRODUCT(${b.children.map((c) => refA(c.id)).join(',')})` };
        break;
      case 'parallel':
        formula = { f: `1-${b.children.map((c) => `(1-${refA(c.id)})`).join('*')}` };
        if (b.switchover) note = `switchover success ${b.switchover.successProbability} modelled by HAC-D (§11/§12), not in the cell formula`;
        break;
      case 'kofn':
        formula = { f: `_xlfn.BINOM.DIST(${b.n - b.k},${b.n},1-${refA(b.unit.id)},TRUE)` };
        note = 'binomial with independent units (unlimited repair crews)' + (b.switchover ? `; switchover success ${b.switchover.successProbability} only in HAC-D` : '') + (b.crews ? '; crew limit only in HAC-D' : '');
        break;
      case 'standby':
        formula = { f: `_xlfn.BINOM.DIST(${b.n - 1},${b.n},1-${refA(b.unit.id)},TRUE)` };
        note = 'hot-standby approximation of the standby chain (standby factor and switch probability only in HAC-D)';
        break;
      case 'repeat':
        formula = { f: `${refA(b.unit.id)}^${Math.max(1, Math.round(b.count))}` };
        break;
    }
    rows.push([
      b.id,
      b.name ?? b.id,
      b.kind,
      depth,
      b.kind === 'kofn' || b.kind === 'standby' ? b.n : null,
      b.kind === 'kofn' ? b.k : null,
      b.kind === 'leaf' ? (b.count ?? 1) : b.kind === 'repeat' ? b.count : null,
      formula,
      res?.availability ?? null,
      formula ? { f: `H${rr}-I${rr}` } : null,
      null,
      res?.mtbf ?? null,
      res?.equivalentMttr ?? null,
      note,
    ]);
  }
  // original measures per block
  const orig = indexResults(compensationWaterfall(r.structure.root).original);
  for (const { b } of order) {
    const rr = rowOfBlock.get(b.id)!;
    const o = orig.get(b.id);
    rows[rr - 1][10] = o ? o.availability : null;
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), 'Structure');

  // ---- Results ----
  const m = r.system.measures;
  const results: Row[] = [
    ['measure', 'value', 'definition'],
    ['availability (compensated)', m.compensated.availability, 'after redundancy, switchover, automatic recovery and the sub-health policy'],
    ['availability (original)', m.original.availability, 'every unit fault is an outage repaired manually; redundancy removed'],
    ['strict (sub-health = down)', m.strict, ''],
    ['tolerant (sub-health = up)', m.tolerant, ''],
    ['performance-weighted', m.performability, 'Σ π·capacity'],
    ['switchover penalty', m.switchoverPenalty, 'A(perfect switchover) − A(configured)'],
    ['MTBF (h)', m.compensated.mtbfHours, 'A/ν'],
    ['equivalent MTTR (h)', m.compensated.equivalentMttrHours, '(1 − A)/ν'],
    ['human fraction', r.system.humanFraction, 'share of failure events reaching a person'],
    [],
    ['waterfall step', 'availability', 'Δ vs previous'],
    ...r.system.waterfall.map((w): Row => [w.id, w.availability, w.delta]),
  ];
  if (r.training) {
    results.push([], ['training', 'value', ''], ['MTBI (h)', r.training.mtbiHours, ''], ['recovery R (s)', r.training.recoveryS, r.training.recoveryKind], ['checkpoint interval τ (s)', r.training.tauS, r.training.intervalModel], ['goodput (first order)', r.training.firstOrder.goodput, ''], ['effective goodput', r.training.effectiveGoodput, 'incl. blocked spares and sub-health']);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(results), 'Results');

  // ---- Formulas ----
  const formulas: Row[] = [['quantity', 'formula'], ...Object.entries(r.formulas).map(([k, v]): Row => [k, v])];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(formulas), 'Formulas');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export { listBlocks };
