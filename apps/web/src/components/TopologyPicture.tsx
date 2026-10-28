import { useMemo } from 'react';
import type { Counts, Scenario } from '@hac-d/core';
import { topologySchematicSvg } from '@hac-d/reports/schematic';
import type { Lang } from '../lib/format.js';

/**
 * v4 live schematic of the topology templates, drawn from the current unit counts. v6.3: the drawing is the shared pure function
 * of @hac-d/reports (schematic.mjs) — the same figure the Findings and BOM reports carry — rendered here without an embedded style
 * (the `tp-*` classes are styled by app.css). Counts in the labels are the engine's (`computeCounts`); the drawing shows at most a
 * handful of each unit with an ellipsis and the total.
 */
export function TopologyPicture({ scenario, counts, lang }: { scenario: Scenario; counts: Counts; lang: Lang }) {
  const html = useMemo(() => topologySchematicSvg(scenario.topology, counts as unknown as Record<string, unknown> & { scaleOutPerTier: number[] }, lang, { embedStyle: false }).svg, [scenario.topology, counts, lang]);
  // the SVG string comes from our own pure function over the scenario's numbers (no user-provided markup)
  return <div className="table-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}
