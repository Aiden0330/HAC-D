/**
 * v5.8 the numerical domain of every mechanism parameter key (external method & code review 2026-10-29, P1-③): before v5.8 a
 * mechanism set, a worksheet, a project edit or a model extraction could carry `success = 1.5` or `failureSeconds = −9` and the
 * transform used it (A_op 99.92 % at 10k from a negative pause). One registry by key, read by the mechanism-set schema, the ingest
 * gate, the field specs of the worksheets and the transforms themselves (MECHANISM_LIBRARY wraps every `apply`), so no path into the
 * engine skips it. Probabilities, coverages and shares lie in [0, 1]; times in seconds are ≥ 0 (the checkpoint compute interval
 * > 0); an overhead is a fraction of the throughput below 1; a compression ratio is ≥ 1; a domain count is ≥ 1; the rate and
 * duration factors of a sweep and the remaining bandwidth are multipliers in [0, 1] ((0, 1] for the bandwidth). A key outside the
 * registry must still be a finite number. The derating (`derateParameters`) maps a value inside its domain to a value inside it.
 */

export type ParameterKind = 'probability' | 'share' | 'seconds' | 'fraction' | 'factor' | 'ratio' | 'count';
export interface ParameterDomain {
  kind: ParameterKind;
  min: number;
  max: number;
  /** the bound itself is outside the domain */
  minExclusive?: boolean;
  maxExclusive?: boolean;
  /** what the value is, for messages and worksheet templates */
  about: { zh: string; en: string };
}

const PROBABILITY: ParameterDomain = { kind: 'probability', min: 0, max: 1, about: { zh: '概率 0–1', en: 'probability, 0–1' } };
const SHARE: ParameterDomain = { kind: 'share', min: 0, max: 1, about: { zh: '份额 0–1', en: 'share, 0–1' } };
const SECONDS: ParameterDomain = { kind: 'seconds', min: 0, max: Infinity, about: { zh: '秒，≥ 0', en: 'seconds, ≥ 0' } };
const FACTOR: ParameterDomain = { kind: 'factor', min: 0, max: 1, about: { zh: '乘数 0–1', en: 'multiplier, 0–1' } };

/** the domain by parameter key (MECHANISM_LIBRARY parameters, provisional keys, integration needs and reads) */
export const PARAMETER_DOMAINS: Record<string, ParameterDomain> = {
  coverage: PROBABILITY, success: PROBABILITY, recall: PROBABILITY, precision: PROBABILITY,
  detectionTarget: PROBABILITY, upstreamDetection: PROBABILITY, conditionalMissDetection: PROBABILITY, manualProbabilityTarget: PROBABILITY,
  eligibleShare: SHARE, riskShare: SHARE, share: SHARE, exposedCommunicationFraction: SHARE,
  reduction: { kind: 'fraction', min: 0, max: 1, about: { zh: '降低比例 0–1', en: 'reduction, 0–1' } },
  occurrenceReduction: { kind: 'fraction', min: 0, max: 1, about: { zh: '降低比例 0–1', en: 'reduction, 0–1' } },
  overhead: { kind: 'fraction', min: 0, max: 1, maxExclusive: true, about: { zh: '吞吐开销，0 ≤ o < 1', en: 'throughput overhead, 0 ≤ o < 1' } },
  rateFactor: FACTOR, durationFactor: FACTOR,
  remainingBandwidthRatio: { kind: 'factor', min: 0, max: 1, minExclusive: true, about: { zh: '剩余带宽比，0 < r ≤ 1', en: 'remaining bandwidth, 0 < r ≤ 1' } },
  compressionRatio: { kind: 'ratio', min: 1, max: Infinity, about: { zh: '压缩比，≥ 1', en: 'compression ratio, ≥ 1' } },
  domains: { kind: 'count', min: 1, max: Infinity, about: { zh: '域数，≥ 1', en: 'domain count, ≥ 1' } },
  computeSeconds: { kind: 'seconds', min: 0, max: Infinity, minExclusive: true, about: { zh: '检查点计算间隔，秒，> 0', en: 'checkpoint compute interval, seconds, > 0' } },
};

/** the domain of a key: the registry's, else seconds (≥ 0) for a `…Seconds` key, else undefined (any finite number) */
export function parameterDomain(key: string): ParameterDomain | undefined {
  return PARAMETER_DOMAINS[key] ?? (key.endsWith('Seconds') ? SECONDS : undefined);
}

const bound = (d: ParameterDomain) => `${d.minExclusive ? '(' : '['}${d.min}, ${d.max === Infinity ? '∞' : d.max}${d.maxExclusive || d.max === Infinity ? ')' : ']'}`;

/** what is wrong with one value of a key, or null */
export function parameterIssue(key: string, value: unknown): { zh: string; en: string } | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { zh: `${key} = ${String(value)} 不是有限数`, en: `${key} = ${String(value)} is not a finite number` };
  const d = parameterDomain(key);
  if (!d) return null;
  const low = d.minExclusive ? value <= d.min : value < d.min;
  const high = d.maxExclusive ? value >= d.max : value > d.max;
  return low || high ? { zh: `${key} = ${value} 超出定义域 ${bound(d)}（${d.about.zh}）`, en: `${key} = ${value} is outside its domain ${bound(d)} (${d.about.en})` } : null;
}

/** the issues of a mechanism's parameters, one per key */
export function parameterIssues(id: string, parameters: Record<string, unknown>): { key: string; message: { zh: string; en: string } }[] {
  const out: { key: string; message: { zh: string; en: string } }[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    const m = parameterIssue(key, value);
    if (m) out.push({ key, message: { zh: `${id}：${m.zh}`, en: `${id}: ${m.en}` } });
  }
  return out;
}

/** throw when a parameter of the mechanism lies outside its domain (the guard of every transform) */
export function assertParameters(id: string, parameters: Record<string, unknown>): void {
  const bad = parameterIssues(id, parameters);
  if (bad.length) throw new Error(`invalid mechanism parameters: ${bad.map((b) => b.message.en).join('; ')}`);
}
