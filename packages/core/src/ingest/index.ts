/**
 * v6 ingest primitives (docs/markdown/PLAN_V6_INPUT_MIGRATION.md): closed vocabularies and field paths, evidence cards with their
 * grounding and agreement checks, the 口径 normaliser (device FIT → business-impact FIT per unit), the validation gates beyond the
 * record schemas, the input / KPI delta, and extension requests. Pure functions; the worksheets (Markdown) live in @hac-d/importers,
 * the model adapters in @hac-d/agent, the commands in the hacd CLI (`hacd ingest …`).
 */
export * from './fields.js';
export * from './evidence.js';
export * from './koujing.js';
export * from './validate.js';
export * from './diff.js';
export * from './extension.js';
