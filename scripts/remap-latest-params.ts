/**
 * Parameters of the latest ReMAP's 16 extensions (remap/remap-latest, commit f53ab7e; extension definitions unchanged since eaacb05)
 * mapped to HAC-D's mechanism parameters. The values now live in the default mechanism set record
 * packages/core/data/mechanism-sets/remap-latest-2026-10.json (DEFAULT_MECHANISM_SET.parameters, with its source and the folded
 * expectations: startup stages at 95 % eligibility, async blocking 4 x 5 % + 1 x 95 % = 1.15 s, ...); this module re-exports them for
 * the session scripts.
 */
import { DEFAULT_MECHANISM_SET } from '../packages/core/src/records/mechanismSet.js';

/** ReMAP-latest extensionScenario() + parameterSets mapped to HAC-D's parameters (from the mechanism set record) */
export const REMAP_LATEST_PARAMS: Record<string, Record<string, number>> = DEFAULT_MECHANISM_SET.parameters;
