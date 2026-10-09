/**
 * Topology extraction: rows → DraftNodes; hierarchy from (a) the formula dependency graph,
 * (b) a level column (1 / 1.1 / 1.1.1 or integers), (c) indentation and Excel outline levels;
 * combination kind from the parent's formula fingerprint or its redundancy text.
 */
import { fingerprintFormula, extractRefs, shapeOf } from './formula.js';
import { guessColumns, guessHeaderRow } from './fingerprint.js';
import { decodeAddr, addrOf } from './workbook.js';
import type { CellInfo, ColumnGuess, ColumnRole, DraftKind, DraftNode, MethodHit, SheetInfo, TopologyDraft } from './types.js';

export interface ExtractOptions {
  headerRow?: number;
  /** override or complete the guessed column roles */
  columns?: Partial<Record<ColumnRole, number>>;
}

interface Row {
  row: number;
  cells: Map<number, CellInfo>;
}

function numberOf(c: CellInfo | undefined): number | undefined {
  if (!c) return undefined;
  if (typeof c.value === 'number') return c.value;
  if (typeof c.value === 'string') {
    const n = Number(c.value.replace(/[,%\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** "1.2.3" → depth 3; "2" → 1; numbers → the integer itself (0-based roots become depth 0). */
export function parseLevel(v: number | string | boolean | null | undefined): { depth: number; label: string } | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isInteger(v) ? { depth: v, label: String(v) } : { depth: String(v).split('.').length, label: String(v) };
  const s = String(v).trim();
  if (/^\d+(\.\d+)*$/.test(s)) return { depth: s.split('.').length - (s.includes('.') ? 0 : 0) + (s.includes('.') ? 0 : 0), label: s };
  return undefined;
}

/** Redundancy text → kind / n / k. Recognises 1+1, 2N, N+1, N+k, 2/3, 2oo3, 2-of-3, 主备, 热备, 冷备, 无 / none. */
export function parseRedundancy(text: string | undefined, units?: number): { kind: DraftKind; n?: number; k?: number; standby?: boolean } | undefined {
  if (!text) return undefined;
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!s || s === '无' || s === 'none' || s === '-' || s === '—' || s === 'n/a' || s === '串联' || s === 'series' || s === '1/1' || s === '1oo1') return { kind: 'leaf' };
  let m = /^(\d+)\+(\d+)$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { kind: b === 0 ? 'leaf' : a === 1 && b === 1 ? 'parallel' : 'kofn', n: a + b, k: a };
  }
  m = /^(\d+)n$/.exec(s);
  if (m) {
    const mult = Number(m[1]);
    const n = units ?? mult;
    return { kind: 'parallel', n, k: 1 };
  }
  m = /^n\+(\d+)$/.exec(s);
  if (m) {
    const k = Number(m[1]);
    const n = units ?? k + 1;
    return { kind: 'kofn', n, k: Math.max(1, n - k) };
  }
  m = /^(\d+)(?:\/|oo|-of-|of)(\d+)$/.exec(s);
  if (m) {
    const k = Number(m[1]);
    const n = Number(m[2]);
    return k >= n ? { kind: 'leaf' } : { kind: k === 1 ? 'parallel' : 'kofn', n, k };
  }
  if (/主备|热备|冷备|standby|备份|active-standby|hot-standby|cold-standby/.test(s)) return { kind: 'standby', n: units ?? 2, k: 1, standby: true };
  if (/并联|parallel|redundant|冗余/.test(s)) return { kind: 'parallel', n: units ?? 2, k: 1 };
  return undefined;
}

function expandRefs(hit: MethodHit): string[] {
  const refs = extractRefs(hit.formula);
  const out: string[] = [];
  for (const r of refs) {
    if (!r.end) {
      out.push(r.addr);
      continue;
    }
    const a = decodeAddr(r.addr);
    const b = decodeAddr(r.end);
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) out.push(addrOf(row, col));
  }
  return out;
}

function kindFromHit(hit: MethodHit | undefined): { kind: DraftKind; n?: number; k?: number; evidence: string } | undefined {
  if (!hit) return undefined;
  switch (hit.tag) {
    case 'series_product':
    case 'series_rare_event_sum':
      return { kind: 'series', evidence: `formula ${hit.addr}: ${hit.tag}` };
    case 'parallel_product_complement': {
      const n = typeof hit.params?.n === 'number' ? hit.params.n : undefined;
      return { kind: 'parallel', n, k: 1, evidence: `formula ${hit.addr}: ${hit.tag}` };
    }
    case 'switchover_weighted':
      return { kind: 'parallel', n: 2, k: 1, evidence: `formula ${hit.addr}: switchover-weighted 1+1` };
    case 'kofn_combin': {
      const n = Number(hit.params?.n);
      const k = Number(hit.params?.kMin);
      return { kind: k === 1 ? 'parallel' : 'kofn', n, k, evidence: `formula ${hit.addr}: COMBIN n=${n}, k=${k}` };
    }
    case 'kofn_binom_dist': {
      const n = Number(hit.params?.n);
      const failedAtMost = Number(hit.params?.failedAtMost);
      // 1 − BINOM.DIST(k−1, n, A, TRUE) = P(at least k up) → k = failedAtMost + 1 ; BINOM.DIST(n−k, n, U, TRUE) → k = n − failedAtMost
      const k = /^1-/.test(hit.shape) ? failedAtMost + 1 : n - failedAtMost;
      return { kind: k === 1 ? 'parallel' : 'kofn', n, k, evidence: `formula ${hit.addr}: BINOM.DIST n=${n}, k=${k}` };
    }
    case 'kofn_explicit_sum': {
      const n = Number(hit.params?.n);
      const k = Number(hit.params?.k);
      return { kind: k === 1 ? 'parallel' : 'kofn', n, k, evidence: `formula ${hit.addr}: explicit binomial n=${n}, k=${k}` };
    }
    default:
      return undefined;
  }
}

/** Extract a topology draft from one sheet. */
export function extractTopology(sheet: SheetInfo, fileName: string, opts: ExtractOptions = {}): TopologyDraft {
  const notes: string[] = [];
  const headerRow = opts.headerRow ?? guessHeaderRow(sheet);
  if (headerRow === null) {
    return { fileName, sheet: sheet.name, root: { id: 'system', name: 'System', kind: 'series', count: 1, params: {}, sourceRow: -1, sheet: sheet.name, children: [], evidence: ['no header row found'] }, columns: [], headerRow: -1, notes: ['no header row recognised'], confidence: 0 };
  }
  const columns: ColumnGuess[] = guessColumns(sheet, headerRow);
  if (opts.columns) {
    for (const [role, col] of Object.entries(opts.columns)) {
      if (col === undefined) continue;
      for (const g of columns) if (g.role === role) g.role = null;
      const g = columns.find((x) => x.col === col);
      if (g) {
        g.role = role as ColumnRole;
        g.confidence = 1;
      } else columns.push({ col, header: '', role: role as ColumnRole, confidence: 1 });
    }
  }
  const colOf = (role: ColumnRole) => columns.find((g) => g.role === role)?.col;
  const nameCol = colOf('name');
  const levelCol = colOf('level');
  const availCol = colOf('group_availability') ?? colOf('availability') ?? colOf('availability_pct');
  const unitAvailCol = colOf('availability');
  const unavailCol = colOf('unavailability');

  // rows
  const byRow = new Map<number, Row>();
  for (const c of sheet.cells) {
    if (c.row <= headerRow) continue;
    if (!byRow.has(c.row)) byRow.set(c.row, { row: c.row, cells: new Map() });
    byRow.get(c.row)!.cells.set(c.col, c);
  }
  const rows = [...byRow.values()].sort((a, b) => a.row - b.row).filter((r) => nameCol === undefined || (r.cells.get(nameCol)?.value ?? '') !== '');
  if (!rows.length) notes.push('no data rows under the header');

  // formula hits per cell
  const hitAt = new Map<string, MethodHit>();
  for (const c of sheet.cells) if (c.formula) hitAt.set(c.addr, fingerprintFormula(sheet.name, c.addr, c.formula));

  // nodes
  const nodes = new Map<number, DraftNode>();
  const rowOfCell = new Map<string, number>(); // availability / unavailability cell → row
  for (const r of rows) {
    const nameCell = nameCol !== undefined ? r.cells.get(nameCol) : undefined;
    const rawName = nameCell ? String(nameCell.value ?? '') : `row ${r.row + 1}`;
    const indent = rawName.length - rawName.replace(/^\s+/, '').length;
    const name = rawName.trim();
    const num = (role: ColumnRole) => {
      const col = colOf(role);
      return col === undefined ? undefined : numberOf(r.cells.get(col));
    };
    const countRaw = num('count');
    const availCell = availCol !== undefined ? r.cells.get(availCol) : undefined;
    const unitCell = unitAvailCol !== undefined ? r.cells.get(unitAvailCol) : undefined;
    const availPct = num('availability_pct');
    const node: DraftNode = {
      id: `r${r.row + 1}`,
      name,
      kind: 'leaf',
      count: countRaw && countRaw > 0 ? countRaw : 1,
      params: {
        mtbfH: num('mtbf_h'),
        mttrH: num('mttr_h') ?? num('mttr_effective_h'),
        lambdaPerH: num('lambda_per_h'),
        fit: num('fit'),
        afrPct: num('afr_pct'),
        availability: typeof availCell?.value === 'number' ? availCell.value : typeof unitCell?.value === 'number' ? unitCell.value : availPct !== undefined ? (availPct > 1 ? availPct / 100 : availPct) : undefined,
        unavailability: num('unavailability'),
        switchoverSuccess: num('switchover_success'),
        autoFraction: num('auto_fraction'),
        mttrAutoH: num('mttr_auto_h'),
        mttrManualH: num('mttr_manual_h'),
      },
      redundancyText: (() => {
        const col = colOf('redundancy');
        const v = col === undefined ? undefined : r.cells.get(col)?.value;
        return v === null || v === undefined ? undefined : String(v);
      })(),
      excelAvailability: typeof availCell?.value === 'number' ? availCell.value : null,
      availabilityCell: availCell?.addr,
      sourceRow: r.row,
      sheet: sheet.name,
      children: [],
      evidence: [],
    };
    (node as DraftNode & { _indent: number; _outline: number }).evidence.push(indent ? `indent ${indent}` : '');
    (node as unknown as { _indent: number })._indent = indent;
    (node as unknown as { _outline: number })._outline = sheet.outline[r.row] ?? 0;
    nodes.set(r.row, node);
    if (availCell) rowOfCell.set(availCell.addr, r.row);
    if (unitCell) rowOfCell.set(unitCell.addr, r.row);
    if (unavailCol !== undefined) {
      const u = r.cells.get(unavailCol);
      if (u) rowOfCell.set(u.addr, r.row);
    }
  }

  // (a) formula dependency graph on the availability column(s)
  const parentOf = new Map<number, number>();
  const formulaParents = new Set<number>();
  const PRIORITY: Record<string, number> = { series_product: 0, parallel_product_complement: 0, kofn_combin: 0, kofn_binom_dist: 0, kofn_explicit_sum: 0, switchover_weighted: 1, series_rare_event_sum: 5, unknown: 3 };
  const groupRows: { row: number; hit: MethodHit; refRows: number[] }[] = [];
  const alternatives: string[] = [];
  for (const r of rows) {
    const node = nodes.get(r.row)!;
    const candidates = [availCol, unitAvailCol].filter((c): c is number => c !== undefined);
    let used = false;
    for (const col of candidates) {
      const cell = r.cells.get(col);
      const hit = cell ? hitAt.get(cell.addr) : undefined;
      if (!hit) continue;
      const refRows = [...new Set(expandRefs(hit).map((a) => rowOfCell.get(a)).filter((x): x is number => x !== undefined && x !== r.row))];
      const selfRefs = expandRefs(hit).filter((a) => rowOfCell.get(a) === r.row);
      const kf = kindFromHit(hit);
      if (refRows.length && !kf) {
        // a formula over other rows that is not a known combination (difference, ratio, check cell): not a group
        node.evidence.push(`formula ${hit.addr} (${hit.tag}) references rows ${refRows.map((x) => x + 1).join(',')} but is not a combination: ignored`);
        continue;
      }
      if (refRows.length) {
        // group row combining other rows
        node.kind = kf?.kind ?? 'series';
        if (kf?.n) node.n = kf.n;
        if (kf?.k) node.k = kf.k;
        node.evidence.push(kf?.evidence ?? `formula ${hit.addr} references rows ${refRows.map((x) => x + 1).join(',')}`);
        groupRows.push({ row: r.row, hit, refRows });
        used = true;
        break;
      }
      if (selfRefs.length && kf && kf.kind !== 'series') {
        // homogeneous redundant group described by its own unit availability (1+1, k/n …)
        node.kind = kf.kind;
        node.n = kf.n ?? node.n;
        node.k = kf.k ?? node.k;
        node.evidence.push(kf.evidence);
        used = true;
      }
    }
    // quantity semantics: the quantity is applied only when the row's own formula raises to a power
    if (node.count > 1) {
      const ownHit = [availCol, unitAvailCol].filter((c): c is number => c !== undefined).map((c) => r.cells.get(c)).filter(Boolean).map((c) => hitAt.get(c!.addr)).find(Boolean);
      if (ownHit && !/\^/.test(ownHit.shape) && node.kind === 'leaf') {
        node.qtyRaw = node.count;
        node.count = 1;
        node.evidence.push(`quantity ${node.qtyRaw} not applied by the row formula (aggregate parameters)`);
      }
    }
    if (!used && node.redundancyText) {
      const red = parseRedundancy(node.redundancyText, node.count > 1 ? node.count : undefined);
      if (red && red.kind !== 'leaf') {
        node.kind = red.kind;
        node.n = red.n;
        node.k = red.k;
        node.evidence.push(`redundancy text "${node.redundancyText}"`);
      }
    } else if (node.redundancyText && node.kind !== 'leaf' && (node.n === undefined || node.k === undefined)) {
      const red = parseRedundancy(node.redundancyText, node.count > 1 ? node.count : undefined);
      if (red) {
        node.n = node.n ?? red.n;
        node.k = node.k ?? red.k;
      }
    }
  }

  // assign formula parents: exact methods win over approximations; the losers are alternative totals
  groupRows.sort((a, b) => (PRIORITY[a.hit.tag] ?? 3) - (PRIORITY[b.hit.tag] ?? 3) || a.row - b.row);
  for (const g of groupRows) {
    let assigned = 0;
    for (const child of g.refRows) {
      if (!parentOf.has(child)) {
        parentOf.set(child, g.row);
        assigned++;
      }
    }
    if (assigned) formulaParents.add(g.row);
    else alternatives.push(`${nodes.get(g.row)!.name} (${g.hit.tag}, ${g.hit.addr})`);
  }
  if (alternatives.length) notes.push(`alternative totals over the same rows ignored: ${alternatives.join('; ')}`);
  // homogeneous groups: the quantity counts the units of the group
  for (const node of nodes.values()) {
    if (node.kind !== 'leaf' && !formulaParents.has(node.sourceRow)) {
      if (node.n === undefined && node.count > 1) node.n = node.count;
      if (node.n !== undefined && node.count === node.n) node.count = 1;
      if (node.k === undefined && node.n !== undefined) node.k = node.kind === 'kofn' ? Math.max(1, node.n - 1) : 1;
    }
  }

  // (b) level column / (c) indentation or outline for rows without a formula parent
  const depthOf = new Map<number, number>();
  let levelSource = '';
  if (levelCol !== undefined) {
    for (const r of rows) {
      const lv = parseLevel(r.cells.get(levelCol)?.value);
      if (lv) depthOf.set(r.row, lv.depth);
    }
    if (depthOf.size) levelSource = 'level column';
  }
  if (!depthOf.size) {
    const indents = rows.map((r) => (nodes.get(r.row) as unknown as { _indent: number })._indent);
    const outlines = rows.map((r) => (nodes.get(r.row) as unknown as { _outline: number })._outline);
    if (indents.some((x) => x > 0)) {
      const step = Math.min(...indents.filter((x) => x > 0));
      rows.forEach((r, i) => depthOf.set(r.row, Math.round(indents[i] / step)));
      levelSource = 'indentation';
    } else if (outlines.some((x) => x > 0)) {
      rows.forEach((r, i) => depthOf.set(r.row, outlines[i]));
      levelSource = 'outline levels';
    }
  }
  if (depthOf.size) {
    const stack: { depth: number; row: number }[] = [];
    for (const r of rows) {
      const d = depthOf.get(r.row) ?? 0;
      while (stack.length && stack[stack.length - 1].depth >= d) stack.pop();
      if (stack.length && !parentOf.has(r.row)) {
        parentOf.set(r.row, stack[stack.length - 1].row);
        nodes.get(r.row)!.evidence.push(`${levelSource}: depth ${d}`);
      }
      stack.push({ depth: d, row: r.row });
    }
    notes.push(`hierarchy from ${levelSource}${formulaParents.size ? ' and formula references' : ''}`);
  } else if (formulaParents.size) notes.push('hierarchy from formula references');

  // attach children, decide kinds of level-only parents
  for (const [child, parent] of parentOf) nodes.get(parent)!.children.push(nodes.get(child)!);
  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.sourceRow - b.sourceRow);
    if (node.children.length) {
      if (node.kind === 'series') {
        node.n = undefined;
        node.k = undefined;
      } else if (node.kind === 'parallel') {
        node.n = node.children.length;
        node.k = 1;
      }
    }
    if (node.children.length && node.kind === 'leaf') {
      const red = parseRedundancy(node.redundancyText, node.children.length);
      node.kind = red && red.kind !== 'leaf' ? red.kind : 'series';
      node.n = red?.n;
      node.k = red?.k;
      node.evidence.push(red && red.kind !== 'leaf' ? `parent kind from redundancy text "${node.redundancyText}"` : 'parent without formula: series assumed');
    }
  }
  const altRows = new Set(groupRows.filter((g) => !formulaParents.has(g.row)).map((g) => g.row));
  const roots = rows.map((r) => nodes.get(r.row)!).filter((n) => !parentOf.has(n.sourceRow) && !altRows.has(n.sourceRow));
  const withChildren = roots.filter((r) => r.children.length);
  let root: DraftNode;
  if (withChildren.length === 1 && roots.length === 1) root = withChildren[0];
  else if (withChildren.length === 1 && roots.every((r) => r === withChildren[0] || (r.children.length === 0 && r.kind === 'leaf' && r.params.mtbfH === undefined && r.params.lambdaPerH === undefined && r.params.fit === undefined && r.params.afrPct === undefined))) {
    // one real root plus parameter-less rows (titles, totals): keep the root
    root = withChildren[0];
    const extras = roots.filter((r) => r !== root);
    if (extras.length) notes.push(`${extras.length} top-level row(s) without parameters ignored: ${extras.map((e) => e.name).join('; ')}`);
  } else {
    root = { id: 'system', name: 'System', kind: 'series', count: 1, params: {}, sourceRow: -1, sheet: sheet.name, children: roots, evidence: ['synthesised root: all top-level rows in series'] };
    notes.push('no single root row: top-level rows combined in series');
  }
  for (const n of nodes.values()) {
    delete (n as unknown as { _indent?: number })._indent;
    delete (n as unknown as { _outline?: number })._outline;
    n.evidence = n.evidence.filter(Boolean);
  }
  const resolved = rows.filter((r) => parentOf.has(r.row) || nodes.get(r.row) === root).length;
  const confidence = rows.length ? resolved / rows.length : 0;
  return { fileName, sheet: sheet.name, root, columns, headerRow, notes, confidence };
}

/** Flatten a draft to rows (depth-first). */
export function flattenDraft(root: DraftNode, depth = 0, out: { node: DraftNode; depth: number }[] = []): { node: DraftNode; depth: number }[] {
  out.push({ node: root, depth });
  for (const c of root.children) flattenDraft(c, depth + 1, out);
  return out;
}

export { shapeOf };
