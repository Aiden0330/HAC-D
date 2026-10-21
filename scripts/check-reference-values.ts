/**
 * Check that HAC-D's built-in fault data and mechanism parameters are the values of the two upstream reliability repositories:
 *  - github.com/zy009197/ai-cluster-reliability (local copy ai-cluster-reliability-main/, catalogs/review-2026-10-09)
 *  - github.com/lzq0927/remap (local clone remap/remap-latest/: references/expert-review-2026-10-09 and the 16-mechanism package)
 * Compared: the 54 events (FIT per card-hour, class, domain, description, scope, persistence, replay / process / elastic flags),
 * the mechanism parameters (mechanism-policy.json) and applicability lists (mechanisms.json eventIds), the baseline job and
 * recovery settings (reference.cjs config = ReMAP config.json), the 16 audited mechanisms (JSON), and HAC-D's per-unit
 * conversion (fitPerUnit = fitPerCard × cards per unit; calibration back to the catalog at the CloudMatrix384 geometry).
 * Both local folders are git-ignored drops; update them first (git -C remap/remap-latest pull; re-download the other).
 * Usage: node --import tsx scripts/check-reference-values.ts [--json out.json]
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REFERENCE_EVENTS } from '../packages/core/src/scenario/referenceEvents.js';
import { mechanismById } from '../packages/core/src/mechanisms/index.js';
import { unitFaultLibrary, topologyScenario, topologyBom, calibrationScenario, TOPOLOGY_TEMPLATE_IDS } from '../packages/core/src/topology/index.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const REF = 'ai-cluster-reliability-main/catalogs/review-2026-10-09';
const RMP = 'remap/remap-latest/references/expert-review-2026-10-09';
const AUDIT_RMP = 'remap/remap-latest/references/新可靠性机制库-单点量化交付包/新可靠性机制库-单点量化.json';
const AUDIT_HACD = 'packages/core/data/mechanism-audit.json';
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
type Check = { id: string; pass: boolean; detail: string; mismatches?: unknown[] };
const checks: Check[] = [];
const add = (id: string, pass: boolean, detail: string, mismatches?: unknown[]) => { checks.push({ id, pass, detail, mismatches }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}: ${detail}`); if (!pass && mismatches?.length) console.log('      ' + JSON.stringify(mismatches.slice(0, 12))); };

for (const p of [REF, RMP]) if (!existsSync(`${p}/inputs.json`)) { console.error(`missing ${p}/inputs.json — fetch the repositories first`); process.exit(2); }

/* 1. the two repositories carry the same catalog files */
const files = ['inputs.json', 'mechanisms.json', 'mechanism-policy.json', 'engine.cjs', 'reference.cjs'];
const diff = files.filter((f) => sha(`${REF}/${f}`) !== sha(`${RMP}/${f}`));
add('repos.identical', diff.length === 0, diff.length ? `files differ between the repositories: ${diff.join(', ')}` : `${files.join(', ')} are byte-identical in both repositories (sha256 inputs.json ${sha(`${REF}/inputs.json`).slice(0, 12)})`);

/* 2. the 54 events */
const inputs = json(`${REF}/inputs.json`);
const TYPE: Record<string, string> = { 中断: 'hard', 亚健康: 'slow', 静默: 'sdc' };
const legacy = new Map<string, Record<string, unknown>>(inputs.legacy.events.map((e: Record<string, unknown>) => [e.id as string, e]));
const repoEvents = inputs.current.events.map((e: Record<string, unknown>) => { const o = legacy.get(e.id as string)!; return { id: e.id, fit: e.fit, type: o.type, typeCurrent: TYPE[e.type as string], domain: e.domain, description: e.description, scope: o.scope, persistence: o.persistence, replay: o.replay, process: o.process, elastic: o.elastic }; });
const hacd = new Map(REFERENCE_EVENTS.map((e) => [e.id, e]));
const evMis: unknown[] = [];
for (const r of repoEvents) {
  const h = hacd.get(r.id as string);
  if (!h) { evMis.push({ id: r.id, missing: 'not in HAC-D' }); continue; }
  for (const k of ['type', 'domain', 'description', 'scope', 'persistence', 'replay', 'process', 'elastic'] as const) if ((h as unknown as Record<string, unknown>)[k] !== r[k]) evMis.push({ id: r.id, field: k, hacd: (h as unknown as Record<string, unknown>)[k], repo: r[k] });
  if (r.typeCurrent !== r.type) evMis.push({ id: r.id, field: 'type (current vs legacy)', current: r.typeCurrent, legacy: r.type });
  if (!same(h.fit, r.fit as number)) evMis.push({ id: r.id, field: 'fit', hacd: h.fit, repo: r.fit });
}
for (const id of hacd.keys()) if (!repoEvents.some((r: { id: string }) => r.id === id)) evMis.push({ id, missing: 'not in the repositories' });
const classFit = (list: { type: unknown; fit: unknown }[], t: string) => list.filter((e) => e.type === t).reduce((a, e) => a + (e.fit as number), 0);
add('events', evMis.length === 0, `${repoEvents.length} repository events vs ${REFERENCE_EVENTS.length} in HAC-D; FIT, class, domain, description, scope, persistence and the three recovery flags compared; class FIT per card hard ${classFit(REFERENCE_EVENTS, 'hard').toFixed(6)} / slow ${classFit(REFERENCE_EVENTS, 'slow').toFixed(6)} / sdc ${classFit(REFERENCE_EVENTS, 'sdc').toFixed(6)} (repository ${classFit(repoEvents, 'hard').toFixed(6)} / ${classFit(repoEvents, 'slow').toFixed(6)} / ${classFit(repoEvents, 'sdc').toFixed(6)}; totalFit ${inputs.current.totalFit})`, evMis);

/* 3. mechanism parameters (mechanism-policy.json) */
const policy = json(`${REF}/mechanism-policy.json`) as Record<string, Record<string, number>>;
const mMis: unknown[] = [];
for (const [id, params] of Object.entries(policy)) {
  const m = mechanismById(id);
  for (const [k, v] of Object.entries(params)) if (!same((m.parameters as Record<string, number>)[k], v)) mMis.push({ id, key: k, hacd: (m.parameters as Record<string, number>)[k], repo: v });
}
add('mechanisms.parameters', mMis.length === 0, `${Object.keys(policy).length} mechanisms of mechanism-policy.json (${Object.keys(policy).join(', ')}): every parameter equal in HAC-D's library`, mMis);

/* 4. applicability (mechanisms.json eventIds) against HAC-D's event flags */
const mech = json(`${REF}/mechanisms.json`).mechanisms as { id: string; eventIds?: string[] }[];
const flagOf: Record<string, (e: (typeof REFERENCE_EVENTS)[number]) => boolean> = {
  'D-HARD': (e) => e.type === 'hard', 'D-SLOW': (e) => e.type === 'slow', 'D-SDC': (e) => e.type === 'sdc', 'R-SDC': (e) => e.type === 'sdc',
  'R-REPLAY': (e) => e.type === 'hard' && e.replay, 'R-PROCESS': (e) => e.type === 'hard' && e.process, 'R-ELASTIC': (e) => e.type === 'hard' && e.elastic,
};
const aMis: unknown[] = [];
for (const m of mech) {
  const f = flagOf[m.id];
  if (!f || !m.eventIds) continue;
  const mine = new Set(REFERENCE_EVENTS.filter(f).map((e) => e.id));
  const theirs = new Set(m.eventIds);
  const onlyMine = [...mine].filter((x) => !theirs.has(x)), onlyTheirs = [...theirs].filter((x) => !mine.has(x));
  if (onlyMine.length || onlyTheirs.length) aMis.push({ id: m.id, onlyHacd: onlyMine, onlyRepo: onlyTheirs });
}
add('mechanisms.applicability', aMis.length === 0, `event lists of ${Object.keys(flagOf).join(', ')} in mechanisms.json equal the events HAC-D applies them to`, aMis);

/* 5. baseline job and recovery settings (reference.cjs config = ReMAP config.json) */
const cfg = json(`${RMP}/config.json`);
const base = topologyScenario('a3-ub384', 10000, { mechanisms: [] });
const sh = base.components.find((c) => c.subhealth)!.subhealth!;
const w = base.workload.type === 'training' ? base.workload : undefined;
const rec = base.recovery.mode === 'mixture' ? base.recovery : undefined;
const pairs: [string, number | string | undefined, number | string][] = [
  ['checkpointComputeSeconds', w?.intervalS, cfg.checkpointComputeSeconds], ['checkpointSaveSeconds', w?.deltaS, cfg.checkpointSaveSeconds],
  ['recoveryAttemptSeconds', rec?.automatic.seconds, cfg.recoveryAttemptSeconds], ['recoverySuccess', rec?.automatic.successProbability, cfg.recoverySuccess],
  ['manualAdditionalSeconds', rec?.manual.seconds, cfg.manualAdditionalSeconds], ['detectProbability', rec?.detection.coverage, cfg.detectProbability],
  ['detectSeconds', rec?.detection.autoSeconds, cfg.detectSeconds], ['timeoutSeconds', rec?.detection.timeoutSeconds, cfg.timeoutSeconds],
  ['slowDetectProbability', sh.detection?.probability, cfg.slowDetectProbability], ['slowDetectHours', sh.detection?.delayHours, cfg.slowDetectHours],
  ['slowLifetimeHours', sh.durationHours, cfg.slowLifetimeHours], ['slowLoss', 1 - sh.performance, cfg.slowLoss],
  ['sdcDelayHours', base.sdc.fallbackDelayHours, cfg.sdcDelayHours], ['sdcImmediateProbability', base.sdc.detection.coverage, cfg.sdcImmediateProbability],
  ['horizonHours', w ? w.durationDays * 24 : undefined, cfg.horizonHours], ['terminalRule', base.sdc.terminalRule, cfg.terminalRule],
];
const bMis = pairs.filter(([k, h, r]) => (typeof r === 'number' ? !(typeof h === 'number' && same(h, r)) : !(String(h ?? 'retain-last-clean').startsWith('retain') && String(r).startsWith('retain')))).map(([k, h, r]) => ({ key: k, hacd: h, repo: r }));
add('baseline', bMis.length === 0, `${pairs.length} job / recovery settings of ReMAP config.json (= reference.cjs config) equal HAC-D's topology scenarios`, bMis);

/* 6. the 16 audited mechanisms (JSON copied into HAC-D) */
if (existsSync(AUDIT_RMP)) {
  const eq = sha(AUDIT_RMP) === sha(AUDIT_HACD);
  let detail = eq ? 'byte-identical' : 'differs';
  if (!eq) { const a = json(AUDIT_RMP), b = json(AUDIT_HACD); detail = `differs (ReMAP ${JSON.stringify(a).length} chars, HAC-D ${JSON.stringify(b).length}; keys ${Object.keys(a).join('/')} vs ${Object.keys(b).join('/')})`; }
  add('audit16', eq, `ReMAP 新可靠性机制库-单点量化.json vs ${AUDIT_HACD}: ${detail}`);
}

/* 7. HAC-D's per-unit conversion is derived from the catalog values and returns them at the CloudMatrix384 geometry */
const lib = unitFaultLibrary();
const uMis = lib.filter((f) => { const e = hacd.get(f.eventId); return !e || !same(f.fitPerCard, e.fit) || !same(f.fitPerUnit, f.fitPerCard * f.cardsPerUnit); }).map((f) => f.id);
const cal = topologyBom(calibrationScenario(384 * 26)); // pod-aligned size: partial pods round cabinets and L2 chips up (+0.013 % at 10,000)
const cal10k = topologyBom(calibrationScenario(10000));
add('units.derived', uMis.length === 0, `${lib.length} unit fault types: fitPerCard = catalog FIT and fitPerUnit = fitPerCard × cards per unit (CloudMatrix384 geometry)`, uMis);
add('units.calibration', Math.abs(cal.hardFitPerNpuTotal - classFit(repoEvents, 'hard')) < 1e-9 * classFit(repoEvents, 'hard'), `CloudMatrix384 geometry without scale-out at 9,984 NPUs (26 whole pods): ${cal.hardFitPerNpuTotal.toFixed(6)} hard FIT per NPU = catalog ${classFit(repoEvents, 'hard').toFixed(6)}; at 10,000 NPUs ${cal10k.hardFitPerNpuTotal.toFixed(6)} (partial last pod rounded up)`);

/* 8. what the topology templates make of it (information, not a pass / fail) */
const perTemplate = TOPOLOGY_TEMPLATE_IDS.map((t) => { const b = topologyBom(topologyScenario(t, 10000)); return { template: t, hardFitPerNpu: +b.hardFitPerNpuTotal.toFixed(3), vsCatalog: +(b.hardFitPerNpuTotal / classFit(repoEvents, 'hard') - 1).toFixed(4), byUnit: Object.fromEntries(Object.entries(b.hardFitPerNpu).map(([k, v]) => [k, +(v as number).toFixed(3)])) }; });
console.log('INFO  per-NPU hard FIT of the topology templates at 10,000 NPUs (catalog 3,333.333 per card):');
for (const r of perTemplate) console.log(`      ${r.template.padEnd(9)} ${r.hardFitPerNpu.toFixed(1).padStart(8)} (${(r.vsCatalog * 100).toFixed(2)} %)  ${JSON.stringify(r.byUnit)}`);

const out = { generated: new Date().toISOString(), sources: { reference: REF, remap: RMP }, checks, perTemplate };
const o = flag('json');
if (o) writeFileSync(o, JSON.stringify(out, null, 1));
process.exit(checks.every((c) => c.pass) ? 0 : 1);
