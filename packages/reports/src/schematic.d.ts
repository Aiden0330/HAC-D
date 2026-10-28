/** Type declarations of @hac-d/reports/schematic (src/schematic.mjs): the topology schematic as an SVG string. */
export declare const SCHEMATIC_WIDTH: number;
export declare const TOPO_STYLE: string;
/**
 * The schematic of a topology (a scenario's `topology` block, or a record with its superpod resolved) at the given counts
 * (@hac-d/core computeCounts). `embedStyle` (default true) embeds the reports' figure palette and TOPO_STYLE; false gives a bare
 * `svg.topo-pic` for the web app's stylesheet.
 */
export declare function topologySchematicSvg(
  geom: { template?: string; superpod?: Record<string, unknown> | null; scaleOut?: { portsPerNpu?: number; planes?: number } | null },
  counts: Record<string, unknown> & { scaleOutPerTier: number[] },
  lang: 'zh' | 'en',
  opts?: { embedStyle?: boolean; id?: string },
): { svg: string; width: number; height: number };
