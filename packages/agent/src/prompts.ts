/**
 * Prompts of the v6 extraction worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3, §6): one chunk → evidence cards of one
 * worksheet kind. The system prompt carries the role, the rules (quote verbatim, value and unit as written, no arithmetic, no unit
 * conversion, closed field list or `unmapped` + label, JSON only), the field list generated from `fieldSpecs(kind)` and two worked
 * examples (one Chinese, one English sentence). Variant 2 is the second pass of the agreement check and differs materially from
 * variant 1 — fields before rules, other wording, the examples in the other order, cards asked in document order and the rules
 * restated after the chunk — so the two passes are not one prompt sampled twice. Model-facing text is English; documents may be
 * Chinese.
 */
import { fieldSpecs, evidenceCardJsonSchema, mechanismIds, mechanismParameterKeys, mechanismById, type FieldSpec } from '@hac-d/core';
import type { Chunk, ExtractKind } from './types.js';

/** topology paths the person sets in DraftOptions (front matter), not the model */
export const TOPOLOGY_META: ReadonlySet<string> = new Set(['id', 'name', 'short', 'family', 'template', 'scenarioId', 'scenarioName']);
/** what the generic "SuperPoD geometry field" means, per field (model-facing hints) */
const TOPOLOGY_HINTS: Record<string, string> = {
  domainNpus: 'NPUs of one scale-up (UB) domain when it is smaller than the pod',
  'superpod.base': 'name of the SuperPoD preset the design is based on',
  'superpod.preset': 'preset label of the geometry',
  'superpod.fabric': 'structure of the scale-up fabric',
  'superpod.rackSwitches': 'scale-up (UB) switch chips inside one compute cabinet / rack',
  'superpod.podUplinksPerNpu': 'links per NPU from the cabinet up into the pod switch tier',
  'superpod.podSwitchRadix': 'ports of one pod-tier switch',
  'superpod.opticalLinksPerNpu': 'optical links per NPU (when different from the uplinks)',
  'superpod.opticalEnginesPerNpu': 'co-packaged / near-packaged optical engines per NPU',
  'superpod.meshRackGrid': 'cabinets per row (and column) of a cabinet full mesh',
  'superpod.backupNpusPerRack': 'spare / backup NPUs per compute cabinet',
  'superpod.npusPerNode': 'NPUs (accelerator cards) per node / server / tray',
  'superpod.cpusPerNode': 'host CPUs per node',
  'superpod.l1PerNode': 'level-1 scale-up switch chips per node',
  'superpod.nodesPerRack': 'nodes (servers, NPU trays) per compute cabinet / rack',
  'superpod.computeRacks': 'compute cabinets / racks in one SuperPoD',
  'superpod.commRacks': 'communication / interconnect / switch cabinets in one SuperPoD',
  'superpod.subPlanes': 'sub-planes of the level-2 scale-up switches',
  'superpod.l2PerSubPlane': 'level-2 switch chips per sub-plane',
  'superpod.l2Ports': 'ports of one level-2 switch chip',
  'superpod.linksPerL1': 'links per level-1 switch chip into level 2',
  'superpod.transceiversPerLink': 'optical transceivers per scale-up link',
  'superpod.rdmaPortsPerNpu': 'RDMA / RoCE ports per NPU',
  'superpod.vpcNicsPerNode': 'VPC (front-end) NICs per node',
  'scaleOut.portsPerNpu': 'scale-out (RoCE / RDMA network) ports per NPU',
  'scaleOut.planes': 'independent planes of the scale-out network',
  'scaleOut.radix': 'ports of one scale-out switch',
  'scaleOut.oversubscription': 'oversubscription ratio of the scale-out network',
  'scaleOut.transceiversPerLink': 'optical transceivers per scale-out link',
  'layers.superpod.unit': "what one SuperPoD instance is: 'supernodes' or 'nodes'",
  'layers.superpod.npus': 'NPUs in one SuperPoD / supernode',
  'layers.cabinet.npus': 'NPUs in one cabinet / rack',
  'layers.node.npus': 'NPUs in one node / server',
};

const specLine = (s: FieldSpec): string => {
  const values = s.values ? ` one of: ${s.values.join(' | ')};` : '';
  const hint = TOPOLOGY_HINTS[s.path];
  return `- ${s.path} (${s.type};${values} ${hint ? `${hint}; ` : ''}${s.about.en} / ${s.about.zh})`;
};

/** the field list of a kind, as the model reads it */
export function fieldList(kind: ExtractKind): string {
  if (kind === 'topology') return fieldSpecs('topology').filter((s) => !TOPOLOGY_META.has(s.path)).map(specLine).join('\n');
  if (kind === 'device-fit') {
    const cols = fieldSpecs('device-fit').map(specLine).join('\n');
    return [
      'Device failure-rate rows. Every card has "field": "unmapped", "label" = the device / part name as written,',
      '"value_text" = the failure rate as written, "unit_text" = its unit as written (FIT, /10^6 h, per hour, MTBF hours, AFR, %/year ...).',
      'The columns these cards will fill (for orientation; do not use them as field paths):',
      cols,
    ].join('\n');
  }
  const groups: string[] = [];
  for (const id of mechanismIds()) {
    const keys = mechanismParameterKeys(id);
    if (!keys.length) continue;
    const m = mechanismById(id);
    groups.push(`- ${id} (${m.name.en} / ${m.name.zh}): ${keys.map((k) => `parameters.${id}.${k}`).join(', ')}`);
  }
  return ['Mechanism parameters (number). Field path = parameters.<MECHANISM-ID>.<key>:', ...groups].join('\n');
}

interface Example { lang: 'zh' | 'en'; text: string; cards: Record<string, string>[] }
const card = (field: string, value_text: string, unit_text: string, quote: string, extra: Record<string, string> = {}) =>
  ({ doc: 'example.md', loc: 'L1-1', field, ...extra, value_text, unit_text, quote, model_confidence: 'high' });

/** two worked examples per kind, from public facts (topology) or clearly illustrative values (device-fit, mechanisms) */
function examples(kind: ExtractKind): Example[] {
  switch (kind) {
    case 'topology': return [
      {
        lang: 'zh', text: 'Atlas 950 超节点：每柜 64 卡，16 个计算柜 + 4 个 UB 互联柜。',
        cards: [
          card('layers.cabinet.npus', '64', '卡', '每柜 64 卡'),
          card('superpod.computeRacks', '16', '个', '16 个计算柜'),
          card('superpod.commRacks', '4', '个', '4 个 UB 互联柜'),
        ],
      },
      {
        lang: 'en', text: 'Each CloudMatrix384 node integrates 8 Ascend 910C NPUs, 4 Kunpeng CPUs and 7 on-board UB switch chips; the supernode has 384 NPUs.',
        cards: [
          card('superpod.npusPerNode', '8', 'NPUs', '8 Ascend 910C NPUs'),
          card('superpod.cpusPerNode', '4', 'CPUs', '4 Kunpeng CPUs'),
          card('superpod.l1PerNode', '7', 'UB switch chips', '7 on-board UB switch chips'),
          card('layers.superpod.npus', '384', 'NPUs', 'the supernode has 384 NPUs'),
        ],
      },
    ];
    case 'device-fit': return [
      {
        lang: 'zh', text: '（示例数值）DDR5 内存条失效率为 120 FIT，电源模块 MTBF 为 50 万小时。',
        cards: [
          card('unmapped', '120', 'FIT', 'DDR5 内存条失效率为 120 FIT', { label: 'DDR5 内存条' }),
          card('unmapped', '50 万', '小时', '电源模块 MTBF 为 50 万小时', { label: '电源模块' }),
        ],
      },
      {
        lang: 'en', text: '(illustrative values) The 800G optical transceiver has an annualised failure rate of 0.5 %/year.',
        cards: [card('unmapped', '0.5', '%/year', 'annualised failure rate of 0.5 %/year', { label: '800G optical transceiver' })],
      },
    ];
    case 'mechanisms': return [
      {
        lang: 'zh', text: '（示例数值）硬故障检测覆盖率 95%，平均检测时间 30 秒。',
        cards: [
          card('parameters.D-HARD.coverage', '95', '%', '硬故障检测覆盖率 95%'),
          card('parameters.D-HARD.detectSeconds', '30', '秒', '平均检测时间 30 秒'),
        ],
      },
      {
        lang: 'en', text: '(illustrative values) Step replay succeeds in 90% of attempts and takes 120 s when it succeeds.',
        cards: [
          card('parameters.R-REPLAY.success', '90', '%', 'succeeds in 90% of attempts'),
          card('parameters.R-REPLAY.successSeconds', '120', 's', 'takes 120 s when it succeeds'),
        ],
      },
    ];
  }
}
const exampleBlock = (ex: Example, n: number, quote: (t: string) => string) =>
  `Example ${n} (${ex.lang === 'zh' ? 'Chinese' : 'English'} source):\n${quote(ex.text)}\nAnswer:\n${JSON.stringify({ cards: ex.cards })}`;

const KIND_LABEL: Record<ExtractKind, string> = {
  topology: 'cluster topology (SuperPoD geometry, scale-out network, layer sizes, hardware counts)',
  'device-fit': 'device / part failure rates (one card per device and stated rate)',
  mechanisms: 'fault-management mechanism parameters (detection coverage and time, recovery success and time, ...)',
};

const rules = (maxQuote: number): string[] => [
  `Copy "quote" character for character from the chunk: a short span (at most ${maxQuote} characters) that contains the value. Never paraphrase or translate it.`,
  '"value_text" is the value exactly as written inside the quote (keep digits, separators, full-width digits, Chinese numerals and multipliers such as 万 as they are). "unit_text" is the unit exactly as written, or "" when none is stated.',
  'No arithmetic: never add, multiply, divide, sum or derive. A value the chunk does not state literally gets no card.',
  'No unit conversion: do not turn % into fractions, minutes into seconds, MTBF into FIT or anything else.',
  'Use only field paths from the list. A relevant fact with no matching path gets "field": "unmapped" and a short "label".',
  '"model_confidence" is one of high | medium | low | unsure (how sure you are that the card is right; it is advisory).',
  'Output JSON only, exactly {"cards":[...]}, no prose and no comments. When the chunk states nothing relevant, output {"cards":[]}.',
];

/** JSON Schema of the answer `{ cards: EvidenceCard[] }`, from the core card schema (defaults and $schema dropped for servers) */
export function cardsJsonSchema(): unknown {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => k !== '$schema' && k !== 'default').map(([k, v]) => [k, strip(v)]));
    return x;
  };
  return { type: 'object', properties: { cards: { type: 'array', items: strip(evidenceCardJsonSchema()) } }, required: ['cards'], additionalProperties: false };
}

export function buildPrompts(kind: ExtractKind, chunk: Chunk, variant: 1 | 2, maxQuoteChars = 400): { system: string; user: string; jsonSchema: unknown } {
  const R = rules(maxQuoteChars), ex = examples(kind), fields = fieldList(kind);
  const cardShape = '{"doc","loc","field","label"?,"value_text","unit_text","quote","model_confidence"}';
  if (variant === 1) {
    const system = [
      `You are an extraction worker for HAC-D, a deterministic reliability engine. You read one chunk of a source document about ${KIND_LABEL[kind]} and write evidence cards: one small JSON object ${cardShape} per stated fact. HAC-D checks every quote against the chunk and drops cards it cannot find.`,
      '',
      'Rules:',
      ...R.map((r, i) => `${i + 1}. ${r}`),
      '',
      'Field paths:',
      fields,
      '',
      ...ex.map((e, i) => exampleBlock(e, i + 1, (t) => `"""${t}"""`)),
    ].join('\n');
    const user = [
      `Document: ${chunk.doc}`,
      `Location: ${chunk.loc}`,
      `Chunk ${chunk.id}:`,
      '"""',
      chunk.text,
      '"""',
      '',
      'Write the evidence cards of this chunk as {"cards":[...]}.',
    ].join('\n');
    return { system, user, jsonSchema: cardsJsonSchema() };
  }
  const system = [
    `Task: turn a passage into evidence cards for a reliability model. Topic: ${KIND_LABEL[kind]}.`,
    '',
    'Allowed "field" values (anything else must be "unmapped" with a "label"):',
    fields,
    '',
    `A card is ${cardShape}. Work through the passage from top to bottom and emit the cards in the order their facts appear.`,
    '',
    'Constraints:',
    ...[R[2], R[3], R[0], R[1], R[4], R[5], R[6]].map((r) => `- ${r}`),
    '',
    ...[...ex].reverse().map((e, i) => exampleBlock(e, i + 1, (t) => `----- PASSAGE -----\n${t}\n----- END -----`)),
  ].join('\n');
  const user = [
    `Source file: ${chunk.doc} (${chunk.loc}), passage ${chunk.index}`,
    '----- PASSAGE -----',
    chunk.text,
    '----- END -----',
    '',
    'List the cards in document order. Reminder: the quote is copied verbatim from the passage and contains value_text; value and unit exactly as written; no arithmetic and no unit conversion; only the allowed field paths or "unmapped" with a label; answer with {"cards":[...]} and nothing else.',
  ].join('\n');
  return { system, user, jsonSchema: cardsJsonSchema() };
}
