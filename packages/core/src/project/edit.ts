/**
 * v6.4 editing a project (a scenario) the way the web pages do, as pure functions for the CLI (`hacd scenario …`), the MCP server
 * and the operator model: the inputs of the Topology page (template, SuperPoD variant and fabric, geometry fields, the scale-out
 * network, user counts, the size), the FIT of the fault types of the Hardware tab, the mechanisms of the Mechanism library page
 * (apply with parameters, remove), the workload, the targets and the recovery fields — every result validated against the scenario
 * schema — and a summary a model can read back (what is set, the mechanisms applied with their parameters, the FIT overrides, the
 * KPI strip in the Findings report's 口径). Edits of settings a mechanism may own (workload, recovery, FIT) go through `editBase`:
 * the applied mechanisms are removed, the base is changed and they are applied again with their recorded parameters, as on the
 * pages. Nothing here computes a reliability number from a document: values come from the caller with their provenance.
 * v5.5 (fifth review D1, D9): a mechanism is applied with the default set's parameters merged over the library defaults — the
 * values the Findings report evaluates its candidates with — then the caller's; the keys are the mechanism's whole vocabulary
 * (`mechanismParameterKeys`: parameters, provisional, integration needs, read keys); a transform that would not act (integration
 * parameters missing, a required mechanism absent) is refused with the missing keys named, never reported as applied. The
 * scale-out network toggles go through `editBase` too, so per-class mechanism effects survive an off / on.
 */
import type { Scenario, Superpod } from '../scenario/schema.js';
import { parseScenario } from '../scenario/schema.js';
import { computeCounts, resolveCountOverrides, withoutSuperpodOverrides, COUNT_OVERRIDE_ROWS, geometryCounts } from '../scenario/build.js';
import { editBase, applyMechanisms, stripMechanisms, isStrippable, activeMechanisms, MECHANISM_LIBRARY, mechanismOwner } from '../mechanisms/index.js';
import { integrationStatus } from '../mechanisms/auditLibrary.js';
import { mechanismParameterKeys } from '../ingest/fields.js';
import { DEFAULT_MECHANISM_SET, resolveMechanismSet, type ResolvedMechanismSet } from '../records/mechanismSet.js';
import { unitFaultLibrary, fitOverrides, resizeTopology, withFabric, applySuperpodVariant, superpodVariantOf, switchTopologyTemplate, SUPERPOD_VARIANTS, TOPOLOGY_TEMPLATES, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_EXAMPLES, topologyBom, type TopologyTemplate, type UnitFaultType } from '../topology/index.js';
import { kpiForm, trainingOf } from '../budget/kpiForm.js';
import { deratedOf } from '../strategy/window.js';
import { toPerHour } from '../units/index.js';

type L = { zh: string; en: string };
export type ScenarioFieldKind = 'integer' | 'number' | 'boolean' | 'enum' | 'string' | 'count';
export interface ScenarioField { path: string; kind: ScenarioFieldKind; values?: readonly string[]; min?: number; max?: number; note: string }

const FABRICS = ['two-level', 'mesh-clos', 'mesh-4d', 'blade-clos'] as const;
const SUPERPOD_INT = ['nodesPerRack', 'npusPerNode', 'computeRacks', 'commRacks', 'cpusPerNode', 'l1PerNode', 'subPlanes', 'l2PerSubPlane', 'l2Ports', 'linksPerL1', 'rackSwitches', 'podSwitchRadix', 'meshRackGrid', 'backupNpusPerRack', 'transceiversPerLink', 'rdmaPortsPerNpu', 'vpcNicsPerNode'] as const;
const SUPERPOD_NUM = ['podUplinksPerNpu', 'opticalLinksPerNpu', 'opticalEnginesPerNpu'] as const;
const SUPERPOD_NOTE: Record<string, string> = {
  nodesPerRack: 'nodes per compute cabinet (also sets topology.nodesPerRack)', npusPerNode: 'NPUs per node (also sets topology.gpusPerNode)', computeRacks: 'compute cabinets per SuperPoD', commRacks: 'communication / UB interconnect cabinets per SuperPoD', cpusPerNode: 'CPUs per node',
  l1PerNode: 'two-level: L1 UB chips per node', subPlanes: 'two-level: L2 sub-planes', l2PerSubPlane: 'two-level: L2 chips per sub-plane', l2Ports: 'two-level: ports per L2 chip', linksPerL1: 'two-level: optical links per L1 chip',
  rackSwitches: 'mesh / blade fabrics: switch chips per compute cabinet', podUplinksPerNpu: 'mesh / blade fabrics: pod-tier uplinks per NPU', podSwitchRadix: 'mesh / blade fabrics: ports of one pod-tier switch', opticalLinksPerNpu: 'blade-clos: 800G-equivalent optical links per NPU', opticalEnginesPerNpu: 'blade-clos: NPO engines per NPU', meshRackGrid: 'mesh-4d: cabinets per row of the cabinet mesh', backupNpusPerRack: 'backup NPUs per compute cabinet',
  transceiversPerLink: 'transceivers per UB optical link', rdmaPortsPerNpu: 'RDMA ports per NPU (the scale-out ports when topology.scaleOut.portsPerNpu is not set)', vpcNicsPerNode: 'VPC NICs (Qingtian cards) per node',
};

/** the fields `setScenarioFields` accepts (the Topology page's inputs, user counts, workload, targets, recovery) */
export const SCENARIO_FIELDS: ScenarioField[] = [
  { path: 'npus', kind: 'integer', min: 1, note: 'NPUs in the job; every hardware count follows the template geometry, user counts keep their per-NPU ratio' },
  { path: 'name', kind: 'string', note: 'project name' },
  { path: 'id', kind: 'string', note: 'project id (lowercase letters, digits and hyphens)' },
  { path: 'topology.template', kind: 'enum', values: TOPOLOGY_TEMPLATE_IDS, note: 'switch the template: the hardware comes from the new template, job settings, FIT edits and mechanisms are kept' },
  { path: 'topology.variant', kind: 'string', note: `SuperPoD variant of the template (${Object.entries(SUPERPOD_VARIANTS).map(([t, vs]) => `${t}: ${(vs ?? []).map((v) => v.id).join(', ')}`).join('; ')})` },
  { path: 'topology.fabric', kind: 'enum', values: FABRICS, note: 'UB fabric of the SuperPoD; the fields only that fabric uses take its reference geometry (assumed)' },
  { path: 'topology.fabricFill', kind: 'enum', values: ['proportional', 'full-pod'], note: 'how a partly populated last SuperPoD counts its switches and cabinets' },
  { path: 'topology.nvlinkDomainGpus', kind: 'integer', min: 1, note: 'NPUs of one UB (scale-up) domain' },
  { path: 'topology.gpusPerNode', kind: 'integer', min: 1, note: 'A2 (no SuperPoD): NPUs per server' },
  { path: 'topology.cpusPerNode', kind: 'integer', min: 0, note: 'A2 (no SuperPoD): CPUs per server' },
  { path: 'topology.nodesPerRack', kind: 'integer', min: 1, note: 'A2 (no SuperPoD): servers per cabinet' },
  ...SUPERPOD_INT.map((f): ScenarioField => ({ path: `topology.superpod.${f}`, kind: 'integer', min: f === 'nodesPerRack' || f === 'npusPerNode' || f === 'computeRacks' || f === 'subPlanes' || f === 'l2Ports' || f === 'podSwitchRadix' ? 1 : 0, note: SUPERPOD_NOTE[f] })),
  ...SUPERPOD_NUM.map((f): ScenarioField => ({ path: `topology.superpod.${f}`, kind: 'number', min: 0, note: SUPERPOD_NOTE[f] })),
  { path: 'topology.scaleOut', kind: 'boolean', note: 'the scale-out (RoCE / RDMA / UBoE) network on or off; off removes its switch and link classes, on restores the template default' },
  { path: 'topology.scaleOut.portsPerNpu', kind: 'integer', min: 1, note: 'scale-out ports per NPU' },
  { path: 'topology.scaleOut.planes', kind: 'integer', min: 1, note: 'independent Clos planes' },
  { path: 'topology.scaleOut.radix', kind: 'integer', min: 4, note: 'switch radix' },
  { path: 'topology.scaleOut.oversubscription', kind: 'number', min: 1, note: 'leaf oversubscription (1 = non-blocking)' },
  { path: 'topology.scaleOut.transceiversPerLink', kind: 'integer', min: 0, note: 'transceivers per scale-out link' },
  { path: 'counts.<row>', kind: 'count', note: `user count of a bill-of-materials row at the current size (rows: ${Object.keys(COUNT_OVERRIDE_ROWS).join(', ')}, roceTier1…); null removes the override` },
  { path: 'workload.durationDays', kind: 'number', min: 0.1, note: 'job window (days)' },
  { path: 'workload.intervalS', kind: 'number', min: 0, note: 'checkpoint interval τ (s); 0 = the optimal interval; refused while C-FAST owns it' },
  { path: 'workload.deltaS', kind: 'number', min: 0, note: 'checkpoint write time δ (s); refused while a mechanism owns it' },
  { path: 'targets.operational', kind: 'number', min: 0.5, max: 0.99999, note: 'A_op target (the report target)' },
  { path: 'targets.goodput', kind: 'number', min: 0.5, max: 0.9999, note: 'delivered goodput target' },
  { path: 'targets.availability', kind: 'number', min: 0.9, max: 0.999999, note: 'hardware availability target of the classic methods' },
  { path: 'recovery.detection.coverage', kind: 'number', min: 0, max: 1, note: 'MTTR mixture: automatic detection coverage; refused while D-HARD owns it' },
  { path: 'recovery.detection.autoSeconds', kind: 'number', min: 0, note: 'MTTR mixture: automatic detection time (s); refused while D-HARD owns it' },
  { path: 'recovery.detection.timeoutSeconds', kind: 'number', min: 0, note: 'MTTR mixture: detection by timeout (s)' },
  { path: 'recovery.automatic.seconds', kind: 'number', min: 0, note: 'MTTR mixture: automatic recovery attempt (s)' },
  { path: 'recovery.automatic.successProbability', kind: 'number', min: 0, max: 1, note: 'MTTR mixture: automatic success probability' },
  { path: 'recovery.manual.seconds', kind: 'number', min: 0, note: 'MTTR mixture: manual recovery (s)' },
];

const fieldOf = (path: string): ScenarioField | undefined => SCENARIO_FIELDS.find((f) => f.path === path) ?? (path.startsWith('counts.') ? SCENARIO_FIELDS.find((f) => f.kind === 'count') : undefined);
const num = (path: string, v: unknown, f: ScenarioField): number => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(x)) throw new Error(`${path}: a number is required (got ${JSON.stringify(v)})`);
  if (f.kind === 'integer' && !Number.isInteger(x)) throw new Error(`${path}: a whole number is required (got ${x})`);
  if (f.min !== undefined && x < f.min) throw new Error(`${path}: must be ≥ ${f.min} (got ${x})`);
  if (f.max !== undefined && x > f.max) throw new Error(`${path}: must be ≤ ${f.max} (got ${x})`);
  return x;
};
const bool = (path: string, v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(s)) return true;
  if (['false', 'off', 'no', '0'].includes(s)) return false;
  throw new Error(`${path}: on or off expected (got ${JSON.stringify(v)})`);
};
const isNull = (v: unknown) => v === null || v === undefined || v === '' || v === 'null';
/** the order edits are applied in: the template first (it resets the geometry), then variant and fabric, then the rest */
const PRIORITY = (p: string) => (p === 'topology.template' ? 0 : p === 'topology.variant' ? 1 : p === 'topology.fabric' ? 2 : p === 'topology.scaleOut' ? 3 : p === 'npus' ? 9 : 5);

/** the scenario with the given fields set (see SCENARIO_FIELDS); `changed` lists the paths applied; throws on an unknown path or an invalid value */
export function setScenarioFields(s: Scenario, sets: Record<string, unknown>): { scenario: Scenario; changed: string[] } {
  const LIB = unitFaultLibrary();
  let x = s;
  const changed: string[] = [];
  for (const [path, raw] of Object.entries(sets).sort((a, b) => PRIORITY(a[0]) - PRIORITY(b[0]))) {
    const f = fieldOf(path);
    if (!f) throw new Error(`unknown field '${path}'; the fields are: ${SCENARIO_FIELDS.map((q) => q.path).join(', ')}`);
    const sp = x.topology.superpod;
    const tpl = x.topology.template;
    if (path === 'npus') x = resizeTopology(x, num(path, raw, f));
    else if (path === 'name') x = { ...x, meta: { ...x.meta, name: String(raw) } };
    else if (path === 'id') { const id = String(raw); if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`id: lowercase letters, digits and hyphens only (got ${id})`); x = { ...x, meta: { ...x.meta, id } }; }
    else if (path === 'topology.template') {
      const t = String(raw) as TopologyTemplate;
      if (!TOPOLOGY_TEMPLATES[t]) throw new Error(`topology.template: one of ${TOPOLOGY_TEMPLATE_IDS.join(', ')} (got ${t})`);
      x = switchTopologyTemplate(x, t, { id: x.meta.id, name: x.meta.name });
    } else if (path === 'topology.variant') {
      const list = tpl ? SUPERPOD_VARIANTS[tpl] ?? [] : [];
      if (!list.some((v) => v.id === String(raw))) throw new Error(`topology.variant: template ${tpl ?? 'custom'} has ${list.length ? `the variants ${list.map((v) => v.id).join(', ')}` : 'no variants'} (got ${String(raw)})`);
      x = applySuperpodVariant(x, String(raw));
    } else if (path === 'topology.fabric') {
      if (!sp) throw new Error('topology.fabric: the template has no SuperPoD');
      const v = String(raw) as Superpod['fabric'];
      if (!FABRICS.includes(v)) throw new Error(`topology.fabric: one of ${FABRICS.join(', ')} (got ${v})`);
      if (sp.fabric !== v) x = { ...x, topology: { ...withoutSuperpodOverrides(x.topology), superpod: withFabric(sp, v) } };
    } else if (path === 'topology.fabricFill') {
      const v = String(raw);
      if (v !== 'proportional' && v !== 'full-pod') throw new Error(`topology.fabricFill: proportional or full-pod (got ${v})`);
      x = { ...x, topology: { ...x.topology, fabricFill: v } };
    } else if (path === 'topology.nvlinkDomainGpus') x = { ...x, topology: { ...x.topology, nvlinkDomainGpus: num(path, raw, f) } };
    else if (path === 'topology.gpusPerNode' || path === 'topology.cpusPerNode' || path === 'topology.nodesPerRack') {
      if (sp) throw new Error(`${path}: the template has a SuperPoD; set topology.superpod.${path === 'topology.gpusPerNode' ? 'npusPerNode' : path.slice('topology.'.length)} instead`);
      x = { ...x, topology: { ...x.topology, [path.slice('topology.'.length)]: num(path, raw, f) } };
    } else if (path.startsWith('topology.superpod.')) {
      if (!sp) throw new Error(`${path}: the template has no SuperPoD`);
      const k = path.slice('topology.superpod.'.length) as keyof Superpod;
      const v = num(path, raw, f);
      x = { ...x, topology: { ...x.topology, superpod: { ...sp, [k]: v }, ...(k === 'nodesPerRack' ? { nodesPerRack: v } : {}), ...(k === 'npusPerNode' ? { gpusPerNode: v } : {}) } };
    } else if (path === 'topology.scaleOut') {
      // both toggles on the bare design (editBase): the applied mechanisms are re-applied afterwards, so a rung or detector with
      // per-class effects on the @roce classes (R-LINK-LOCAL, R-FABRIC-DEGRADE, H-CONTROL-CONTINUITY, D-NET-SDC) acts on the restored classes
      const on = bool(path, raw);
      if (!on) x = editBase(x, (b) => ({ ...b, topology: { ...b.topology, scaleOut: undefined }, components: b.components.filter((c) => !c.id.includes('@roce')) }));
      else if (!x.topology.scaleOut) {
        if (!tpl) throw new Error('topology.scaleOut: a custom topology has no template default for the scale-out network');
        const roce = LIB.filter((q) => q.unit === 'roce-switch' || q.unit === 'roce-link');
        const fresh = TOPOLOGY_EXAMPLES[`topology-${tpl}`]();
        x = editBase(x, (b) => {
          const add = fresh.components.filter((c) => roce.some((q) => q.id === c.id) && !b.components.some((q) => q.id === c.id));
          return { ...b, topology: { ...b.topology, scaleOut: TOPOLOGY_TEMPLATES[tpl].topology.scaleOut as Scenario['topology']['scaleOut'] }, components: [...b.components, ...add] };
        });
      }
    } else if (path.startsWith('topology.scaleOut.')) {
      if (!x.topology.scaleOut) throw new Error(`${path}: the scale-out network is off (set topology.scaleOut=on first)`);
      const k = path.slice('topology.scaleOut.'.length);
      x = { ...x, topology: { ...x.topology, scaleOut: { ...x.topology.scaleOut, [k]: num(path, raw, f) } } };
    } else if (path.startsWith('counts.')) {
      const id = path.slice('counts.'.length);
      if (!COUNT_OVERRIDE_ROWS[id] && !/^roceTier\d+$/.test(id)) throw new Error(`${path}: rows are ${Object.keys(COUNT_OVERRIDE_ROWS).join(', ')} and roceTier1…`);
      const N = computeCounts(x).gpus, tiers = computeCounts(x).scaleOutTiers;
      x = editBase(x, (b) => {
        const o = { ...(b.topology.countOverrides ?? {}) };
        if (isNull(raw)) delete o[id];
        else o[id] = { count: Math.max(0, Math.round(num(path, raw, f))), npus: N, ...(/^roceTier\d+$/.test(id) ? { tiers } : {}) };
        return { ...b, topology: { ...b.topology, countOverrides: Object.keys(o).length ? o : undefined } };
      });
    } else if (path.startsWith('workload.')) {
      const k = path.slice('workload.'.length) as 'durationDays' | 'intervalS' | 'deltaS';
      if (x.workload.type !== 'training') throw new Error(`${path}: the workload is not a training job`);
      const owner = k === 'durationDays' ? undefined : mechanismOwner(x, `workload.${k}`);
      if (owner) throw new Error(`${path} is owned by the applied mechanism ${owner}: set its parameter instead (hacd scenario mechanisms --apply ${owner}:…)`);
      const v = num(path, raw, f);
      x = editBase(x, (b) => (b.workload.type === 'training' ? { ...b, workload: { ...b.workload, [k]: k === 'intervalS' && v <= 0 ? undefined : v } } : b));
    } else if (path.startsWith('targets.')) {
      const k = path.slice('targets.'.length) as 'operational' | 'goodput' | 'availability';
      const v = num(path, raw, f);
      x = editBase(x, (b) => ({ ...b, targets: { ...b.targets, [k]: v } }));
    } else if (path.startsWith('recovery.')) {
      if (x.recovery.mode !== 'mixture') throw new Error(`${path}: the recovery is in mode '${x.recovery.mode}', not the MTTR mixture; edit it in the scenario editor`);
      if (path.startsWith('recovery.detection.') && path !== 'recovery.detection.timeoutSeconds') { const owner = mechanismOwner(x, 'recovery.detection'); if (owner) throw new Error(`${path} is owned by the applied mechanism ${owner}: set its parameter instead`); }
      const [, group, k] = path.split('.') as [string, 'detection' | 'automatic' | 'manual', string];
      const v = num(path, raw, f);
      x = editBase(x, (b) => (b.recovery.mode === 'mixture' ? { ...b, recovery: { ...b.recovery, [group]: { ...(b.recovery[group] as Record<string, number>), [k]: v } } as Scenario['recovery'] } : b));
    } else throw new Error(`unknown field '${path}'`);
    changed.push(path);
  }
  return { scenario: parseScenario(x), changed };
}

/** the FIT of a fault type on its unit (the Hardware tab's editable cells): the class id of the unit library; null = back to the library value */
export function setFaultFit(s: Scenario, fits: Record<string, number | null>): { scenario: Scenario; changed: string[] } {
  const LIB = new Map(unitFaultLibrary().map((q) => [q.id, q]));
  const present = new Set(s.components.map((c) => c.id));
  const changed: string[] = [];
  const set = (c: Scenario['components'][number], q: UnitFaultType, fit: number) => (q.type === 'hard' ? { ...c, failure: { ...c.failure, value: fit, unit: 'FIT' as const } } : q.type === 'slow' && c.subhealth ? { ...c, subhealth: { ...c.subhealth, ratePerHour: fit / 1e9 } } : q.type === 'sdc' && c.sdc ? { ...c, sdc: { ...c.sdc, ratePerHour: fit / 1e9 } } : c);
  let x = s;
  for (const [id, raw] of Object.entries(fits)) {
    const q = LIB.get(id);
    if (!q) throw new Error(`unknown fault type '${id}'; the ids are the unit library's (hacd scenario fields <file> lists the ones of this project)`);
    if (!present.has(id)) throw new Error(`fault type '${id}' is not carried by this project's template (${s.topology.template ?? 'custom'}); its classes: ${[...present].filter((p) => LIB.has(p)).join(', ')}`);
    const fit = isNull(raw) ? q.fitPerUnit : num(id, raw, { path: id, kind: 'number', min: 0, note: '' });
    x = editBase(x, (b) => ({ ...b, components: b.components.map((c) => (c.id === id ? set(c, q, fit) : c)) }));
    changed.push(id);
  }
  return { scenario: parseScenario(x), changed };
}

let SET: ResolvedMechanismSet | undefined;
/** the default mechanism set resolved against the library (memoised): the parameters and efforts the Findings report evaluates its candidates with */
const defaultSet = (): ResolvedMechanismSet => (SET ??= resolveMechanismSet(DEFAULT_MECHANISM_SET));

/**
 * the parameters a mechanism is applied with before the caller's overrides: the default set's values merged over the library
 * defaults (so `--apply D-HARD` is the report's D-HARD), the library's alone for a mechanism outside the set
 */
export function mechanismDefaults(id: string): Record<string, number> {
  const m = MECHANISM_LIBRARY.find((q) => q.id === id);
  if (!m) throw new Error(`unknown mechanism '${id}'`);
  return { ...m.parameters, ...(defaultSet().parameters[id] ?? {}) };
}

/**
 * the mechanisms of the Mechanism library page: `apply` = library id → parameter overrides (over `mechanismDefaults`; keys from
 * `mechanismParameterKeys`; an applied one is replaced), `remove` = ids to strip (exact inverse). A mechanism whose transform would
 * not act is refused with the reason: integration parameters still missing after the merge (the audit's provisional values are
 * named), a required mechanism not applied, or a transform that left the project unchanged.
 */
export function editMechanisms(s: Scenario, o: { apply?: Record<string, Record<string, number>>; remove?: string[] }): { scenario: Scenario; changed: string[] } {
  const changed: string[] = [];
  let x = s;
  for (const id of o.remove ?? []) {
    const m = MECHANISM_LIBRARY.find((q) => q.id === id);
    if (!m) throw new Error(`unknown mechanism '${id}'`);
    if (!isStrippable(x, id)) throw new Error(`mechanism ${id} is not applied in this project (applied: ${Object.keys(x.mechanisms.applied ?? {}).join(', ') || 'none'})`);
    x = stripMechanisms(x, [id]);
    changed.push(`-${id}`);
  }
  const apply = o.apply ?? {};
  const params: Record<string, Record<string, number>> = {};
  for (const [id, given] of Object.entries(apply)) {
    const m = MECHANISM_LIBRARY.find((q) => q.id === id);
    if (!m) throw new Error(`unknown mechanism '${id}'; the library ids: ${MECHANISM_LIBRARY.filter((q) => q.apply).map((q) => q.id).join(', ')}`);
    if (!m.apply) throw new Error(`mechanism ${id} has no transform (informational): it cannot be applied`);
    const keys = mechanismParameterKeys(id);
    for (const [k, v] of Object.entries(given ?? {})) {
      if (!keys.includes(k)) throw new Error(`mechanism ${id} has no parameter '${k}' (parameters: ${keys.join(', ') || 'none'})`);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${id}.${k}: a number is required`);
    }
    const p = { ...mechanismDefaults(id), ...(given ?? {}) };
    const st = integrationStatus(m, p);
    if (!st.ready) throw new Error(`mechanism ${id} needs ${st.missing.join(', ')} before its transform acts and the default set has no value for ${st.missing.length > 1 ? 'them' : 'it'}: pass ${st.missing.length > 1 ? 'them' : 'it'}, e.g. --apply ${id}:${st.missing.map((k) => `${k}=${m.provisional?.[k] ?? '<value>'}`).join(',')}${m.provisional ? ' (the audit’s provisional values, tagged assumed)' : ''}`);
    for (const r of m.requires ?? []) if (!(r in apply) && !activeMechanisms(x).includes(r)) throw new Error(`mechanism ${id} requires ${r}, which is not applied in this project: apply ${r} first or in the same call`);
    params[id] = p;
  }
  const ids = Object.keys(apply);
  if (ids.length) {
    x = applyMechanisms(x, ids, params);
    for (const id of ids) if (!x.mechanisms.applied?.[id]) throw new Error(`mechanism ${id} was not applied: its transform left the project unchanged`);
    changed.push(...ids.map((id) => `+${id}`));
  }
  return { scenario: parseScenario(x), changed };
}

export interface ScenarioSummary {
  id?: string; name: string; template?: TopologyTemplate; variant?: string; npus: number;
  counts: { nodes: number; cabinets: number; supernodes: number; commCabinets: number; cpus: number; ubSwitches: number; ubOpticalLinks: number; scaleOutSwitches: number; scaleOutLinks: number };
  topology: { fabric?: Superpod['fabric']; fabricFill?: string; nvlinkDomainGpus?: number; superpod?: Superpod; scaleOut?: Scenario['topology']['scaleOut']; gpusPerNode?: number; cpusPerNode?: number; nodesPerRack?: number; countOverrides: { id: string; count: number; geometry: number }[] };
  fit: { overrides: Record<string, { fit: number; library: number; unit: string }>; hardFitPerNpuTotal: number; classes: number };
  mechanisms: { id: string; order: number; parameters: Record<string, number>; name: L }[];
  targets: Scenario['targets'];
  workload?: { durationDays: number; intervalS?: number; deltaS: number; ownedBy?: string };
  recovery?: { detection: { coverage: number; autoSeconds: number; timeoutSeconds: number; ownedBy?: string }; automatic: { seconds: number; successProbability: number }; manual: { seconds: number } } | { mode: string };
  /** the KPI strip of the Topology page (formula 1, nominal and derated; delivered goodput) */
  kpi: { aOp: number; aOpDerated: number; mtbfHwH: number; mttrS: number; mttrDeratedS: number; delivered: number; target: number } | null;
  koujing: string;
}

/** what a model needs to read back before and after an edit: the inputs as set, the mechanisms, the FIT overrides and the KPI strip */
export function scenarioSummary(s: Scenario): ScenarioSummary {
  const counts = computeCounts(s);
  const bom = topologyBom(s);
  const LIB = new Map(unitFaultLibrary().map((q) => [q.id, q]));
  const over = s.topology.template ? fitOverrides(s) : {};
  const sp = s.topology.superpod;
  const t = s.topology;
  const resolved = t.countOverrides ? resolveCountOverrides(geometryCounts(s), t) : { applied: [] as { id: string; geometry: number; count: number }[] };
  let kpi: ScenarioSummary['kpi'] = null;
  if (s.workload.type === 'training') {
    try {
      const tr = trainingOf(s);
      const nom = kpiForm(s, tr), der = kpiForm(deratedOf(s));
      kpi = { aOp: nom.aOp, aOpDerated: der.aOp, mtbfHwH: nom.mtbfHwH, mttrS: nom.mttrS, mttrDeratedS: der.mttrS, delivered: tr.deliveredGoodput, target: s.targets.operational ?? 0.985 };
    } catch { kpi = null; }
  }
  const applied = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id, rec]) => ({ id, order: rec.order, parameters: rec.parameters, name: MECHANISM_LIBRARY.find((m) => m.id === id)?.name ?? { zh: id, en: id } }));
  const w = s.workload.type === 'training' ? s.workload : undefined;
  const r = s.recovery;
  return {
    id: s.meta.id, name: s.meta.name, template: t.template, variant: superpodVariantOf(s), npus: counts.gpus,
    counts: { nodes: counts.nodes, cabinets: counts.racks, supernodes: counts.supernodes, commCabinets: counts.commRacks, cpus: counts.cpus, ubSwitches: counts.ubSwitches, ubOpticalLinks: counts.opticalLinks, scaleOutSwitches: counts.scaleOutSwitches, scaleOutLinks: counts.scaleOutLinks },
    topology: { fabric: sp?.fabric, fabricFill: t.fabricFill, nvlinkDomainGpus: t.nvlinkDomainGpus, superpod: sp, scaleOut: t.scaleOut, ...(sp ? {} : { gpusPerNode: t.gpusPerNode, cpusPerNode: t.cpusPerNode, nodesPerRack: t.nodesPerRack }), countOverrides: resolved.applied.map((a) => ({ id: a.id, count: a.count, geometry: a.geometry })) },
    fit: { overrides: Object.fromEntries(Object.entries(over).map(([id, fit]) => [id, { fit, library: LIB.get(id)!.fitPerUnit, unit: LIB.get(id)!.unit }])), hardFitPerNpuTotal: bom.hardFitPerNpuTotal, classes: s.components.filter((c) => LIB.has(c.id)).length },
    mechanisms: applied,
    targets: s.targets,
    workload: w ? { durationDays: w.durationDays, intervalS: w.intervalS, deltaS: w.deltaS, ownedBy: mechanismOwner(s, 'workload.deltaS') ?? mechanismOwner(s, 'workload.intervalS') } : undefined,
    recovery: r.mode === 'mixture' ? { detection: { coverage: r.detection.coverage, autoSeconds: r.detection.autoSeconds, timeoutSeconds: r.detection.timeoutSeconds, ownedBy: mechanismOwner(s, 'recovery.detection') }, automatic: { seconds: r.automatic.seconds, successProbability: r.automatic.successProbability }, manual: { seconds: r.manual.seconds } } : { mode: r.mode },
    kpi,
    koujing: 'A_op of one synchronous job per cluster-hour, nominal and derated (formula 1); MTBF_hw = 1/Σλ of the hard interruption classes, MTTR_hw = the rate-weighted mean pause; delivered goodput over the job window; FIT per unit-hour (business impact) on the unit library’s units',
  };
}

/**
 * the fault types of a project with their current and library FIT, and the appliable mechanisms with the parameters they would be
 * applied with (`mechanismDefaults`: the default set's over the library's), the keys a caller may set, the integration keys still
 * missing (`needs`: the transform refuses until they are given) and the report's effort — what `hacd scenario fields <file>` prints
 */
export function scenarioVocabulary(s?: Scenario): { fields: ScenarioField[]; classes?: { id: string; unit: string; type: string; fit: number; library: number; description: L }[]; mechanisms: { id: string; name: L; parameters: Record<string, number>; keys: string[]; needs: string[]; requires: string[]; effort: number; inSet: boolean; applied: boolean }[] } {
  const LIB = unitFaultLibrary();
  const set = defaultSet();
  const classes = s ? s.components.filter((c) => LIB.some((q) => q.id === c.id)).map((c) => { const q = LIB.find((z) => z.id === c.id)!; const over = s.topology.template ? fitOverrides(s) : {}; const fit = over[c.id] ?? (q.type === 'hard' ? toPerHour(c.failure.value, c.failure.unit) * 1e9 : q.type === 'slow' ? (c.subhealth?.ratePerHour ?? 0) * 1e9 : (c.sdc?.ratePerHour ?? 0) * 1e9); return { id: c.id, unit: q.unit, type: q.type, fit, library: q.fitPerUnit, description: q.description }; }) : undefined;
  return {
    fields: SCENARIO_FIELDS,
    ...(classes ? { classes } : {}),
    mechanisms: MECHANISM_LIBRARY.filter((m) => m.apply && m.status !== 'informational').map((m) => {
      const parameters = mechanismDefaults(m.id);
      return { id: m.id, name: m.name, parameters, keys: mechanismParameterKeys(m.id), needs: integrationStatus(m, parameters).missing, requires: [...(m.requires ?? [])], effort: set.efforts[m.id] ?? m.effort, inSet: m.id in set.efforts, applied: !!s?.mechanisms.applied?.[m.id] };
    }),
  };
}
