/**
 * Type declarations of @hac-d/reports (the implementation is plain ESM JavaScript, src/index.mjs). Inputs are loose on purpose —
 * the recipes validate their data and throw on inconsistencies — but nothing is `any`.
 */

/* ---------------- recipes (pure: no file access, no CLI arguments, no clock) ---------------- */
export type ReportData = Record<string, unknown>;
/** architecture id → file suffix of docs/ASCEND_ALLOCATION_FINDINGS_<suffix>.html */
export declare const FINDINGS_FILES: Readonly<{ native950: '950'; ubl128: 'UBL128'; cm384: 'CM384'; a3server: 'A3SERVER' }>;
export type FindingsArch = keyof typeof FINDINGS_FILES;
/**
 * v5 provenance of a report produced by the hacd CLI: the footer's data / reproduce sentence names these instead of the v4.4
 * script paths (absent: the footer is exactly the v4.4 text).
 */
export interface ReportProvenance {
  /** the hacd command line that reproduces the file */
  command: string;
  records: { id: string; name?: Bilingual | string }[];
  set: { id: string; source?: string };
  rates?: { id: string; basis: string };
  options: { scales?: number[]; target?: number; /** v5.6 the acceptance metric of the target */ metric?: 'aOp' | 'effective'; trials?: number; seed?: number; permutations?: number; npus?: number };
  /** version of packages/core/package.json and the short git hash when available */
  engine: { version: string; commit?: string };
}
/** Findings page of one architecture; `results` / `mechanisms` = docs/backup/ascend-allocation/{results,mechanisms}.json, `shapley` = docs/backup/arch-mechanism-shapley/<arch>.json (sizes = results.sizes); `record` (superpod resolved, @hac-d/core recordSuperpod) draws the overlay schematic of a record outside TOPO_GEOM */
export declare function findingsHtml(arch: string, data: { results: ReportData; mechanisms: ReportData; shapley: ReportData; record?: ReportData; provenance?: ReportProvenance }): string;
/** Methodology page; `results` / `mechanisms` = docs/backup/ascend-allocation/{results,mechanisms}.json */
export declare function methodologyHtml(data: { results: ReportData; mechanisms: ReportData; provenance?: ReportProvenance }): string;
/** 100k BOM page; `bom` = docs/backup/ascend-allocation/bom.json (the four built-in architectures) */
export declare function bomHtml(data: { bom: ReportData; provenance?: ReportProvenance }): string;
/** v6 review page of an ingest run; `delta` = the delta.json of `hacd ingest diff` (@hac-d/core deltaDocument), `provenance` fills the footer */
export declare function deltaHtml(data: { delta: ReportData; provenance?: Pick<ReportProvenance, 'command' | 'engine'> }): string;
/** the same content as Markdown, for review queues and pull requests */
export declare function deltaMarkdown(delta: ReportData, lang?: 'zh' | 'en'): string;

/* ---------------- methodology prose ---------------- */
export interface Bilingual { zh: string; en: string }
export declare function contentFor(ctx?: Record<string, unknown>): Record<string, unknown>;
export declare const DEFAULT_CTX: Record<string, unknown>;
export declare const TITLE: Bilingual;
export declare const SUBTITLE: Bilingual;
export declare const FOOTER: Bilingual;
export declare const SCOPE: Record<string, unknown>;
export declare const FORMULAS: Record<string, unknown>;
export declare const LAYERS_TEXT: Record<string, unknown>;
export declare const MECH_TEXT: Record<string, unknown>;
export declare const BUDGET_TEXT: Record<string, unknown>;
export declare const TOOLING: Record<string, unknown>;

/* ---------------- kit: text and numbers ---------------- */
export declare function esc(s: unknown): string;
export declare function fmt(n: number, d?: number): string;
export declare function tw(s: string, fs?: number, mono?: boolean): number;
export declare function wrap(text: string, maxW: number, fs?: number, mono?: boolean): string[];
export declare function lines(x: number, y: number, ls: string[], cls: string, lh: number, anchor?: string): string;
export declare function textBlock(x: number, y: number, text: string, maxW: number, cls?: string, fs?: number, lh?: number, anchor?: string): { svg: string; h: number };
export declare function pct(x: number, d?: number): string;
export declare function fk(k: number): string;
export declare function pP(p: number): string;
export declare function f2(v: number): string;
export declare function kN(n: number, lang: 'zh' | 'en'): string;
export declare function hours(h: number, lang: 'zh' | 'en'): string;
export declare function secs(s: number): string;

/* ---------------- kit: SVG figures ---------------- */
export interface Rect { x: number; y: number; w: number; h: number }
export interface LegendItem { label: string; cls?: string; style?: string; line?: boolean }
export declare const FS: number;
export declare function sz(base: number): number;
export declare const W: number;
export declare function svgOpen(id: string, w: number, h: number, label: string): string;
export declare function svgDyn(id: string, label: string, w?: number): string;
export declare function svgClose(g: string, H: number, w?: number): string;
export declare function titleBlock(label: string, w?: number): { svg: string; dy: number };
export declare function legend(x: number, y: number, items: LegendItem[], maxX?: number): { g: string; y: number };
export declare const FLOW: string;
export declare function arrowDefs(id: string): string;
export declare function arrow(id: string, d: string, dashed?: boolean): string;
export declare function node(x: number, y: number, w: number, cls: string, title: string, sub?: string, pad?: number, titleFs?: number): { svg: string; h: number; cx: number; bottom: number; x: number; y: number; w: number };
export declare function chipW(label: string): number;
export declare const CHIP_H: number;
export declare function flow(labels: string[], xa: number, width: number): { pos: { x: number; line: number; w: number }[]; lines: number; rowH: number };
export declare function chip(x: number, y: number, w: number, cls: string, label: string, tip?: string, rx?: number): string;
export declare function tiny(x: number, y: number, t: string, anchor?: string, style?: string): string;
export declare function ENDS(T: (zh: string, en: string) => string): [string, string, string][];
export interface TopoGeom { podCabinets: number; commCabinets: number; nodesPerCabinet: number; npusPerNode: number; cpusPerNode: number; fabric: 'two-level' | 'mesh-clos' | 'mesh-4d' | 'blade-clos' | 'server'; soTiers: number; ubLabel: Bilingual; podLabel: Bilingual }
export declare const TOPO_GEOM: Record<string, TopoGeom>;
/** schematic geometry of a topology record (superpod resolved over its preset); `counts.scaleOutTiers` at the main scale */
export declare function topoGeomFromRecord(record: { id: string; short: Bilingual; superpod: Record<string, unknown>; schematic?: { ubLabel?: Bilingual; podLabel?: Bilingual } }, counts: { scaleOutTiers: number }): TopoGeom;
/** the footer's data / reproduce sentence (HTML) of a CLI-produced report */
export declare function provenanceFooter(p: ReportProvenance, lang: 'zh' | 'en', files: string[], date: string): string;
export declare function drawLayer(topo: string | TopoGeom, layer: 'cluster' | 'scaleout' | 'superpod' | 'cabinet' | 'node' | 'npu', x: number, y: number, w: number, h: number, T: (zh: unknown, en: unknown) => unknown): { svg: string; zoom: Rect | null; outer: Rect | null };
export declare function zoomLines(z: Rect, o: Rect): string;
/* v6.3 the topology schematic shared with the web app (src/schematic.mjs; also the entry @hac-d/reports/schematic) */
export { topologySchematicSvg, TOPO_STYLE, SCHEMATIC_WIDTH } from './schematic.js';

/* ---------------- kit: KaTeX and the page shell ---------------- */
/** the KaTeX CSS with the fonts embedded (Node entry only; a browser build registers its own through setKatexCss) */
export declare const KATEX_CSS: string;
/** the fonts a report may need: [family, style, file name without extension] */
export declare const KATEX_FONTS: [string, string, string][];
export declare function katexCssFrom(fonts: { family: string; style: string; base64: string }[], minCss: string): string;
/** register the KaTeX CSS the page shell embeds (done by the Node entry; a browser build calls it with the fonts it fetched) */
export declare function setKatexCss(css: string): void;
export declare function katexCss(): string;
export declare function tex(src: string, display?: boolean): string;
export declare function M(src: string): string;
export declare function katexFontGuard(): void;
export declare const BASE_CSS: string;
export declare const KIT_CSS: string;
export declare function pages(sections: string[], eyebrow: (i: number, n: number) => string): string;
export declare function pageShell(opts: { title: string; description: string; zhBody: string; enBody: string; extraCss?: string }): string;
