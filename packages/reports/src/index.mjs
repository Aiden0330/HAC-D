/**
 * @hac-d/reports — the bilingual HTML report kit and the three Ascend allocation report recipes, each a pure function of parsed data:
 *   findingsHtml(arch, { results, mechanisms, shapley }) → docs/ASCEND_ALLOCATION_FINDINGS_<FINDINGS_FILES[arch]>.html
 *   methodologyHtml({ results, mechanisms })             → docs/ASCEND_ALLOCATION_METHODOLOGY.html
 *   bomHtml({ bom })                                     → docs/ASCEND_BOM_100K.html
 * The recipes read no files, take no CLI arguments and use no clock: the page date is the data's `generated` field. The hacd CLI
 * (packages/cli: findings, methodology, bom) adds `provenance` (footer echo of the command, ids, options and engine version) and,
 * for Findings, the topology `record` (overlay schematic via topoGeomFromRecord). v6.3: this Node entry registers the KaTeX fonts
 * from the installed package (katex-node.mjs); `@hac-d/reports/browser` is the same kit and recipes for a web worker, where the
 * caller registers the fonts it fetched (setKatexCss); `@hac-d/reports/schematic` is the topology schematic alone (no katex).
 */
import './katex-node.mjs';
export { KATEX_CSS } from './katex-node.mjs';
export * from './kit.mjs';
export { topologySchematicSvg, TOPO_STYLE, SCHEMATIC_WIDTH } from './schematic.mjs';
export * from './content.mjs';
export { findingsHtml, FINDINGS_FILES } from './findings.mjs';
export { methodologyHtml } from './methodology.mjs';
export { bomHtml } from './bom.mjs';
/* v6: the review page of an ingest run (hacd ingest diff) */
export { deltaHtml, deltaMarkdown } from './delta.mjs';
