/**
 * v6 extension requests (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §3): what crosses to the HAC-D side when an input cannot be a
 * data update — a hardware unit kind the unit library lacks, a topology template none of the four covers, or a mechanism whose
 * effect no library transform expresses. Structural only: no internal values are needed to implement an extension (a unit's count
 * rule and classes, a template's geometry fields, a mechanism's stage and the quantity it changes). A mechanism proposal worksheet
 * becomes either a mechanism-set delta (when a person maps it onto a library id) or one of these requests.
 */
import { z } from 'zod';
import { EvidenceCardSchema } from './evidence.js';
import { MECHANISM_KINDS, STAGES, CONFIDENCES } from './fields.js';
import { LAYER_IDS } from '../layers/index.js';

const Bilingual = z.object({ zh: z.string(), en: z.string() });
export const EXTENSION_VERSION = 'hacd-extension-request-1';

export const MechanismProposalSchema = z.object({
  id: z.string().min(1),
  name: Bilingual,
  kind: z.enum(MECHANISM_KINDS),
  stage: z.enum(STAGES),
  deploy: z.enum(LAYER_IDS),
  acts: z.array(z.enum(LAYER_IDS)).min(1),
  /** library mechanism the proposal is mapped onto (a person's decision, recorded here); absent = extension request */
  mapsTo: z.string().optional(),
  /** the quantity the mechanism claims to change, as stated by its source */
  effect: z.array(z.object({ quantity: z.string().min(1), direction: z.enum(['down', 'up']), value: z.number(), unit: z.string(), source: z.string(), confidence: z.enum(CONFIDENCES), note: z.string().optional() })).default([]),
  parameters: z.array(z.object({ parameter: z.string().min(1), value: z.number(), source: z.string(), confidence: z.enum(CONFIDENCES), note: z.string().optional() })).default([]),
  prerequisites: z.array(Bilingual).default([]),
  failureModes: z.array(Bilingual).default([]),
  evidence: z.array(EvidenceCardSchema).default([]),
  source: z.string().default(''),
});
export type MechanismProposal = z.infer<typeof MechanismProposalSchema>;
export function parseMechanismProposal(input: unknown): MechanismProposal {
  const r = MechanismProposalSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid mechanism proposal: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

export const ExtensionRequestSchema = z.object({
  version: z.literal(EXTENSION_VERSION),
  id: z.string().min(1),
  kind: z.enum(['unit', 'template', 'mechanism']),
  title: Bilingual,
  summary: Bilingual,
  /** the structural description the HAC-D side implements from (kind-specific) */
  payload: z.record(z.string(), z.unknown()),
  evidence: z.array(EvidenceCardSchema).default([]),
  source: z.string(),
  requestedAt: z.string(),
  /** the engine's own message that named the extension points, when the request came from a loader error */
  trigger: z.string().optional(),
});
export type ExtensionRequest = z.infer<typeof ExtensionRequestSchema>;
export function parseExtensionRequest(input: unknown): ExtensionRequest {
  const r = ExtensionRequestSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid extension request: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}
export const extensionRequestJsonSchema = (): unknown => z.toJSONSchema(ExtensionRequestSchema, { io: 'input' });

/** a proposal without `mapsTo` → a mechanism extension request (new MechanismDef with a transform, golden, model-check) */
export function mechanismProposalRequest(p: MechanismProposal, meta: { requestedAt: string; source?: string }): ExtensionRequest {
  const { evidence, ...payload } = p;
  return {
    version: EXTENSION_VERSION,
    id: `mechanism-${p.id}`,
    kind: 'mechanism',
    title: { zh: `新机制：${p.name.zh}`, en: `New mechanism: ${p.name.en}` },
    summary: {
      zh: `${p.kind} 类机制，作用阶段 ${p.stage}，部署于 ${p.deploy}，作用于 ${p.acts.join(' / ')}；需要 MechanismDef（含 apply 变换）、golden 与 model-check。`,
      en: `a ${p.kind} mechanism on stage ${p.stage}, deployed at ${p.deploy}, acting on ${p.acts.join(' / ')}; needs a MechanismDef with an apply transform, a golden and a model-check.`,
    },
    payload, evidence, source: meta.source ?? p.source, requestedAt: meta.requestedAt,
  };
}

/** a loader error naming an unknown template / fault unit / mechanism → the matching request stub (null for other errors) */
export function extensionRequestFromError(message: string, meta: { id: string; requestedAt: string; source: string }): ExtensionRequest | null {
  const tpl = /unknown topology template "?'?([^"' ]+)/.exec(message);
  const unit = /unknown fault unit '([^']+)'/.exec(message);
  const mech = /unknown mechanism '([^']+)'/.exec(message);
  const kind = tpl ? 'template' : unit ? 'unit' : mech ? 'mechanism' : null;
  if (!kind) return null;
  const name = (tpl ?? unit ?? mech)![1];
  const T = { template: ['拓扑模板', 'topology template'], unit: ['硬件单元类型', 'hardware unit kind'], mechanism: ['机制', 'mechanism'] }[kind];
  return {
    version: EXTENSION_VERSION, id: `${kind}-${name}`, kind,
    title: { zh: `新${T[0]}：${name}`, en: `New ${T[1]}: ${name}` },
    summary: { zh: `引擎不认识${T[0]} ${name}；装载器的报错指明了扩展点。`, en: `the engine does not know ${T[1]} '${name}'; the loader's message names the extension points.` },
    payload: { name }, evidence: [], source: meta.source, requestedAt: meta.requestedAt, trigger: message,
  };
}

/** the request as a Markdown note for the HAC-D side */
export function extensionRequestMarkdown(r: ExtensionRequest, lang: 'zh' | 'en' = 'en'): string {
  const T = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const lines = [
    `# ${r.title[lang]}`, '',
    `${T('类型', 'Kind')}: ${r.kind} · ${T('来源', 'source')}: ${r.source} · ${T('日期', 'date')}: ${r.requestedAt} · ${r.version}`, '',
    r.summary[lang], '',
    `## ${T('结构描述', 'Structural description')}`, '', '```json', JSON.stringify(r.payload, null, 2), '```', '',
  ];
  if (r.trigger) lines.push(`## ${T('触发信息', 'Trigger')}`, '', '```', r.trigger, '```', '');
  if (r.evidence.length) {
    lines.push(`## ${T('证据', 'Evidence')}`, '', `| ${T('文档', 'doc')} | ${T('位置', 'loc')} | ${T('字段', 'field')} | ${T('原文值', 'value')} | ${T('单位', 'unit')} | ${T('引文', 'quote')} |`, '|---|---|---|---|---|---|');
    for (const e of r.evidence) lines.push(`| ${e.doc} | ${e.loc} | ${e.field}${e.label ? ` (${e.label})` : ''} | ${e.value_text} | ${e.unit_text} | ${e.quote.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  lines.push(`## ${T('HAC-D 侧要做的', 'What the HAC-D side implements')}`, '');
  if (r.kind === 'unit') lines.push(T('- `packages/core/src/topology/index.ts`：unitFaultLibrary 的单元条目（FAULT_UNITS、DOMAIN_UNIT、计数规则）与 topologyBom 的 BOM 行；', '- `packages/core/src/topology/index.ts`: a unit-library entry (FAULT_UNITS, DOMAIN_UNIT, the count rule) and a BOM row in topologyBom;'), T('- 该单元各故障类的目录事件；golden。', '- the catalog events of the unit\'s classes; a golden.'));
  if (r.kind === 'template') lines.push(T('- `TOPOLOGY_TEMPLATES` 条目（几何、单元、来源）；records 测试中的往返；golden。', '- a `TOPOLOGY_TEMPLATES` entry (geometry, units, sources); the records round trip in the tests; a golden.'));
  if (r.kind === 'mechanism') lines.push(T('- `MechanismDef`（含 apply 变换、参数默认值、effort）；`model-check` 技能的独立推导；golden。', '- a `MechanismDef` with its apply transform, default parameters and effort; an independent derivation through the `model-check` skill; a golden.'));
  return lines.join('\n') + '\n';
}
