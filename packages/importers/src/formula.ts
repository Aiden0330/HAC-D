/**
 * Formula normalisation and method fingerprinting. Formulas are not evaluated: each one is reduced
 * to a shape (cell references → R1, R2, …; ranges → RANGE) and matched against a catalogue of
 * availability-calculation idioms (docs/PLAN_V2_AVAILABILITY_ENHANCEMENTS.md §4.1).
 */
import type { MethodHit, MethodTag } from './types.js';

export interface ParsedRef {
  sheet?: string;
  addr: string;
  /** end of a range */
  end?: string;
}

const REF_RE = /(?:'([^']+)'!|([A-Za-z0-9_]+)!)?\$?([A-Z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?/g;

/** Uppercase, strip `$`, strip sheet qualifiers, collapse whitespace. */
export function normalizeFormula(f: string): string {
  return f
    .replace(/^=/, '')
    .replace(/\s+/g, '')
    .replace(/'[^']+'!/g, '')
    .replace(/[A-Za-z0-9_]+!/g, '')
    .replace(/\$/g, '')
    .toUpperCase();
}

/** Cell / range references in order of appearance. */
export function extractRefs(f: string): ParsedRef[] {
  const out: ParsedRef[] = [];
  const text = f.replace(/^=/, '');
  for (const m of text.matchAll(REF_RE)) {
    // skip function names that look like refs (e.g. LOG10) — require a column of ≤3 letters followed by digits, already enforced
    const sheet = m[1] ?? m[2];
    const addr = `${m[3].toUpperCase()}${m[4]}`;
    const end = m[5] ? `${m[5].toUpperCase()}${m[6]}` : undefined;
    out.push({ sheet, addr, end });
  }
  return out;
}

/** Shape: references replaced by R<i> (same cell → same index), ranges by RANGE<i>, numbers kept. */
export function shapeOf(f: string): { shape: string; refs: ParsedRef[] } {
  const norm = normalizeFormula(f);
  const refs = extractRefs(norm);
  const index = new Map<string, string>();
  let ri = 0;
  let gi = 0;
  const shape = norm.replace(new RegExp(REF_RE.source, 'g'), (m, _s1, _s2, col, row, ecol, erow) => {
    const key = ecol ? `${col}${row}:${ecol}${erow}` : `${col}${row}`;
    if (!index.has(key)) index.set(key, ecol ? `RANGE${++gi}` : `R${++ri}`);
    return index.get(key)!;
  });
  return { shape, refs };
}

type RuleResult = false | { confidence: number; params?: Record<string, number | string> };
interface Rule {
  tag: MethodTag;
  test: (shape: string, norm: string) => RuleResult;
}

const strip = (s: string) => s.replace(/^\((.*)\)$/, '$1');

const RULES: Rule[] = [
  { tag: 'markov_mmult_minverse', test: (s) => (/MMULT\(|MINVERSE\(/.test(s) ? { confidence: 0.95 } : false) },
  { tag: 'kofn_binom_dist', test: (s) => {
    const m = /BINOM\.?DIST\((\d+),(\d+),/.exec(s);
    if (!m) return false;
    return { confidence: 0.9, params: { failedAtMost: Number(m[1]), n: Number(m[2]) } };
  } },
  { tag: 'kofn_combin', test: (s) => {
    const ms = [...s.matchAll(/COMBIN\((\d+),(\d+)\)/g)];
    if (!ms.length) return false;
    const n = Number(ms[0][1]);
    const ks = ms.map((m) => Number(m[2]));
    return { confidence: 0.9, params: { n, kMin: Math.min(...ks) } };
  } },
  { tag: 'standby_exp', test: (s) => (/EXP\(/.test(s) ? { confidence: 0.6 } : false) },
  { tag: 'switchover_weighted', test: (s) => {
    const m = /^R(\d+)\*\((.+)\)\+\(1-R\1\)\*(.+)$/.exec(strip(s));
    return m ? { confidence: 0.9, params: { weightRef: `R${m[1]}` } } : false;
  } },
  { tag: 'mttr_mixture_auto_manual', test: (s) => {
    const m = /^R(\d+)\*R(\d+)\+\(1-R\1\)\*R(\d+)$/.exec(strip(s));
    return m ? { confidence: 0.9, params: { weightRef: `R${m[1]}`, autoRef: `R${m[2]}`, manualRef: `R${m[3]}` } } : false;
  } },
  { tag: 'availability_mtbf_mttr', test: (s) => {
    const core = strip(s).replace(/\^R\d+$/, '').replace(/\^\d+$/, '');
    const m = /^\(?R(\d+)\/\(R\1\+R(\d+)\)\)?$/.exec(strip(core));
    return m ? { confidence: 0.95, params: { mtbfRef: `R${m[1]}`, mttrRef: `R${m[2]}` } } : false;
  } },
  { tag: 'availability_lambda_mttr', test: (s) => {
    const core = strip(s).replace(/\^R\d+$/, '').replace(/\^\d+$/, '');
    const m = /^\(?1\/\(1\+R(\d+)\*R(\d+)\)\)?$/.exec(strip(core));
    return m ? { confidence: 0.95, params: { aRef: `R${m[1]}`, bRef: `R${m[2]}` } } : false;
  } },
  { tag: 'fit_to_lambda', test: (s) => (/^R\d+\*(1E-0?9|10\^-9|0\.000000001)$|^R\d+\/(1E\+?0?9|10\^9|1000000000)$/.test(strip(s)) ? { confidence: 0.95 } : false) },
  { tag: 'afr_to_mtbf', test: (s) => (/^(8760|8766)\/\(?R\d+(\/100)?\)?$/.test(strip(s)) ? { confidence: 0.9 } : false) },
  { tag: 'percent_to_fraction', test: (s) => (/^R\d+\/100$/.test(strip(s)) ? { confidence: 0.9 } : false) },
  { tag: 'series_rare_event_sum', test: (s) => (/^1-SUM\(RANGE\d+\)$|^1-\(R\d+(\+R\d+)+\)$|^1-R\d+(-R\d+)+$/.test(strip(s)) ? { confidence: 0.9 } : false) },
  { tag: 'series_product', test: (s) => (/^PRODUCT\(RANGE\d+(,RANGE\d+)*\)$|^PRODUCT\((R\d+,)+R\d+\)$|^R\d+(\*R\d+)+$/.test(strip(s)) ? { confidence: 0.85 } : false) },
  { tag: 'parallel_product_complement', test: (s): RuleResult => {
    const c = strip(s);
    if (/^1-\(1-R(\d+)\)\^(\d+|R\d+)$/.test(c)) {
      const m = /\^(\d+|R\d+)$/.exec(c)!;
      return { confidence: 0.95, params: { n: /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] } };
    }
    if (/^1-(\(1-R\d+\)\*)+\(1-R\d+\)$/.test(c)) return { confidence: 0.95, params: { n: (c.match(/\(1-R\d+\)/g) ?? []).length } };
    if (/^1-PRODUCT\(1-RANGE\d+\)$/.test(c)) return { confidence: 0.9 };
    if (/^1-PRODUCT\(RANGE\d+(,RANGE\d+)*\)$|^1-PRODUCT\((R\d+,)+R\d+\)$/.test(c)) return { confidence: 0.7, params: { overUnavailability: 1 } };
    return false;
  } },
  { tag: 'kofn_explicit_sum', test: (s) => {
    const c = strip(s);
    // e.g. R1^3+3*R1^2*(1-R1)  or  R1^4+4*R1^3*(1-R1)
    const m = /^R(\d+)\^(\d+)\+(\d+)\*R\1\^(\d+)\*\(1-R\1\)(\^\d+)?/.exec(c);
    if (!m) return false;
    return { confidence: 0.85, params: { n: Number(m[2]), k: Number(m[4]) } };
  } },
  { tag: 'unavailability_lambda_mttr', test: (s) => (/^R\d+\*R\d+$/.test(strip(s)) ? { confidence: 0.4 } : false) },
  { tag: 'complement', test: (s) => (/^1-R\d+$/.test(strip(s)) ? { confidence: 0.8 } : false) },
  { tag: 'power_of_count', test: (s) => (/^R\d+\^R\d+$|^R\d+\^\d+$/.test(strip(s)) ? { confidence: 0.6 } : false) },
];

/** Fingerprint one formula. */
export function fingerprintFormula(sheet: string, addr: string, formula: string): MethodHit {
  const { shape } = shapeOf(formula);
  for (const rule of RULES) {
    const r = rule.test(shape, normalizeFormula(formula));
    if (r) return { tag: rule.tag, sheet, addr, formula, shape, confidence: r.confidence, params: r.params };
  }
  return { tag: 'unknown', sheet, addr, formula, shape, confidence: 0 };
}

export const METHOD_DESCRIPTIONS: Record<MethodTag, { zh: string; en: string }> = {
  availability_mtbf_mttr: { zh: '可用度 A = MTBF/(MTBF+MTTR)', en: 'Availability A = MTBF/(MTBF + MTTR)' },
  availability_lambda_mttr: { zh: '可用度 A = 1/(1+λ·MTTR)', en: 'Availability A = 1/(1 + λ·MTTR)' },
  unavailability_lambda_mttr: { zh: '不可用度 U = λ·MTTR（稀有事件近似）', en: 'Unavailability U = λ·MTTR (rare-event approximation)' },
  fit_to_lambda: { zh: 'FIT → λ（×1e-9 /h）', en: 'FIT → λ (× 1e-9 per hour)' },
  afr_to_mtbf: { zh: '年失效率 → MTBF（8760/AFR）', en: 'Annual failure rate → MTBF (8760/AFR)' },
  series_product: { zh: '串联：可用度连乘', en: 'Series: product of availabilities' },
  series_rare_event_sum: { zh: '串联：1 − Σ不可用度（稀有事件近似，偏乐观）', en: 'Series: 1 − Σ unavailabilities (rare-event approximation, optimistic)' },
  parallel_product_complement: { zh: '并联：1 − Π(1 − A_i)', en: 'Parallel: 1 − Π(1 − A_i)' },
  kofn_explicit_sum: { zh: 'k-of-n：二项式显式展开', en: 'k-of-n: explicit binomial sum' },
  kofn_combin: { zh: 'k-of-n：COMBIN 二项式', en: 'k-of-n: COMBIN binomial terms' },
  kofn_binom_dist: { zh: 'k-of-n：BINOM.DIST 累积', en: 'k-of-n: BINOM.DIST cumulative' },
  standby_exp: { zh: '待机/指数项（EXP）', en: 'Standby / exponential term (EXP)' },
  switchover_weighted: { zh: '倒换成功率加权：c·A_倒换 + (1−c)·A_单机', en: 'Switchover-weighted: c·A_switched + (1 − c)·A_single' },
  mttr_mixture_auto_manual: { zh: 'MTTR 自动/人工加权：p·T_auto + (1−p)·T_manual', en: 'MTTR mixture: p·T_auto + (1 − p)·T_manual' },
  markov_mmult_minverse: { zh: '马尔可夫稳态（MMULT/MINVERSE）', en: 'Markov steady state (MMULT / MINVERSE)' },
  percent_to_fraction: { zh: '百分数 → 小数', en: 'Percent → fraction' },
  complement: { zh: '补数 1 − x', en: 'Complement 1 − x' },
  power_of_count: { zh: '按数量取幂 A^n', en: 'Power by quantity A^n' },
  unknown: { zh: '未识别公式', en: 'Unrecognised formula' },
};
