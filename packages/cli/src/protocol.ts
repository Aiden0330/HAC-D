/** `hacd ingest protocol`: print the operator protocol (docs/markdown/AGENT_OPERATOR.md) — the system prompt of the on-prem model, or the tool manifest. */
import { OPERATOR_PROMPT, HACD_TOOLS, fixTableMarkdown } from '@hac-d/agent';

type Args = { flag: (name: string) => string | undefined; has: (name: string) => boolean; command: string };
export function protocol(a: Args): void {
  if (a.has('tools')) { console.log(JSON.stringify(HACD_TOOLS, null, 1)); return; }
  const lang = (a.flag('lang') ?? 'en') as 'zh' | 'en';
  if (lang !== 'zh' && lang !== 'en') { console.error('usage: hacd ingest protocol [--lang zh|en] [--tools] [--fix-table]'); process.exit(1); }
  if (a.has('fix-table')) { console.log(fixTableMarkdown(lang)); return; }
  console.log(OPERATOR_PROMPT[lang]);
}
