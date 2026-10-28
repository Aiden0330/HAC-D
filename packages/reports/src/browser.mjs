/**
 * @hac-d/reports/browser — the kit and the recipes for a browser build (no `node:` imports, no file access): the web app's compute
 * worker renders the Findings and Methodology pages of a project with them. Before the first page, the caller registers the KaTeX
 * CSS with `setKatexCss(katexCssFrom(fonts, minCss))`, the fonts fetched from the katex package through the bundler (KATEX_FONTS
 * lists them); the Node entry (index.mjs) does the same from the installed package.
 */
export * from './kit.mjs';
export * from './content.mjs';
export { findingsHtml, FINDINGS_FILES } from './findings.mjs';
export { methodologyHtml } from './methodology.mjs';
export { bomHtml } from './bom.mjs';
export { deltaHtml, deltaMarkdown } from './delta.mjs';
export { topologySchematicSvg, TOPO_STYLE, SCHEMATIC_WIDTH } from './schematic.mjs';
