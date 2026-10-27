/**
 * Offline bundle of the hacd CLI for the inside-the-network deployment (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §4, T4):
 * one esbuild bundle of packages/cli (core, importers, reports, agent and their dependencies inlined; katex kept external and
 * copied beside it because the report kit reads its font files from the package folder), the records data folder, a POSIX and a
 * Windows launcher that set HACD_DATA / HACD_VERSION, the runbook and the worksheet templates. Node ≥ 20 is the only requirement
 * on the target machine; nothing is fetched at run time except by `hacd ingest extract` when a model endpoint is given.
 *
 *   node scripts/bundle-offline.mjs [--out dist/offline]   →   dist/offline/hacd-<version>/… and dist/offline/hacd-<version>.tgz
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const version = JSON.parse(readFileSync(join(REPO, 'packages/core/package.json'), 'utf8')).version;
const outRoot = join(REPO, flag('out') ?? 'dist/offline');
const name = `hacd-${version}`;
const dir = join(outRoot, name);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'bin'), { recursive: true });

await build({
  entryPoints: [join(REPO, 'packages/cli/src/main.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: join(dir, 'bin/hacd.mjs'),
  external: ['katex'],
  banner: { js: "import { createRequire as __hacdCreateRequire } from 'node:module'; const require = __hacdCreateRequire(import.meta.url);" },
  define: { 'process.env.HACD_BUNDLE': JSON.stringify(name) },
  logLevel: 'warning',
  legalComments: 'none',
});
// katex beside the bundle: the kit resolves it as a package (fonts + css read from its folder)
cpSync(join(REPO, 'node_modules/katex'), join(dir, 'node_modules/katex'), { recursive: true, dereference: true });
// the records data folder (HACD_DATA) and the public ids it ships
cpSync(join(REPO, 'packages/core/data'), join(dir, 'data'), { recursive: true });
// docs and templates
mkdirSync(join(dir, 'docs'), { recursive: true });
for (const f of ['docs/markdown/INGEST_RUNBOOK.md', 'docs/markdown/AGENT_OPERATOR.md', 'docs/markdown/PILOT_2026Q3_MOCK.md', 'docs/markdown/PLAN_V6_INPUT_MIGRATION.md', 'docs/markdown/USER_GUIDE.md', 'docs/markdown/MODEL_REFERENCE.md']) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, 'docs', f.split('/').pop()));
mkdirSync(join(dir, 'templates'), { recursive: true });
for (const kind of ['topology', 'fault-rates', 'mechanisms', 'mechanism-proposal', 'device-fit', 'koujing-mapping']) {
  const text = execFileSync('node', [join(dir, 'bin/hacd.mjs'), 'ingest', 'template', kind], { encoding: 'utf8', env: { ...process.env, HACD_DATA: join(dir, 'data'), HACD_VERSION: version } });
  writeFileSync(join(dir, 'templates', `${kind}.md`), text);
}
// v6.1 the operator protocol for the on-prem model: system prompt (zh / en), tool manifest, fix table (hacd ingest protocol)
mkdirSync(join(dir, 'prompts'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
const proto = (args) => execFileSync('node', [join(dir, 'bin/hacd.mjs'), 'ingest', 'protocol', ...args], { encoding: 'utf8', env: { ...process.env, HACD_DATA: join(dir, 'data'), HACD_VERSION: version } });
for (const lang of ['zh', 'en']) { writeFileSync(join(dir, 'prompts', `operator.${lang}.md`), proto(['--lang', lang])); writeFileSync(join(dir, 'prompts', `fix-table.${lang}.md`), proto(['--fix-table', '--lang', lang])); }
writeFileSync(join(dir, 'tools', 'hacd-tools.json'), proto(['--tools']));
// the mock on-prem model (an OpenAI-compatible server with scripted answers), to test a host and the pipeline wiring before the real model is connected
copyFileSync(join(REPO, 'scripts/mock-onprem-model.mjs'), join(dir, 'tools', 'mock-onprem-model.mjs'));
mkdirSync(join(dir, 'examples', 'pilot'), { recursive: true });
for (const f of readdirSync(join(REPO, 'packages/cli/test/fixtures/pilot/internal'))) copyFileSync(join(REPO, 'packages/cli/test/fixtures/pilot/internal', f), join(dir, 'examples', 'pilot', f));
writeFileSync(join(dir, 'bin/hacd'), `#!/bin/sh
# hacd offline launcher (${name}); Node >= 20 required; no network needed
DIR=$(cd "$(dirname "$0")/.." && pwd)
export HACD_DATA="\${HACD_DATA:-$DIR/data}"
export HACD_VERSION="\${HACD_VERSION:-${version}}"
exec node "$DIR/bin/hacd.mjs" "$@"
`);
chmodSync(join(dir, 'bin/hacd'), 0o755);
writeFileSync(join(dir, 'bin/hacd.cmd'), `@echo off\r\nset "DIR=%~dp0.."\r\nif "%HACD_DATA%"=="" set "HACD_DATA=%DIR%\\data"\r\nif "%HACD_VERSION%"=="" set "HACD_VERSION=${version}"\r\nnode "%DIR%\\bin\\hacd.mjs" %*\r\n`);
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'hacd-offline', version, type: 'module', private: true, description: 'HAC-D CLI offline bundle: hacd findings | bom | budget | methodology | prune | study | records | schema | ingest …', engines: { node: '>=20' } }, null, 2) + '\n');
writeFileSync(join(dir, 'README.md'), `# ${name} — HAC-D CLI, offline bundle

Run \`bin/hacd\` (POSIX) or \`bin\\hacd.cmd\` (Windows) with Node >= 20 on the PATH. Nothing else to install; no network is used
(only \`hacd ingest extract\` talks to the model endpoint you name). The records live in \`data/\` (HACD_DATA); \`hacd ingest promote\`
writes there. Start with \`docs/INGEST_RUNBOOK.md\`; worksheet examples are in \`templates/\`.

    bin/hacd ingest help
    bin/hacd ingest template topology > my-topology.md
    bin/hacd ingest worksheet my-topology.md --out staging
    bin/hacd ingest validate staging
    bin/hacd ingest diff --before-record native950 --after-record staging/records/<id>.json --out staging/delta
    bin/hacd ingest promote staging

One call for a program or the on-prem model (\`docs/AGENT_OPERATOR.md\`; the model's system prompt is \`prompts/operator.zh.md\` /
\`prompts/operator.en.md\`, the tool manifest \`tools/hacd-tools.json\`):

    bin/hacd ingest run --worksheets ws --staging staging --before-record native950 --out out --json   # gates → dry run → delta → report; run.json + SUMMARY.md; exit 0 / 2 needs-input / 3 failed

The reference host runs your on-prem model as the operator (OpenAI-compatible endpoint; the key only through an environment variable):

    bin/hacd ingest operate --base-url http://host:8000/v1 --model <name> --api-key-env MODEL_KEY --work work --docs internal/ --brief brief.md --before-record a3server --scales 100000 --lang zh

Try the wiring first with the mock model and the synthetic pilot inputs (\`examples/pilot/\`): \`node tools/mock-onprem-model.mjs --port 8010\`, then the
command above with \`--base-url http://127.0.0.1:8010/v1 --model mock-onprem --docs examples/pilot --brief examples/pilot/brief.md\`.
`);
execFileSync('tar', ['-czf', `${name}.tgz`, name], { cwd: outRoot });
const size = (p) => `${(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split('\t')[0] / 1024).toFixed(1)} MB`;
console.log(`bundle ${dir} (${size(dir)}), archive ${join(outRoot, `${name}.tgz`)} (${size(join(outRoot, `${name}.tgz`))})`);
