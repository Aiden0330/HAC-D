/**
 * @hac-d/reports — the bilingual HTML report kit and the three Ascend allocation report recipes, each a pure function of parsed data:
 *   findingsHtml(arch, { results, mechanisms, shapley }) → docs/ASCEND_ALLOCATION_FINDINGS_<FINDINGS_FILES[arch]>.html
 *   methodologyHtml({ results, mechanisms })             → docs/ASCEND_ALLOCATION_METHODOLOGY.html
 *   bomHtml({ bom })                                     → docs/ASCEND_BOM_100K.html
 * The recipes read no files, take no CLI arguments and use no clock: the page date is the data's `generated` field. The hacd CLI
 * (packages/cli: findings, methodology, bom) adds `provenance` (footer echo of the command, ids, options and engine version) and,
 * for Findings, the topology `record` (overlay schematic via topoGeomFromRecord).
 */
export * from './kit.mjs';
export * from './content.mjs';
export { findingsHtml, FINDINGS_FILES } from './findings.mjs';
export { methodologyHtml } from './methodology.mjs';
export { bomHtml } from './bom.mjs';
