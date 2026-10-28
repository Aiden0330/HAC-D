#!/usr/bin/env node
/**
 * A mock on-prem model for HAC-D (v6.1, docs/markdown/AGENT_OPERATOR.md §8): an OpenAI-compatible chat-completions server with
 * two scripted personalities, so the ingest pilot and the operator tests run without a real model. It is a stand-in, not a model:
 * it sees the documents only through the host's tools and copies values by pattern — it never computes a reliability number.
 *
 *  - extraction (a request without `tools`, from `hacd ingest extract`): evidence cards for the chunk of the user message, by
 *    regular expressions over the sentences of the synthetic pilot documents (packages/cli/test/fixtures/pilot); the quote is the
 *    whole match, so every card is grounded; both passes return the same cards (`--flaky` drops one card in pass 2 to show the
 *    review queue).
 *  - operator (a request with `tools`, from `hacd ingest operate`): the procedure of the operator prompt as a state machine over
 *    the conversation — read the documents, take the templates, import-fit, write the 口径 mapping and the mechanisms worksheets,
 *    normalize, extract the topology, write the topology worksheet from the draft, `hacd ingest run`, then the fix table on
 *    needs-input (id-collision, unknown-class, worksheet-parse; at most three rounds; stop when a round changes nothing), then
 *    the final message in the required format. With "worksheets are already prepared" in the task it skips to the run.
 *
 * Usage: node mock-onprem-model.mjs [--port 0] [--model mock-onprem] [--verbose] [--flaky]
 *        → prints `listening http://127.0.0.1:<port>/v1` on stdout. No network access, no file access, no dependencies.
 */
import { createServer } from 'node:http';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const PORT = Number(flag('port', '0'));
const MODEL = flag('model', 'mock-onprem');
const VERBOSE = argv.includes('--verbose');
const FLAKY = argv.includes('--flaky');
const vlog = (...a) => { if (VERBOSE) console.error('[mock]', ...a); };
const tokens = (s) => Math.ceil((s ?? '').length / 4);
const safeJson = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const base = (p) => String(p).split(/[\\/]/).pop();

/* ============================== extraction personality ============================== */
/** [field, pattern, unit as written]: the sentences of the synthetic design note (packages/cli/test/fixtures/pilot/internal) */
const TOPOLOGY_PATTERNS = [
  ['superpod.base', /starts from the (cloudmatrix384) preset/, ''],
  ['superpod.npusPerNode', /Each server carries (\d+) NPUs/, 'NPUs'],
  ['superpod.cpusPerNode', /and (\d+) Kunpeng CPUs/, 'CPUs'],
  ['superpod.l1PerNode', /has (\d+) on-board UB L1 switch chips/, 'chips'],
  ['superpod.rdmaPortsPerNpu', /Each NPU exposes (\d+) RDMA ports/, 'ports'],
  ['superpod.vpcNicsPerNode', /Each server has (\d+) VPC NIC/, 'NIC'],
  ['superpod.nodesPerRack', /A cabinet holds (\d+) servers/, 'servers'],
  ['superpod.computeRacks', /(\d+) compute cabinet and/, 'cabinet'],
  ['superpod.commRacks', /and (\d+) communication cabinets/, 'cabinets'],
  ['superpod.l2PerSubPlane', /(\d+) L2 chips per sub-plane/, 'chips'],
  ['superpod.linksPerL1', /L1 chips have (\d+) uplinks/, 'uplinks'],
  ['domainNpus', /the UB domain has (\d+) NPUs/, 'NPUs'],
  ['scaleOut.portsPerNpu', /uses (\d+) RoCE ports per NPU/, 'ports'],
  ['scaleOut.planes', /over (\d+) planes/, 'planes'],
  ['scaleOut.radix', /of (\d+)-port switches/, 'ports'],
  ['scaleOut.oversubscription', /oversubscription (\d+)/, ''],
  ['scaleOut.transceiversPerLink', /(\d+) transceivers per link/, 'transceivers'],
  ['layers.superpod.unit', /SuperPoD layer is one server \((nodes)\)/, ''],
  ['layers.superpod.npus', /The SuperPoD layer has (\d+) NPUs/, 'NPUs'],
  ['layers.cabinet.npus', /A cabinet layer has (\d+) NPUs/, 'NPUs'],
  ['layers.node.npus', /A node layer has (\d+) NPUs/, 'NPUs'],
];

function extractionAnswer(body) {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const user = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const kind = /cluster topology/.test(system) ? 'topology' : /device \/ part failure rates/.test(system) ? 'device-fit' : /mechanism parameters/.test(system) ? 'mechanisms' : 'topology';
  const v1 = /"""\n([\s\S]*?)\n"""/.exec(user), v2 = /----- PASSAGE -----\n([\s\S]*?)\n----- END -----/.exec(user);
  const chunk = (v1 ?? v2)?.[1] ?? '';
  let cards = [];
  if (kind === 'topology') for (const [field, re, unit] of TOPOLOGY_PATTERNS) { const m = re.exec(chunk); if (m) cards.push({ doc: 'chunk', loc: '', field, value_text: m[1], unit_text: unit, quote: m[0], model_confidence: 'high' }); }
  if (FLAKY && v2 && !v1 && cards.length) cards = cards.slice(0, -1);
  vlog(`extract ${kind}: ${cards.length} cards (pass ${v2 && !v1 ? 2 : 1})`);
  return JSON.stringify({ cards });
}

/* ============================== operator personality ============================== */
const g = (re, text, i = 1) => { const m = re.exec(text); return m ? m[i] : undefined; };

/** what the host's task message says */
function parseTask(text) {
  const docs = [...text.matchAll(/^- (\S+) — /gm)].map((m) => m[1]);
  const pick = (re, fallback) => { const n = g(re, text); const hit = n ? docs.find((d) => base(d) === base(n)) : undefined; return hit ?? docs.find(fallback); };
  const t = {
    work: g(/(?:Work folder: |工作目录：)([^\s（(]+)/, text),
    docs,
    beforeRecord: g(/(?:Baseline public record for the delta: |差异对比的公开基线记录：)([^\s.。（(]+)/, text),
    scales: g(/(?:Scales: |规模：)([\d,]+)/, text) ?? '10000,100000',
    trials: Number(g(/(?:Trials: |窗口数（trials）：)(\d+)/, text) ?? 400),
    permutations: Number(g(/(?:Permutations: |置换数（permutations）：)(\d+)/, text) ?? 300),
    baseUrl: g(/base URL (\S+?)[,，]/, text),
    model: g(/[,，] ?model (\S+?)[.。]?$/m, text),
    recordId: g(/Record id: ([a-z0-9-]+)/, text) ?? 'internal-record',
    template: g(/template ([a-z0-9-]+)/, text) ?? 'a3-ub384',
    family: g(/chip family ([^\s)）]+)/, text) ?? '',
    nameZh: g(/zh "([^"]+)"/, text),
    nameEn: g(/en "([^"]+)"/, text),
    ratesId: g(/override id ([a-z0-9-]+)/, text) ?? 'internal-rates',
    setId: g(/set id ([a-z0-9-]+)/, text) ?? 'internal-mechanisms',
    prepared: /already prepared|已备好|已经备好/.test(text),
    dataSource: g(/Failure data: (\S+\.(?:csv|xlsx|xlsm))/, text),
  };
  if (t.beforeRecord === '(none)' || t.beforeRecord === '（无）') t.beforeRecord = undefined;
  t.fitDoc = pick(/Failure data: (\S+\.(?:csv|xlsx|xlsm))/, (d) => /\.(csv|xlsx|xlsm)$/i.test(d) && !/mapping|口径/i.test(d));
  t.mappingDoc = pick(/mapping is (\S+\.(?:csv|md))/, (d) => /mapping|口径/i.test(d));
  t.designDoc = pick(/Topology: (\S+\.md)/, (d) => /\.md$/i.test(d) && /design|topolog|拓扑|设计/i.test(d));
  t.mechDoc = pick(/Mechanisms: (\S+\.md)/, (d) => /\.md$/i.test(d) && /mechanism|机制/i.test(d));
  return t;
}

/** the tool calls so far, each with its result text */
function history(messages) {
  const calls = [], results = new Map();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) calls.push({ id: c.id, name: c.function?.name, args: safeJson(c.function?.arguments, {}) ?? {} });
    if (m.role === 'tool') results.set(m.tool_call_id, typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
  }
  for (const c of calls) { c.result = results.get(c.id) ?? ''; c.hacd = c.name?.startsWith('hacd_') ? safeJson(c.result, null) : null; }
  return calls;
}
/** the newest known text of every file: the last write_file's content, else the last read_file's result */
function knownFiles(calls) {
  const f = new Map();
  for (const c of calls) {
    if (c.name === 'read_file' && c.result && !c.result.startsWith('error:')) f.set(c.args.path, c.result);
    if (c.name === 'write_file' && c.result && c.result.startsWith('written:')) f.set(c.args.path, c.args.content);
  }
  return f;
}

/* ---------- worksheet text helpers (Markdown profile hacd-worksheet-1) ---------- */
const frontRange = (lines) => { const a = lines.indexOf('---'); const b = lines.indexOf('---', a + 1); return [a, b]; };
/** a YAML scalar: quoted when the text would otherwise read as a mapping, a comment or a list */
const yamlScalar = (v) => (typeof v === 'string' && !v.startsWith('\n') && /[:#\[\]{}&*!|>'"%@`,]|^\s|\s$|^$/.test(v) && !/^".*"$/.test(v) ? JSON.stringify(v) : v);
function setFront(text, key, value) {
  const lines = text.split('\n'); const [a, b] = frontRange(lines);
  const i = lines.findIndex((l, k) => k > a && k < b && l.startsWith(`${key}:`) && !/^\s/.test(l));
  const line = `${key}: ${yamlScalar(value)}`;
  if (i >= 0) {
    // drop the indented block of a nested key before replacing it
    let j = i + 1; while (j < b && /^\s/.test(lines[j])) j++;
    lines.splice(i, j - i, line);
  } else lines.splice(b, 0, line);
  return lines.join('\n');
}
const setBilingual = (text, key, zh, en) => setFront(text, key, `\n  zh: ${zh}\n  en: ${en}`);
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
const row = (xs) => `| ${xs.map((x) => String(x ?? '')).join(' | ')} |`;
/** the table under `## section`: [headerIndex, firstRowIndex, endIndex) */
function tableRange(lines, section) {
  const s = lines.findIndex((l) => l.startsWith(`## ${section}`));
  if (s < 0) return null;
  let h = s + 1; while (h < lines.length && !lines[h].startsWith('|')) { if (lines[h].startsWith('## ')) return null; h++; }
  if (h >= lines.length) return null;
  let e = h + 2; while (e < lines.length && lines[e].startsWith('|')) e++;
  return [h, h + 2, e];
}
function replaceRows(text, section, rows) {
  const lines = text.split('\n'); const r = tableRange(lines, section);
  if (!r) throw new Error(`no table under ## ${section}`);
  lines.splice(r[1], r[2] - r[1], ...rows.map(row));
  return lines.join('\n');
}
function editCell(text, section, firstCell, column, value) {
  const lines = text.split('\n'); const r = tableRange(lines, section);
  if (!r) return null;
  const headers = cells(lines[r[0]]); const ci = headers.indexOf(column);
  if (ci < 0) return null;
  for (let i = r[1]; i < r[2]; i++) {
    const cs = cells(lines[i]);
    if (cs[0] === firstCell) { cs[ci] = value; lines[i] = row(cs); return lines.join('\n'); }
  }
  return null;
}
function csvRows(text) {
  const out = []; let rowCells = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { rowCells.push(cell); cell = ''; }
    else if (ch === '\n') { rowCells.push(cell.replace(/\r$/, '')); out.push(rowCells); rowCells = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || rowCells.length) { rowCells.push(cell); out.push(rowCells); }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}
const mdTableRows = (text) => text.split('\n').filter((l) => l.startsWith('|')).map(cells).filter((cs) => !cs.every((c) => /^-+$/.test(c)));

/** the worksheets the model knows, by id and by kind */
function worksheetIndex(files) {
  const by = [];
  for (const [path, text] of files) {
    if (!path.endsWith('.md')) continue;
    const kind = g(/^worksheet: (\S+)/m, text), id = g(/^id: (\S+)/m, text);
    if (kind && id) by.push({ path, text, kind, id });
  }
  return by;
}

/* ---------- the final message (exactly the fields the prompt asks for) ---------- */
function finalMessage(o) {
  const lines = [`status: ${o.status}`, `run: ${o.runCommand ?? '(not run)'}`];
  if (o.kpiTable?.length) lines.push('KPI (SUMMARY.md):', ...o.kpiTable);
  if (o.failedStep) lines.push(`failed step: ${o.failedStep.name} (exit ${o.failedStep.exitCode})`, `stderrTail: ${o.failedStep.stderrTail ?? ''}`);
  lines.push(`unresolved issues: ${o.unresolved?.length ? o.unresolved.map((i) => `(${i.path}, ${i.code})`).join('; ') : 'none'}`);
  if (o.warnings?.length) lines.push(`warnings noted: ${o.warnings.map((i) => `(${i.path}, ${i.code})`).join('; ')}`);
  if (o.out) lines.push(`paths: run.json ${o.out}/run.json; SUMMARY.md ${o.out}/SUMMARY.md; report ${o.out}/report/; delta ${o.out}/delta/`);
  return lines.join('\n');
}
const kpiTableOf = (summary) => {
  const lines = summary.split('\n'); const k = lines.findIndex((l) => /^## KPI/.test(l));
  if (k < 0) return [];
  const out = []; for (let i = k + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].startsWith('|')) out.push(lines[i]);
  return out;
};

/** the synonym table of a small model for class prefixes it meets in device names */
const CLASS_SYNONYMS = { HBM: 'MEMT', DRAM: 'DDR', DIMM: 'DDR', PSU: 'POWER', FAN: 'COOL', BMC: 'MGMT', OPTIC: 'OPT', OPTICS: 'OPT', TRANSCEIVER: 'OPT', SWITCH: 'FABRIC', DISK: 'SSD', NVME: 'SSD', HOST: 'CPU', NPU: 'CORE' };

/* ---------- v6.4 the project workflow: the task names a template, the changes and the report settings ---------- */
function parseProject(text) {
  const m = /Project workflow: (template|record) ([a-z0-9-]+), npus (\d+)(?:, id ([a-z0-9-]+))?(?:, name "([^"]+)")?/.exec(text);
  if (!m) return null;
  const [, kind, src, npus, id, name] = m;
  const line = (label) => g(new RegExp(`^${label}: (.*)$`, 'm'), text);
  const items = (x) => (x ?? '').split(';').map((y) => y.trim()).filter(Boolean);
  const mech = items(line('Mechanisms'));
  return {
    template: kind === 'template' ? src : undefined, record: kind === 'record' ? src : undefined, npus: Number(npus), id: id ?? 'project', name,
    sets: items(line('Set')), fits: items(line('FIT')),
    apply: mech.filter((x) => x.startsWith('apply ')).map((x) => x.slice(6).trim()), remove: mech.filter((x) => x.startsWith('remove ')).map((x) => x.slice(7).trim()),
    report: Object.fromEntries(items(line('Report')).map((kv) => { const [k, v] = kv.split(/\s+/); return [k, v]; })),
  };
}
/** the scripted project workflow of a small model: one command per turn, read back, then the final message of procedure D */
function projectTurn(W, calls, pj) {
  const file = `${W}/project/${pj.id}.json`, OUT = `${W}/out`;
  const has = (n) => calls.some((c) => c.name === n);
  const last = (n) => [...calls].reverse().find((c) => c.name === n);
  const tool = (name, args) => ({ name, args });
  const broken = calls.find((c) => c.hacd && c.hacd.exitCode !== 0);
  if (broken) return { content: `status: failed\nfailed: hacd ${broken.name.replace(/^hacd_/, '').replace(/_/g, ' ')} (exit ${broken.hacd.exitCode})\nstderr: ${(broken.hacd.stderr ?? '').split('\n').slice(-5).join(' ')}` };
  if (!has('hacd_scenario_new')) return { toolCalls: [tool('hacd_scenario_new', { ...(pj.record ? { record: pj.record } : { template: pj.template }), npus: pj.npus, id: pj.id, ...(pj.name ? { name: pj.name } : {}), out: file })] };
  if (!has('hacd_scenario_fields')) return { toolCalls: [tool('hacd_scenario_fields', { scenario: file })] };
  if (pj.sets.length && !has('hacd_scenario_set')) return { toolCalls: [tool('hacd_scenario_set', { scenario: file, sets: pj.sets, out: file })] };
  if (pj.fits.length && !has('hacd_scenario_fit')) return { toolCalls: [tool('hacd_scenario_fit', { scenario: file, sets: pj.fits, out: file })] };
  if ((pj.apply.length || pj.remove.length) && !has('hacd_scenario_mechanisms')) return { toolCalls: [tool('hacd_scenario_mechanisms', { scenario: file, ...(pj.apply.length ? { apply: pj.apply } : {}), ...(pj.remove.length ? { remove: pj.remove } : {}), out: file })] };
  if (!has('hacd_scenario_show')) return { toolCalls: [tool('hacd_scenario_show', { scenario: file })] };
  if (!has('hacd_scenario_report')) return { toolCalls: [tool('hacd_scenario_report', { scenario: file, out: OUT, ...(pj.report.scales ? { scales: pj.report.scales } : {}), ...(pj.report.trials ? { trials: Number(pj.report.trials) } : {}), ...(pj.report.permutations ? { permutations: Number(pj.report.permutations) } : {}) })] };
  const rep = last('hacd_scenario_report');
  const man = rep.hacd ? safeJson(rep.hacd.stdout, null) : null;
  if (!man) return { content: 'status: failed\nfailed: hacd scenario report (no manifest on stdout)' };
  const show = safeJson(last('hacd_scenario_show').hacd?.stdout ?? '', {})?.summary ?? {};
  const pct = (x) => `${(100 * x).toFixed(3)} %`;
  const kpi = (man.kpi ?? []).map((k) => `| ${k.scale} | ${pct(k.today.aOp)} / ${pct(k.today.aOpDerated)} | ${pct(k.recommended.aOpDerated)} | ${k.recommended.mechanisms.join('+') || '—'} | k ${k.recommended.k.toFixed(3)} |`);
  const changes = [...pj.sets.map((x) => `(${x.replace('=', ', ')}, task)`), ...pj.fits.map((x) => `(fit ${x.replace('=', ', ')}, task)`), ...pj.apply.map((x) => `(apply ${x}, task)`), ...pj.remove.map((x) => `(remove ${x}, task)`)];
  return { content: ['status: ok', `project: ${file}`, `changes: ${changes.join('; ') || 'none'}`, `mechanisms applied: ${(show.mechanisms ?? []).map((m) => m.id).join(' + ')}`, 'KPI (manifest): | scale | today A_op nominal / derated | recommended A_op derated | added mechanisms | hardware k |', ...kpi, `paths: findings ${man.files?.findings}; methodology ${man.files?.methodology}; bundle ${man.files?.bundle}; sidecar ${man.files?.data}`].join('\n') };
}

/** the next turn of the operator: { toolCalls: [{name, args}] } or { content } */
function operatorTurn(body) {
  const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const t = parseTask(user);
  const calls = history(body.messages);
  const pj = parseProject(user);
  if (pj) return projectTurn(t.work, calls, pj);
  const files = knownFiles(calls);
  const W = t.work, WS = `${W}/ws`, STAGING = `${W}/staging`, OUT = `${W}/out`;
  const has = (name, pred = () => true) => calls.some((c) => c.name === name && pred(c));
  const last = (name, pred = () => true) => [...calls].reverse().find((c) => c.name === name && pred(c));
  const runs = calls.filter((c) => c.name === 'hacd_ingest_run');
  const tool = (name, args) => ({ name, args });
  const runArgs = { worksheets: WS, staging: STAGING, ...(t.beforeRecord ? { beforeRecord: t.beforeRecord } : {}), out: OUT, scales: t.scales, trials: t.trials, permutations: t.permutations };
  // a command of the preparation that failed is reported, not worked around
  const broken = calls.find((c) => c.hacd && c.hacd.exitCode !== 0 && c.name !== 'hacd_ingest_run');
  if (broken) return { content: finalMessage({ status: 'failed', failedStep: { name: `hacd ${broken.name.replace(/^hacd_/, '').replace(/_/g, ' ')}`, exitCode: broken.hacd.exitCode, stderrTail: (broken.hacd.stderr ?? '').split('\n').slice(-12).join('\n') }, unresolved: [] }) };
  const runCommandText = () => { const c = runs.at(-1); return c ? `hacd ingest run --worksheets ${c.args.worksheets} --staging ${c.args.staging}${c.args.beforeRecord ? ` --before-record ${c.args.beforeRecord}` : ''} --out ${c.args.out} --scales ${c.args.scales} --trials ${c.args.trials} --permutations ${c.args.permutations} --json` : undefined; };

  /* ----- A. inputs ----- */
  if (t.prepared) {
    if (!has('list_files')) return { toolCalls: [tool('list_files', { dir: WS })] };
    const listed = safeJson(last('list_files').result, { files: [] })?.files ?? [];
    const wsFiles = listed.filter((f) => f.endsWith('.md') && !f.includes('/')).map((f) => `${WS}/${f}`);
    const unread = wsFiles.filter((p) => !files.has(p));
    if (unread.length) return { toolCalls: unread.map((p) => tool('read_file', { path: p })) };
  } else {
    const unread = t.docs.filter((d) => !files.has(d));
    if (unread.length) return { toolCalls: unread.map((p) => tool('read_file', { path: p })) };
    if (!has('hacd_ingest_template', (c) => c.args.kind === 'koujing-mapping')) {
      const batch = [tool('hacd_ingest_template', { kind: 'koujing-mapping' }), tool('hacd_ingest_template', { kind: 'mechanisms' })];
      if (t.fitDoc) batch.push(tool('hacd_ingest_import_fit', { file: t.fitDoc, id: t.ratesId, out: WS }));
      return { toolCalls: batch };
    }
    const mappingWs = `${WS}/koujing-mapping.md`, mechWs = `${WS}/mechanisms.md`, topoWs = `${WS}/topology.md`, draft = `${WS}/extract/topology.md`;
    if (!files.has(mappingWs) && t.mappingDoc) {
      const batch = [];
      // the 口径 mapping: the owner's reviewed table copied row for row into the template
      const tmpl = last('hacd_ingest_template', (c) => c.args.kind === 'koujing-mapping').hacd?.stdout ?? '';
      const [, ...rows] = csvRows(files.get(t.mappingDoc));
      let text = setFront(setFront(setFront(tmpl, 'id', `${t.ratesId}-koujing`), 'source', `${base(t.mappingDoc)} (reviewed 口径 mapping, copied row for row)`), 'mappingVersion', new Date().toISOString().slice(0, 10));
      text = replaceRows(text, 'mapping', rows.map((r) => r.slice(0, 8)));
      batch.push(tool('write_file', { path: mappingWs, content: text }));
      // the mechanism delta: only the rows the owner's note lists
      if (t.mechDoc) {
        const mt = last('hacd_ingest_template', (c) => c.args.kind === 'mechanisms').hacd?.stdout ?? '';
        const noteRows = mdTableRows(files.get(t.mechDoc)).filter((cs) => cs[0] !== 'mechanism');
        let m = setFront(setFront(mt, 'id', t.setId), 'source', `${base(t.mechDoc)}: ${g(/^Source document: (.*)$/m, files.get(t.mechDoc)) ?? 'parameter note'}`);
        m = replaceRows(m, 'parameters', noteRows.map((cs) => [cs[0], cs[1], cs[2], cs[3], cs[4], '']));
        m = replaceRows(m, 'verdicts', []);
        m = replaceRows(m, 'provenance', []);
        batch.push(tool('write_file', { path: mechWs, content: m }));
      }
      const imp = last('hacd_ingest_import_fit');
      const devices = imp ? g(/written: (\S+\.md)/, imp.hacd?.stderr ?? '') : undefined;
      if (devices) batch.push(tool('hacd_ingest_normalize', { devices, mapping: mappingWs, id: t.ratesId, out: STAGING }));
      if (t.designDoc) batch.push(tool('hacd_ingest_extract', { docs: [t.designDoc], kind: 'topology', baseUrl: t.baseUrl, model: t.model, sourceType: 'vendor', id: t.recordId, template: t.template, out: `${WS}/extract` }));
      return { toolCalls: batch };
    }
    const ex = last('hacd_ingest_extract');
    if (ex && ex.hacd && ex.hacd.exitCode !== 0) return { content: finalMessage({ status: 'failed', failedStep: { name: 'hacd ingest extract', exitCode: ex.hacd.exitCode, stderrTail: ex.hacd.stderr }, unresolved: [] }) };
    if (ex && !files.has(draft)) return { toolCalls: [tool('read_file', { path: draft })] };
    if (ex && !files.has(topoWs)) {
      let text = files.get(draft);
      text = setFront(text, 'family', JSON.stringify(t.family));
      if (t.nameZh && t.nameEn) { text = setBilingual(text, 'name', t.nameZh, t.nameEn); text = setBilingual(text, 'short', t.nameZh, t.nameEn); }
      text = setFront(text, 'scenarioId', t.recordId);
      return { toolCalls: [tool('write_file', { path: topoWs, content: text })] };
    }
  }

  /* ----- B. run ----- */
  if (!runs.length) return { toolCalls: [tool('hacd_ingest_run', runArgs)] };

  /* ----- C. read run.json ----- */
  const run = runs.at(-1);
  const after = calls.slice(calls.indexOf(run) + 1);
  const manifest = run.hacd ? safeJson(run.hacd.stdout, null) : null;
  if (!manifest) return { content: finalMessage({ status: 'failed', runCommand: runCommandText(), failedStep: { name: 'hacd ingest run', exitCode: run.hacd?.exitCode ?? null, stderrTail: (run.hacd?.stderr ?? run.result ?? '').split('\n').slice(-12).join('\n') }, unresolved: [], out: OUT }) };
  // the gates run in validate and again in dry-run: one entry per (code, field), the file-prefixed path kept
  const seen = new Map();
  for (const i of manifest.steps.flatMap((s) => s.issues ?? [])) { const k = `${i.code}:${i.path.split(': ').pop()}`; if (!seen.has(k) || i.path.includes(': ')) seen.set(k, i); }
  const issues = [...seen.values()];
  const warnings = issues.filter((i) => i.level === 'warning');
  if (manifest.status === 'ok') {
    const summaryPath = `${OUT}/SUMMARY.md`;
    if (!after.some((c) => c.name === 'read_file' && c.args.path === summaryPath)) return { toolCalls: [tool('read_file', { path: summaryPath })] };
    return { content: finalMessage({ status: 'ok', runCommand: runCommandText(), kpiTable: kpiTableOf(files.get(summaryPath) ?? ''), unresolved: [], warnings, out: OUT }) };
  }
  if (manifest.status === 'failed') {
    const f = manifest.steps.find((s) => !s.ok) ?? manifest.steps.at(-1);
    return { content: finalMessage({ status: 'failed', runCommand: runCommandText(), failedStep: { name: f?.name, exitCode: f?.exitCode, stderrTail: f?.stderrTail }, unresolved: [], warnings, out: OUT }) };
  }
  // needs-input
  const errors = issues.filter((i) => i.level === 'error');
  const wsStep = manifest.steps.find((s) => s.name === 'worksheets');
  const parseFailure = wsStep && !wsStep.ok ? wsStep.stderrTail ?? '' : '';
  const parseLine = /hacd ingest: (\S+\.md): (.*)$/m.exec(parseFailure); // "hacd ingest: <worksheet>: <row and cell>"
  const unresolvedAll = () => [...errors.map((i) => ({ path: i.path, code: i.code })), ...(parseFailure ? [{ path: parseLine?.[1] ?? 'worksheets', code: 'worksheet-parse' }] : [])];
  const giveUp = (why) => ({ content: finalMessage({ status: `needs-input (${why})`, runCommand: runCommandText(), unresolved: unresolvedAll(), warnings, out: OUT }) });
  if (runs.length > 3) return giveUp('three fix rounds done');
  if (after.some((c) => c.name === 'write_file')) return { toolCalls: [tool('hacd_ingest_run', runArgs)] };
  if (errors.some((i) => i.code === 'unknown-class') && !has('hacd_ingest_fields', (c) => c.args.kind === 'fault-rates')) return { toolCalls: [tool('hacd_ingest_fields', { kind: 'fault-rates' })] };
  const vocab = (() => { const f = last('hacd_ingest_fields', (c) => c.args.kind === 'fault-rates'); const j = f ? safeJson(f.hacd?.stdout ?? '', []) : []; return new Set((Array.isArray(j) ? j : []).map((x) => g(/^rates\.([^.]+)\.fit$/, x.path ?? '')).filter(Boolean)); })();

  const index = worksheetIndex(files);
  const edits = new Map(); // path → new text
  const current = (w) => edits.get(w.path) ?? w.text;
  const unresolved = [];
  for (const i of errors) {
    const [file, field] = i.path.split(': ');
    const id = (file ?? '').replace(/\.json$/, '');
    const w = index.find((x) => x.id === id);
    if (i.code === 'id-collision' && w) {
      const newId = w.kind === 'topology' ? t.recordId : w.kind === 'fault-rates' ? t.ratesId : t.setId;
      if (newId && newId !== w.id) { edits.set(w.path, setFront(setFront(current(w), 'id', newId), 'scenarioId', newId)); continue; }
    }
    if (i.code === 'unknown-class' && w && w.kind === 'fault-rates') {
      const cls = g(/(?:^|\.)rates\.([^.]+)$/, field ?? '') ?? ''; // 'override.rates.<class>' or 'rates.<class>'
      const [prefix, suffix] = cls.split('-');
      const mapped = CLASS_SYNONYMS[(prefix ?? '').toUpperCase()];
      const candidate = mapped ? `${mapped}-${suffix}` : null;
      if (candidate && vocab.has(candidate)) { const e = editCell(current(w), 'rates', cls, 'class', candidate); if (e) { edits.set(w.path, e); continue; } }
    }
    unresolved.push({ path: i.path, code: i.code });
  }
  if (parseFailure) {
    const file = parseLine?.[1], detail = parseLine?.[2] ?? '';
    const m = /class '([^']+)': column '([^']+)' is empty/.exec(detail);
    const w = file ? index.find((x) => x.path === file || base(x.path) === base(file)) : null;
    const e = m && w && m[2] === 'source' && t.dataSource ? editCell(current(w), 'rates', m[1], 'source', `${t.dataSource} (data owner's worksheet)`) : null;
    if (e) edits.set(w.path, e); else unresolved.push({ path: file ?? 'worksheets', code: 'worksheet-parse' });
  }
  if (!edits.size) return giveUp('nothing left that the fix table resolves');
  return { toolCalls: [...edits].map(([path, content]) => tool('write_file', { path, content })) };
}

/* ============================== the server ============================== */
let counter = 0;
const server = createServer((req, res) => {
  const send = (code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); };
  if (req.method === 'GET' && /\/models\/?$/.test(req.url ?? '')) return send(200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'mock' }] });
  if (req.method !== 'POST' || !/\/chat\/completions\/?$/.test(req.url ?? '')) return send(404, { error: { message: `no route ${req.method} ${req.url}` } });
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const body = safeJson(raw, null);
    if (!body || !Array.isArray(body.messages)) return send(400, { error: { message: 'body.messages[] is required' } });
    const prompt = body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    let message, finish;
    try {
      if (Array.isArray(body.tools) && body.tools.length) {
        const turn = operatorTurn(body);
        if (turn.toolCalls) {
          message = { role: 'assistant', content: null, tool_calls: turn.toolCalls.map((c) => ({ id: `call_${++counter}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
          finish = 'tool_calls';
          vlog(`operator → ${turn.toolCalls.map((c) => c.name).join(', ')}`);
        } else { message = { role: 'assistant', content: turn.content }; finish = 'stop'; vlog('operator → final message'); }
      } else { message = { role: 'assistant', content: extractionAnswer(body) }; finish = 'stop'; }
    } catch (e) {
      vlog('error', e.message);
      message = { role: 'assistant', content: `status: failed\nrun: (not run)\nunresolved issues: none\nmock model error: ${e.message}` }; finish = 'stop';
    }
    const completion = message.content ?? JSON.stringify(message.tool_calls ?? []);
    send(200, { id: `chatcmpl-mock-${++counter}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: MODEL, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: tokens(prompt), completion_tokens: tokens(completion), total_tokens: tokens(prompt) + tokens(completion) } });
  });
});
server.keepAliveTimeout = 10 * 60 * 1000; // a tool call (hacd ingest run) can take minutes between two requests
server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`listening http://127.0.0.1:${port}/v1`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
