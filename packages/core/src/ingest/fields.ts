/**
 * v6 ingest (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5): the closed vocabularies and field paths of the worksheets. Everything a
 * person or a model may write into a worksheet is drawn from these lists, which are generated from the schemas rather than typed a
 * second time, so the worksheet parser, the validator, the extraction prompts and the templates agree with the records.
 */
import { z } from 'zod';
import { SuperpodSchema, ScaleOutSchema, SUPERPOD_PRESETS, ConfidenceSchema } from '../scenario/schema.js';
import { COUNT_OVERRIDE_ROWS } from '../scenario/build.js';
import { FAULT_UNITS, TOPOLOGY_TEMPLATE_IDS, unitFaultLibrary } from '../topology/index.js';
import { MECHANISM_LIBRARY, mechanismById } from '../mechanisms/index.js';
import { LAYER_IDS } from '../layers/index.js';

export const WORKSHEET_VERSION = 'hacd-worksheet-1';
export const WORKSHEET_KINDS = ['topology', 'fault-rates', 'mechanisms', 'mechanism-proposal', 'device-fit', 'koujing-mapping'] as const;
export type WorksheetKind = (typeof WORKSHEET_KINDS)[number];

export const CONFIDENCES = ConfidenceSchema.options;
export const RECORD_LAYERS = ['superpod', 'cabinet', 'node'] as const;
export const SUPERPOD_UNITS = ['supernodes', 'nodes'] as const;
export const STAGES = ['detection', 'rung', 'automatic', 'manual', 'checkpoint', 'sdc', 'rate', 'local', 'none'] as const;
export const MECHANISM_KINDS = ['detect', 'recover', 'checkpoint', 'physical'] as const;
export const VERDICTS = ['reference', 'candidate', 'goodput', 'pruned', 'capability'] as const;
export const FABRICS = ['two-level', 'mesh-clos', 'mesh-4d', 'blade-clos'] as const;
export const PRESET_KEYS: readonly string[] = Object.keys(SUPERPOD_PRESETS);
export const RECOVERY_FIELDS = ['detection.coverage', 'detection.autoSeconds', 'detection.timeoutSeconds', 'automatic.seconds', 'automatic.successProbability', 'manual.seconds'] as const;
export const LEVER_IDS = ['auto', 'success', 'manual'] as const;
export const DERATE_FIELDS = ['coverageDelta', 'successDelta', 'timeFactor', 'reductionFactor'] as const;
/** how a device failure rate was obtained; the confidence policy of the normaliser maps it to HAC-D's confidence */
export const SOURCE_TYPES = ['field', 'vendor', 'prediction', 'paper', 'assumed'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
/** rate units a device table may use: FIT, failures per 10⁶ h, per hour, MTBF hours, annualised failure fraction */
export const DEVICE_RATE_UNITS = ['FIT', 'per_1e6_h', 'per_h', 'mtbf_h', 'afr'] as const;
export type DeviceRateUnit = (typeof DEVICE_RATE_UNITS)[number];
export const IMPACT_CONFIDENCES = ['measured', 'derived', 'assumed'] as const;

export const PRESET_FIELD_VALUES: readonly string[] = (SuperpodSchema.shape.preset as unknown as { unwrap: () => { options: string[] } }).unwrap().options;
/** enumerated geometry fields and their values (the rest are numbers) */
export const GEOMETRY_ENUMS: Record<string, readonly string[]> = { fabric: FABRICS, preset: PRESET_FIELD_VALUES };
export const GEOMETRY_FIELDS: readonly string[] = Object.keys(SuperpodSchema.shape);
export const SCALEOUT_FIELDS: readonly string[] = Object.keys(ScaleOutSchema.shape);
export const COUNT_ROWS: readonly string[] = Object.keys(COUNT_OVERRIDE_ROWS);
export const TEMPLATES: readonly string[] = TOPOLOGY_TEMPLATE_IDS;
export const UNITS: readonly string[] = FAULT_UNITS;

export interface FieldSpec {
  path: string;
  type: 'int' | 'number' | 'enum' | 'string' | 'bilingual';
  values?: readonly string[];
  about: { zh: string; en: string };
}

const unwrap = (s: z.ZodType): z.ZodType => {
  let t: z.ZodType = s;
  // ZodDefault / ZodOptional carry the inner type in `unwrap`
  while (typeof (t as unknown as { unwrap?: () => z.ZodType }).unwrap === 'function') t = (t as unknown as { unwrap: () => z.ZodType }).unwrap();
  return t;
};
/** number vs integer, read from the schema by probing (a fractional value fails an integer field) */
const numType = (s: z.ZodType): 'int' | 'number' => (unwrap(s).safeParse(1.5).success ? 'number' : 'int');

/** the 60 class ids of the unit library (54 catalog events plus the six RoCE analogues) */
export const classIds = (): string[] => unitFaultLibrary().map((f) => f.id);
/** mechanism ids of the library (built-in and audited) */
export const mechanismIds = (): string[] => MECHANISM_LIBRARY.map((m) => m.id);
/**
 * the parameter keys a mechanism's transform reads: its library defaults, the integration parameters the audit leaves to be
 * measured (`integrationNeeds`, with `provisional` values) and the optional keys it declares in `reads` — anything else in a
 * set's `parameters` would change nothing
 */
export function mechanismParameterKeys(id: string): string[] {
  const m = mechanismById(id);
  return [...new Set([...Object.keys(m.parameters), ...Object.keys(m.provisional ?? {}), ...(m.integrationNeeds ?? []), ...(m.reads ?? [])])];
}

const B = (zh: string, en: string) => ({ zh, en });

/** the field paths of a worksheet kind, for prompts, templates and the parser */
export function fieldSpecs(kind: WorksheetKind): FieldSpec[] {
  switch (kind) {
    case 'topology': {
      const out: FieldSpec[] = [
        { path: 'id', type: 'string', about: B('记录 id（内部 id，与公开记录不同）', 'record id (an internal id beside the public records)') },
        { path: 'name', type: 'bilingual', about: B('名称', 'name') },
        { path: 'short', type: 'bilingual', about: B('短名', 'short name') },
        { path: 'family', type: 'string', about: B('芯片家族', 'chip family') },
        { path: 'template', type: 'enum', values: TEMPLATES, about: B('拓扑模板', 'topology template') },
        { path: 'scenarioId', type: 'string', about: B('生成场景的 id', 'id of the generated scenario') },
        { path: 'scenarioName', type: 'string', about: B('场景名模式，{name} {npus}', 'scenario name pattern, {name} {npus}') },
        { path: 'domainNpus', type: 'int', about: B('一个 UB 域的 NPU 数（缺省 = pod）', 'NPUs of one UB domain (absent = the pod)') },
        { path: 'superpod.base', type: 'enum', values: PRESET_KEYS, about: B('SuperPoD 预设', 'SuperPoD preset') },
      ];
      for (const f of GEOMETRY_FIELDS) {
        const s = SuperpodSchema.shape[f as keyof typeof SuperpodSchema.shape] as z.ZodType;
        out.push(GEOMETRY_ENUMS[f]
          ? { path: `superpod.${f}`, type: 'enum', values: GEOMETRY_ENUMS[f], about: f === 'fabric' ? B('UB 域结构', 'UB fabric') : B('几何预设名（覆盖 base 的标签）', 'preset label of the geometry') }
          : { path: `superpod.${f}`, type: numType(s), about: B('SuperPoD 几何字段', 'SuperPoD geometry field') });
      }
      for (const f of SCALEOUT_FIELDS) out.push({ path: `scaleOut.${f}`, type: numType(ScaleOutSchema.shape[f as keyof typeof ScaleOutSchema.shape] as z.ZodType), about: B('scale-out 设计字段', 'scale-out design field') });
      out.push({ path: 'layers.superpod.unit', type: 'enum', values: SUPERPOD_UNITS, about: B('SuperPoD 层实例', 'SuperPoD layer instance') });
      for (const l of RECORD_LAYERS) out.push({ path: `layers.${l}.npus`, type: 'number', about: B(`${l} 层每实例 NPU 数`, `NPUs per ${l} instance`) });
      for (const r of COUNT_ROWS) {
        out.push({ path: `countOverrides.${r}.count`, type: 'number', about: B('用户硬件计数', 'user hardware count') });
        out.push({ path: `countOverrides.${r}.npus`, type: 'number', about: B('该计数对应的 NPU 数', 'NPUs the count refers to') });
      }
      return out;
    }
    case 'fault-rates':
      return [
        { path: 'basis', type: 'enum', values: ['per-unit', 'per-card'], about: B('口径：每单元或每卡', 'basis: per unit or per card') },
        ...classIds().map((c) => ({ path: `rates.${c}.fit`, type: 'number' as const, about: B('业务影响 FIT', 'business-impact FIT') })),
      ];
    case 'mechanisms': {
      const out: FieldSpec[] = [];
      for (const id of mechanismIds()) {
        for (const k of mechanismParameterKeys(id)) out.push({ path: `parameters.${id}.${k}`, type: 'number', about: B('机制参数', 'mechanism parameter') });
        out.push({ path: `verdicts.${id}`, type: 'enum', values: VERDICTS, about: B('机制判定', 'mechanism verdict') });
        out.push({ path: `efforts.${id}`, type: 'number', about: B('实施工作量', 'implementation effort') });
      }
      for (const f of RECOVERY_FIELDS) out.push({ path: `recovery.${f}`, type: 'number', about: B('恢复基线', 'recovery baseline') });
      return out;
    }
    case 'mechanism-proposal':
      return [
        { path: 'name', type: 'bilingual', about: B('机制名', 'mechanism name') },
        { path: 'kind', type: 'enum', values: MECHANISM_KINDS, about: B('类型', 'kind') },
        { path: 'stage', type: 'enum', values: STAGES, about: B('作用阶段', 'stage') },
        { path: 'deploy', type: 'enum', values: LAYER_IDS, about: B('部署层', 'deployment layer') },
        { path: 'acts', type: 'enum', values: LAYER_IDS, about: B('作用层（可多个）', 'acted-on layers (several)') },
        { path: 'mapsTo', type: 'enum', values: mechanismIds(), about: B('映射到的库机制（人工决定）', 'library mechanism it maps to (a person decides)') },
      ];
    case 'device-fit':
      return [
        { path: 'device', type: 'string', about: B('器件 / 部件', 'device / part') },
        { path: 'value', type: 'number', about: B('失效率数值（原文）', 'failure-rate value as written') },
        { path: 'unit', type: 'enum', values: DEVICE_RATE_UNITS, about: B('单位', 'unit') },
        { path: 'sourceType', type: 'enum', values: SOURCE_TYPES, about: B('来源类型', 'source type') },
      ];
    case 'koujing-mapping':
      return [
        { path: 'device', type: 'string', about: B('器件 / 部件', 'device / part') },
        { path: 'unit', type: 'enum', values: UNITS, about: B('故障单元', 'fault unit') },
        { path: 'class', type: 'enum', values: classIds(), about: B('故障类（目录事件 id）', 'fault class (catalog event id)') },
        { path: 'devicesPerUnit', type: 'number', about: B('每单元器件数', 'devices per unit') },
        { path: 'impactFactor', type: 'number', about: B('影响因子：器件失效成为该类业务影响事件的比例', 'impact factor: share of device failures that become a business-impact event of the class') },
        { path: 'impactConfidence', type: 'enum', values: IMPACT_CONFIDENCES, about: B('影响因子的置信', 'confidence of the factor') },
      ];
  }
}

/** the closed vocabularies as one object (for prompts and the `hacd ingest fields` command) */
export function vocabularies(): Record<string, readonly string[]> {
  return {
    confidence: CONFIDENCES, faultUnit: UNITS, template: TEMPLATES, preset: PRESET_KEYS, fabric: FABRICS, layer: LAYER_IDS, stage: STAGES,
    mechanismKind: MECHANISM_KINDS, verdict: VERDICTS, sourceType: SOURCE_TYPES, deviceRateUnit: DEVICE_RATE_UNITS, impactConfidence: IMPACT_CONFIDENCES,
    classId: classIds(), mechanismId: mechanismIds(), countRow: COUNT_ROWS,
  };
}
