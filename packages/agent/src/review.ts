/**
 * Review queue of an extraction run (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3, §5.6): what a person must look at before a
 * draft worksheet is trusted — the run summary, the fields the two passes disagree on, the rejected cards with their reason, the
 * accepted `unmapped` cards (facts with no field path yet), accepted cards whose model confidence is low or unsure (advisory only),
 * fields accepted with different values in different chunks, and the calls that failed. Bilingual by default (`zh / en` headings and
 * labels); `lang` picks one language. Table cells escape pipes as `\|`.
 */
import { cardKey, normalizeText, type EvidenceCard } from '@hac-d/core';
import type { ExtractResult } from './types.js';

type Lang = 'zh' | 'en' | undefined;
const T = (lang: Lang, zh: string, en: string): string => (lang === 'zh' ? zh : lang === 'en' ? en : `${zh} / ${en}`);
export const escapeCell = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const table = (headers: string[], rows: unknown[][]): string[] =>
  [`| ${headers.map(escapeCell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`)];
const vu = (c?: EvidenceCard): string => (c ? `${c.value_text}${c.unit_text ? ` ${c.unit_text}` : ''}` : '—');
const q = (c?: EvidenceCard): string => (c ? `“${c.quote}”` : '');
const where = (c?: EvidenceCard): string => (c ? `${c.doc} ${c.loc}`.trim() : '');
const docOfChunk = (id: string): string => id.replace(/#\d+$/, '');

export function reviewMarkdown(result: Omit<ExtractResult, 'reviewMarkdown'>, lang?: 'zh' | 'en'): string {
  const L = (zh: string, en: string) => T(lang, zh, en);
  const docs = [...new Set([...result.log.map((e) => docOfChunk(e.chunk)), ...result.accepted.map((c) => c.doc)])];
  const errors = result.log.filter((e) => e.error);
  const out: string[] = [`# ${L('证据卡复核', 'Evidence-card review')} — ${result.kind}`, ''];

  out.push(`## ${L('运行摘要', 'Run summary')}`, '');
  out.push(...table([L('项', 'item'), L('值', 'value')], [
    [L('文档', 'documents'), docs.length ? `${docs.length}: ${docs.join(', ')}` : '0'],
    [L('分块', 'chunks'), result.chunks],
    [L('模型调用', 'model calls'), result.calls],
    [L('模型', 'model'), result.model],
    [L('接受', 'accepted'), result.accepted.length],
    [L('争议', 'disputed'), result.disputed.length],
    [L('拒绝', 'rejected'), result.rejected.length],
    [L('出错调用', 'failed calls'), errors.length],
  ]), '');
  out.push(L('接受 = 引文在分块中逐字找到、数值在引文内，且两遍抽取的数值与单位一致；模型置信度仅供参考，HAC-D 置信度由来源类型策略给出。',
    'Accepted = quote found verbatim in the chunk, value inside the quote, and both passes agree on value and unit; the model confidence is advisory, HAC-D confidence comes from the source-type policy.'), '');

  out.push(`## ${L('争议（两遍不一致）', 'Disputed (passes disagree)')}`, '');
  if (result.disputed.length) out.push(...table([L('字段', 'key'), L('位置', 'location'), L('第 1 遍', 'pass 1'), L('第 1 遍引文', 'pass-1 quote'), L('第 2 遍', 'pass 2'), L('第 2 遍引文', 'pass-2 quote'), L('原因', 'reason')],
    result.disputed.map((d) => [d.key, where(d.a ?? d.b), vu(d.a), q(d.a), vu(d.b), q(d.b), d.reason])));
  else out.push(L('无。', 'None.'));
  out.push('');

  out.push(`## ${L('拒绝的卡', 'Rejected cards')}`, '');
  if (result.rejected.length) out.push(...table([L('字段', 'field'), L('值', 'value'), L('原因', 'reason'), L('分块', 'chunk')],
    result.rejected.map((r) => { const c = r.card as Record<string, unknown>; return [c.field ?? '', c.value_text ?? c.value ?? '', r.reason, r.chunk]; })));
  else out.push(L('无。', 'None.'));
  out.push('');

  const unmapped = result.accepted.filter((c) => c.field === 'unmapped');
  out.push(`## ${L('已接受的未映射卡', 'Accepted unmapped cards')}`, '');
  if (unmapped.length) out.push(...table([L('标签', 'label'), L('值', 'value'), L('单位', 'unit'), L('引文', 'quote'), L('位置', 'loc')],
    unmapped.map((c) => [c.label ?? '', c.value_text, c.unit_text, c.quote, where(c)])));
  else out.push(L('无。', 'None.'));
  out.push('');

  const unsure = result.accepted.filter((c) => c.model_confidence === 'low' || c.model_confidence === 'unsure');
  out.push(`## ${L('模型置信度低或不确定的已接受卡', 'Accepted cards with low or unsure model confidence')}`, '');
  if (unsure.length) out.push(...table([L('字段', 'field'), L('值', 'value'), L('单位', 'unit'), L('引文', 'quote'), L('位置', 'loc'), L('模型置信度', 'model confidence')],
    unsure.map((c) => [c.field === 'unmapped' ? `unmapped: ${c.label ?? ''}` : c.field, c.value_text, c.unit_text, c.quote, where(c), c.model_confidence])));
  else out.push(L('无。', 'None.'));
  out.push('');

  const byKey = new Map<string, EvidenceCard[]>();
  for (const c of result.accepted) byKey.set(cardKey(c), [...(byKey.get(cardKey(c)) ?? []), c]);
  const conflicts = [...byKey.entries()].filter(([, cs]) => new Set(cs.map((c) => `${normalizeText(c.value_text)}\u0000${normalizeText(c.unit_text)}`)).size > 1);
  out.push(`## ${L('跨分块取值不同的字段', 'Fields accepted with different values in different chunks')}`, '');
  if (conflicts.length) out.push(...table([L('字段', 'key'), L('值', 'value'), L('引文', 'quote'), L('位置', 'loc')],
    conflicts.flatMap(([k, cs]) => cs.map((c) => [k, vu(c), c.quote, where(c)]))), '', L('草稿取第一个值；请确认。', 'The draft takes the first value; confirm it.'));
  else out.push(L('无。', 'None.'));
  out.push('');

  out.push(`## ${L('出错的调用', 'Failed calls')}`, '');
  if (errors.length) out.push(...table([L('分块', 'chunk'), L('遍', 'pass'), L('错误', 'error'), L('提示词 sha256', 'prompt sha256')],
    errors.map((e) => [e.chunk, e.pass, e.error, e.promptSha256.slice(0, 12)])));
  else out.push(L('无。', 'None.'));
  out.push('');
  return out.join('\n');
}
