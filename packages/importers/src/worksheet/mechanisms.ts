/**
 * Mechanism worksheets (PLAN_V6 §5.2). `mechanisms` is a delta over a base set (or a complete set when no base is given): parameter
 * updates, verdict moves between the lists, the recovery baseline, efforts, levers, derating, the pruning rule, metadata and a
 * provenance table. `mechanism-proposal` describes a mechanism the library may not have; mapped by a person onto a library id it
 * becomes a set delta, otherwise an extension request (core `mechanismProposalRequest`).
 */
import {
  parseMechanismSet, parseMechanismProposal, type MechanismSet, type MechanismSetInput, type MechanismProposal,
  CONFIDENCES, VERDICTS, RECOVERY_FIELDS, LEVER_IDS, DERATE_FIELDS, STAGES, MECHANISM_KINDS, LAYER_IDS, MODEL_CONFIDENCES, WORKSHEET_VERSION, mechanismIds,
} from '@hac-d/core';
import { optionalTable, requireSection, table, cell, reqCell, numCell, enumCell, provCell, writeWorksheetMarkdown, WorksheetError, type WsDoc, type WsOutSection, type WsCellValue } from './markdown.js';
import { checkWorksheet } from './topology.js';

type Verdict = (typeof VERDICTS)[number];
const LIST_OF: Record<Verdict, 'baseline' | 'candidates' | 'goodputOnly' | 'pruned' | 'capability'> = { reference: 'baseline', candidate: 'candidates', goodput: 'goodputOnly', pruned: 'pruned', capability: 'capability' };
const LISTS = ['baseline', 'candidates', 'goodputOnly', 'pruned', 'capability'] as const;
type Prov = { source: string; confidence: string; note?: string };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const setPath = (o: Record<string, unknown>, path: string, v: unknown) => { const ks = path.split('.'); let cur = o; for (const k of ks.slice(0, -1)) { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k] as Record<string, unknown>; } cur[ks[ks.length - 1]] = v; };
const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((c, k) => (c && typeof c === 'object' ? (c as Record<string, unknown>)[k] : undefined), o);
const splitActs = (s: string) => s.split(/[/,，、]/).map((x) => x.trim()).filter(Boolean);

const PARAM_COLS = ['mechanism', 'parameter', 'value'], PROV_OPT = ['source', 'confidence', 'note'];
/** the metrics of the candidate rule (MechanismSetSchema prune.metric) */
const PRUNE_METRICS = ['aOp', 'effective'] as const;
const VERDICT_COLS = ['mechanism', 'verdict', 'reason zh', 'reason en'];
const META_COLS = ['mechanism', 'deploy', 'acts', 'stage', 'how zh', 'how en', 'changes zh', 'changes en'];

/** an empty complete-set skeleton for a worksheet without a base */
const skeleton = (): Record<string, unknown> => ({ id: '', source: '', baseline: [], candidates: [], goodputOnly: [], pruned: [], capability: [], parameters: {}, levers: [], metadata: {}, prune: { threshold: 0, dominated: {} }, provenance: {} });

/** parse a mechanisms worksheet: a delta over `base`, or a complete set when there is no base */
export function worksheetToMechanismSet(doc: WsDoc, base?: MechanismSet): MechanismSet {
  const f = doc.front;
  checkWorksheet(f, 'mechanisms');
  if (base && f.base !== undefined && String(f.base) !== base.id) throw new WorksheetError(`front matter base '${String(f.base)}' is not the base set given (${base.id})`);
  const s = (base ? clone(base) : skeleton()) as Record<string, unknown> & MechanismSetInput;
  if (typeof f.id !== 'string' || !f.id) throw new WorksheetError("front matter 'id' is required");
  s.id = f.id;
  if (f.source !== undefined) s.source = String(f.source);
  if (!base && !s.source) throw new WorksheetError("front matter 'source' is required for a complete set");
  for (const k of ['remap', 'stages']) if (f[k] !== undefined) (s as Record<string, unknown>)[k] = f[k];
  if (f.pruneRule !== undefined) setPath(s as Record<string, unknown>, 'prune.rule', f.pruneRule);
  const prov = (s.provenance ?? {}) as Record<string, Prov>;
  const ids = mechanismIds();
  const mech = (row: Record<string, string>, where: string) => { const m = reqCell(row, 'mechanism', where); if (!ids.includes(m)) throw new WorksheetError(`${where}: unknown mechanism '${m}'`); return m; };

  const pt = optionalTable(doc, 'parameters', PARAM_COLS, PROV_OPT);
  for (const row of pt?.rows ?? []) {
    const m = mech(row, 'parameters row'), p = reqCell(row, 'parameter', `parameters ${m}`), where = `parameter ${m}.${p}`;
    const params = (s.parameters ??= {}) as Record<string, Record<string, number>>;
    (params[m] ??= {})[p] = numCell(row, 'value', where);
    const pr = provCell(row, CONFIDENCES, where); if (pr) prov[`parameters.${m}.${p}`] = pr;
  }
  const vt = optionalTable(doc, 'verdicts', VERDICT_COLS);
  if (vt?.rows.length) {
    const lists = s as unknown as Record<(typeof LISTS)[number], string[]>;
    const verdicts = ((s as Record<string, unknown>).verdicts ?? (base?.verdicts ? {} : undefined)) as Record<string, { verdict: Verdict; reason: { zh: string; en: string } }> | undefined;
    const vmap = verdicts ?? (!base ? {} : undefined);
    for (const row of vt.rows) {
      const m = mech(row, 'verdicts row'), v = enumCell(row, 'verdict', VERDICTS, `verdict ${m}`)!;
      for (const l of LISTS) lists[l] = lists[l].filter((x) => x !== m);
      lists[LIST_OF[v]].push(m);
      if (vmap) vmap[m] = { verdict: v, reason: { zh: reqCell(row, 'reason zh', `verdict ${m}`), en: reqCell(row, 'reason en', `verdict ${m}`) } };
    }
    if (vmap) (s as Record<string, unknown>).verdicts = vmap;
  }
  const rt = optionalTable(doc, 'recovery', ['field', 'value'], PROV_OPT);
  if (rt?.rows.length) {
    const rec = ((s as Record<string, unknown>).recovery ?? {}) as Record<string, unknown>;
    const sources: string[] = []; let conf: string | undefined;
    for (const row of rt.rows) {
      const field = reqCell(row, 'field', 'recovery row');
      if (!(RECOVERY_FIELDS as readonly string[]).includes(field)) throw new WorksheetError(`recovery '${field}': not one of ${RECOVERY_FIELDS.join(', ')}`, rt.line);
      setPath(rec, field, numCell(row, 'value', `recovery ${field}`));
      const pr = provCell(row, CONFIDENCES, `recovery ${field}`);
      if (pr) { if (!sources.includes(pr.source)) sources.push(pr.source); conf ??= pr.confidence; }
    }
    if (sources.length) rec.provenance = { source: sources.join('; '), confidence: conf };
    (s as Record<string, unknown>).recovery = rec;
  }
  const et = optionalTable(doc, 'efforts', ['mechanism', 'effort'], PROV_OPT);
  for (const row of et?.rows ?? []) {
    const m = mech(row, 'efforts row');
    ((s as Record<string, unknown>).efforts ??= {}) as Record<string, number>;
    ((s as Record<string, unknown>).efforts as Record<string, number>)[m] = numCell(row, 'effort', `effort ${m}`);
    const pr = provCell(row, CONFIDENCES, `effort ${m}`); if (pr) prov[`efforts.${m}`] = pr;
  }
  const lt = optionalTable(doc, 'levers', ['id', 'limit', 'effort']);
  if (lt) (s as Record<string, unknown>).levers = lt.rows.map((row) => ({ id: enumCell(row, 'id', LEVER_IDS, 'levers row'), limit: numCell(row, 'limit', 'levers row'), effort: numCell(row, 'effort', 'levers row') }));
  const dt = optionalTable(doc, 'derate', ['field', 'value']);
  if (dt?.rows.length) { const d = ((s as Record<string, unknown>).derate ?? {}) as Record<string, number>; for (const row of dt.rows) { const k = enumCell(row, 'field', DERATE_FIELDS, 'derate row')!; d[k] = numCell(row, 'value', `derate ${k}`); } (s as Record<string, unknown>).derate = d; }
  const prt = optionalTable(doc, 'prune', ['field', 'value']);
  // v5.7 (sixth review F2) the rule's metric is a prune field beside the threshold: a complete worksheet used to lose it (the rule fell back to A_op)
  for (const row of prt?.rows ?? []) {
    const k = reqCell(row, 'field', 'prune row');
    if (k === 'threshold') setPath(s as Record<string, unknown>, 'prune.threshold', numCell(row, 'value', 'prune threshold'));
    else if (k === 'metric') setPath(s as Record<string, unknown>, 'prune.metric', enumCell(row, 'value', PRUNE_METRICS, 'prune metric'));
    else throw new WorksheetError(`prune '${k}': the prune fields are 'threshold' and 'metric' (the rule text goes to front matter pruneRule)`, prt!.line);
  }
  const dom = optionalTable(doc, 'dominated', ['mechanism', 'by']);
  if (dom) setPath(s as Record<string, unknown>, 'prune.dominated', Object.fromEntries(dom.rows.map((row) => [mech(row, 'dominated row'), reqCell(row, 'by', 'dominated row')])));
  const mt = optionalTable(doc, 'metadata', META_COLS);
  for (const row of mt?.rows ?? []) {
    const m = mech(row, 'metadata row'), where = `metadata ${m}`;
    const acts = splitActs(reqCell(row, 'acts', where));
    for (const a of acts) if (!(LAYER_IDS as readonly string[]).includes(a)) throw new WorksheetError(`${where}: acts '${a}' is not a layer (${LAYER_IDS.join(', ')})`, mt!.line);
    ((s as Record<string, unknown>).metadata as Record<string, unknown>)[m] = { deploy: enumCell(row, 'deploy', LAYER_IDS, where), acts, stage: enumCell(row, 'stage', STAGES, where), how: { zh: reqCell(row, 'how zh', where), en: reqCell(row, 'how en', where) }, changes: { zh: reqCell(row, 'changes zh', where), en: reqCell(row, 'changes en', where) } };
  }
  const pvt = optionalTable(doc, 'provenance', ['path', 'source', 'confidence'], ['note']);
  for (const row of pvt?.rows ?? []) { const path = reqCell(row, 'path', 'provenance row'); const pr = provCell(row, CONFIDENCES, `provenance '${path}'`); if (!pr) throw new WorksheetError(`provenance '${path}': source and confidence required`, pvt!.line); prov[path] = pr; }
  (s as Record<string, unknown>).provenance = prov;
  return parseMechanismSet(s);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const listOf = (s: MechanismSet, m: string) => LISTS.find((l) => s[l].includes(m));

/** the worksheet of a set: the delta against `base` when given, else the complete set */
export function mechanismSetToWorksheet(s: MechanismSet, base?: MechanismSet, title?: string): string {
  const front: Record<string, unknown> = { worksheet: 'mechanisms', version: WORKSHEET_VERSION, id: s.id, ...(base ? { base: base.id } : {}), source: s.source, ...(s.remap ? { remap: s.remap } : {}), ...(s.stages ? { stages: s.stages } : {}), ...(s.prune.rule && !same(s.prune.rule, base?.prune.rule) ? { pruneRule: s.prune.rule } : {}) };
  const prov = s.provenance ?? {}, used = new Set<string>();
  const P = (key: string): Prov | undefined => { const p = prov[key]; if (p) used.add(key); return p; };
  const pc = (p: Prov | undefined): WsCellValue[] => [p?.source, p?.confidence, p?.note];
  const params: WsCellValue[][] = [];
  for (const [m, ps] of Object.entries(s.parameters)) for (const [k, v] of Object.entries(ps)) if (!base || base.parameters[m]?.[k] !== v) params.push([m, k, v, ...pc(P(`parameters.${m}.${k}`))]);
  const verdicts: WsCellValue[][] = [];
  for (const l of LISTS) for (const m of s[l]) if (!base || listOf(base, m) !== l || !same(base.verdicts?.[m], s.verdicts?.[m])) { const v = s.verdicts?.[m]; const verdict = (Object.keys(LIST_OF) as Verdict[]).find((k) => LIST_OF[k] === l)!; verdicts.push([m, verdict, v?.reason.zh ?? '', v?.reason.en ?? '']); }
  const recovery: WsCellValue[][] = [];
  const rp = s.recovery.provenance;
  for (const fld of RECOVERY_FIELDS) { const v = getPath(s.recovery, fld); if (!base || getPath(base.recovery, fld) !== v || !same(base.recovery.provenance, rp)) recovery.push([fld, v as number, rp.source, rp.confidence, undefined]); }
  const efforts: WsCellValue[][] = Object.entries(s.efforts ?? {}).filter(([m, e]) => !base || base.efforts?.[m] !== e).map(([m, e]) => [m, e, ...pc(P(`efforts.${m}`))]);
  const levers: WsCellValue[][] = !base || !same(base.levers, s.levers) ? s.levers.map((l) => [l.id, l.limit, l.effort]) : [];
  const derate: WsCellValue[][] = DERATE_FIELDS.filter((k) => !base || base.derate[k] !== s.derate[k]).map((k) => [k, s.derate[k]]);
  const prune: WsCellValue[][] = [
    ...(!base || base.prune.threshold !== s.prune.threshold ? [['threshold', s.prune.threshold] as WsCellValue[]] : []),
    ...(s.prune.metric !== undefined && (!base || base.prune.metric !== s.prune.metric) ? [['metric', s.prune.metric] as WsCellValue[]] : []),
  ];
  const dominated: WsCellValue[][] = !base || !same(base.prune.dominated, s.prune.dominated) ? Object.entries(s.prune.dominated) : [];
  const metadata: WsCellValue[][] = Object.entries(s.metadata).filter(([m, md]) => !base || !same(base.metadata[m], md)).map(([m, md]) => [m, md.deploy, md.acts.join(' / '), md.stage, md.how.zh, md.how.en, md.changes.zh, md.changes.en]);
  const leftovers: WsCellValue[][] = Object.entries(prov).filter(([k, p]) => !used.has(k) && (!base || !same(base.provenance?.[k], p))).map(([k, p]) => [k, p.source, p.confidence, p.note]);
  const sections: WsOutSection[] = [];
  const add = (name: string, titleText: string, headers: string[], rows: WsCellValue[][], always = false) => { if (rows.length || always) sections.push({ name, title: titleText, tables: [{ headers, rows }] }); };
  add('parameters', 'target parameters (merged over the library defaults)', ['mechanism', 'parameter', 'value', 'source', 'confidence', 'note'], params, true);
  add('verdicts', 'which list each mechanism is in (reference / candidate / goodput / pruned / capability)', VERDICT_COLS, verdicts, true);
  add('recovery', 'baseline recovery policy (MTTR mixture)', ['field', 'value', 'source', 'confidence', 'note'], recovery);
  add('efforts', 'implementation effort by mechanism (replaces the library value)', ['mechanism', 'effort', 'source', 'confidence', 'note'], efforts);
  add('levers', 'recovery levers of the allocation', ['id', 'limit', 'effort'], levers);
  add('derate', 'derating of the candidate parameters', ['field', 'value'], derate);
  add('prune', 'pruning rule: threshold (Shapley fraction) and metric (aOp or effective: the candidate test; the goodput-only test reads the delivered goodput)', ['field', 'value'], prune);
  add('dominated', 'dominated → dominating mechanism', ['mechanism', 'by'], dominated);
  add('metadata', 'deployment layer, acted-on layers, stage, how, what changes', META_COLS, metadata);
  add('provenance', 'entries by field path not placed in a row above', ['path', 'source', 'confidence', 'note'], leftovers);
  return writeWorksheetMarkdown(front, sections, title ?? (base ? `Mechanism set delta — ${s.id} over ${base.id}` : `Mechanism set — ${s.id}`));
}

/* ---------------- proposal ---------------- */
export function worksheetToProposal(doc: WsDoc): MechanismProposal {
  const f = doc.front;
  checkWorksheet(f, 'mechanism-proposal');
  const acts = Array.isArray(f.acts) ? f.acts : typeof f.acts === 'string' ? splitActs(f.acts) : f.acts;
  const et = optionalTable(doc, 'effect', ['quantity', 'direction', 'value', 'unit', 'source', 'confidence'], ['note']);
  const pt = optionalTable(doc, 'parameters', ['parameter', 'value', 'source', 'confidence'], ['note']);
  const pre = optionalTable(doc, 'prerequisites', ['zh', 'en']), fm = optionalTable(doc, 'failure-modes', ['zh', 'en']);
  const ev = optionalTable(doc, 'evidence', ['doc', 'field', 'value', 'quote'], ['loc', 'unit', 'label', 'model_confidence']);
  const opt = (row: Record<string, string>, k: string) => { const v = cell(row, k); return v ? { [k]: v } : {}; };
  return parseMechanismProposal({
    id: f.id, name: f.name, kind: f.kind, stage: f.stage, deploy: f.deploy, acts, ...(f.mapsTo !== undefined ? { mapsTo: f.mapsTo } : {}), ...(f.source !== undefined ? { source: f.source } : {}),
    effect: (et?.rows ?? []).map((row) => ({ quantity: reqCell(row, 'quantity', 'effect row'), direction: enumCell(row, 'direction', ['down', 'up'], 'effect row'), value: numCell(row, 'value', 'effect row'), unit: cell(row, 'unit'), source: reqCell(row, 'source', 'effect row'), confidence: enumCell(row, 'confidence', CONFIDENCES, 'effect row'), ...opt(row, 'note') })),
    parameters: (pt?.rows ?? []).map((row) => ({ parameter: reqCell(row, 'parameter', 'parameters row'), value: numCell(row, 'value', 'parameters row'), source: reqCell(row, 'source', 'parameters row'), confidence: enumCell(row, 'confidence', CONFIDENCES, 'parameters row'), ...opt(row, 'note') })),
    prerequisites: (pre?.rows ?? []).map((row) => ({ zh: reqCell(row, 'zh', 'prerequisites row'), en: reqCell(row, 'en', 'prerequisites row') })),
    failureModes: (fm?.rows ?? []).map((row) => ({ zh: reqCell(row, 'zh', 'failure-modes row'), en: reqCell(row, 'en', 'failure-modes row') })),
    evidence: (ev?.rows ?? []).map((row) => ({ doc: reqCell(row, 'doc', 'evidence row'), loc: cell(row, 'loc'), field: reqCell(row, 'field', 'evidence row'), ...opt(row, 'label'), value_text: reqCell(row, 'value', 'evidence row'), unit_text: cell(row, 'unit'), quote: reqCell(row, 'quote', 'evidence row'), model_confidence: enumCell(row, 'model_confidence', MODEL_CONFIDENCES, 'evidence row', true) ?? 'unsure' })),
  });
}
export function proposalToWorksheet(p: MechanismProposal, title?: string): string {
  const front = { worksheet: 'mechanism-proposal', version: WORKSHEET_VERSION, id: p.id, name: p.name, kind: p.kind, stage: p.stage, deploy: p.deploy, acts: p.acts, ...(p.mapsTo ? { mapsTo: p.mapsTo } : {}), ...(p.source ? { source: p.source } : {}) };
  const sections: WsOutSection[] = [
    { name: 'effect', title: 'the quantity the mechanism claims to change, as its source states it', tables: [{ headers: ['quantity', 'direction', 'value', 'unit', 'source', 'confidence', 'note'], rows: p.effect.map((e) => [e.quantity, e.direction, e.value, e.unit, e.source, e.confidence, e.note]) }] },
    { name: 'parameters', title: 'parameter values with evidence (keys of the library mechanism when mapsTo is set)', tables: [{ headers: ['parameter', 'value', 'source', 'confidence', 'note'], rows: p.parameters.map((x) => [x.parameter, x.value, x.source, x.confidence, x.note]) }] },
    { name: 'prerequisites', tables: [{ headers: ['zh', 'en'], rows: p.prerequisites.map((x) => [x.zh, x.en]) }] },
    { name: 'failure-modes', tables: [{ headers: ['zh', 'en'], rows: p.failureModes.map((x) => [x.zh, x.en]) }] },
    { name: 'evidence', title: 'evidence cards (quote must be verbatim from the source)', tables: [{ headers: ['doc', 'loc', 'field', 'label', 'value', 'unit', 'quote', 'model_confidence'], rows: p.evidence.map((e) => [e.doc, e.loc, e.field, e.label, e.value_text, e.unit_text, e.quote, e.model_confidence]) }] },
  ];
  return writeWorksheetMarkdown(front, sections, title ?? `Mechanism proposal — ${p.name.en}`);
}

/** a proposal mapped onto a library mechanism → the base set with the proposal's parameters, listing and metadata */
export function proposalIntoSet(p: MechanismProposal, base: MechanismSet): MechanismSet {
  if (!p.mapsTo) throw new Error(`proposal '${p.id}' has no mapsTo: it is an extension request, not a set delta`);
  const m = p.mapsTo;
  if (!mechanismIds().includes(m)) throw new Error(`proposal '${p.id}': mapsTo '${m}' is not a library mechanism`);
  const s = clone(base) as Record<string, unknown> & MechanismSetInput;
  const prov = (s.provenance ?? {}) as Record<string, Prov>;
  const params = (s.parameters ??= {}) as Record<string, Record<string, number>>;
  for (const x of p.parameters) { (params[m] ??= {})[x.parameter] = x.value; prov[`parameters.${m}.${x.parameter}`] = { source: x.source, confidence: x.confidence, ...(x.note ? { note: x.note } : {}) }; }
  const lists = s as unknown as Record<(typeof LISTS)[number], string[]>;
  if (!LISTS.some((l) => lists[l].includes(m))) {
    lists.candidates.push(m);
    if (base.verdicts) ((s as Record<string, unknown>).verdicts as Record<string, unknown>)[m] = { verdict: 'candidate', reason: { zh: `提案 ${p.name.zh}（${p.id}）`, en: `proposal ${p.name.en} (${p.id})` } };
  }
  const md = (s as Record<string, unknown>).metadata as Record<string, unknown>;
  md[m] ??= { deploy: p.deploy, acts: p.acts, stage: p.stage, how: p.name, changes: { zh: p.effect.map((e) => `${e.quantity} ${e.direction === 'down' ? '↓' : '↑'} ${e.value} ${e.unit}`).join('; ') || p.name.zh, en: p.effect.map((e) => `${e.quantity} ${e.direction} ${e.value} ${e.unit}`).join('; ') || p.name.en } };
  (s as Record<string, unknown>).provenance = prov;
  return parseMechanismSet(s);
}
