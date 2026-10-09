/**
 * Importer types: a workbook as a flat cell list, method fingerprints, and the TopologyDraft
 * intermediate representation that both the spreadsheet importer and (later) an image adapter produce.
 */

export interface CellInfo {
  sheet: string;
  /** A1 address */
  addr: string;
  row: number; // 0-based
  col: number; // 0-based
  /** cached value (number / string / boolean) if the file carries one */
  value: number | string | boolean | null;
  /** formula text without the leading '=' when the cell is a formula */
  formula?: string;
  /** number format */
  format?: string;
}

export interface SheetInfo {
  name: string;
  rows: number;
  cols: number;
  cells: CellInfo[];
  merges: { r0: number; c0: number; r1: number; c1: number }[];
  /** Excel outline level per row (0 when absent) */
  outline: number[];
}

export interface WorkbookInfo {
  fileName: string;
  sheets: SheetInfo[];
}

export type MethodTag =
  | 'availability_mtbf_mttr'
  | 'availability_lambda_mttr'
  | 'unavailability_lambda_mttr'
  | 'fit_to_lambda'
  | 'afr_to_mtbf'
  | 'series_product'
  | 'series_rare_event_sum'
  | 'parallel_product_complement'
  | 'kofn_explicit_sum'
  | 'kofn_combin'
  | 'kofn_binom_dist'
  | 'standby_exp'
  | 'switchover_weighted'
  | 'mttr_mixture_auto_manual'
  | 'markov_mmult_minverse'
  | 'percent_to_fraction'
  | 'complement'
  | 'power_of_count'
  | 'unknown';

export interface MethodHit {
  tag: MethodTag;
  sheet: string;
  addr: string;
  formula: string;
  /** normalised shape of the formula (references replaced by R1, R2, …) */
  shape: string;
  confidence: number;
  /** extra parsed parameters (k, n, …) */
  params?: Record<string, number | string>;
}

export type ColumnRole =
  | 'name'
  | 'level'
  | 'count'
  | 'mtbf_h'
  | 'mttr_h'
  | 'fit'
  | 'lambda_per_h'
  | 'afr_pct'
  | 'availability'
  | 'availability_pct'
  | 'unavailability'
  | 'redundancy'
  | 'switchover_success'
  | 'auto_fraction'
  | 'mttr_auto_h'
  | 'mttr_manual_h'
  | 'mttr_effective_h'
  | 'group_availability'
  | 'notes';

export interface ColumnGuess {
  col: number;
  header: string;
  role: ColumnRole | null;
  confidence: number;
}

export interface SheetMethodReport {
  sheet: string;
  headerRow: number | null;
  columns: ColumnGuess[];
  hits: MethodHit[];
  /** tags with counts */
  summary: Partial<Record<MethodTag, number>>;
  notes: string[];
}

export interface MethodReport {
  fileName: string;
  sheets: SheetMethodReport[];
  /** human-readable description per detected method */
  methods: { tag: MethodTag; count: number; description: { zh: string; en: string } }[];
}

export type DraftKind = 'leaf' | 'series' | 'parallel' | 'kofn' | 'standby';

export interface DraftNode {
  id: string;
  name: string;
  kind: DraftKind;
  count: number;
  /** for kofn */
  k?: number;
  n?: number;
  params: {
    mtbfH?: number;
    mttrH?: number;
    lambdaPerH?: number;
    fit?: number;
    afrPct?: number;
    availability?: number;
    unavailability?: number;
    switchoverSuccess?: number;
    autoFraction?: number;
    mttrAutoH?: number;
    mttrManualH?: number;
  };
  redundancyText?: string;
  /** raw quantity when the sheet does not apply it (count = 1 then) */
  qtyRaw?: number;
  /** spreadsheet's own availability for this row (cached value) */
  excelAvailability?: number | null;
  /** cell that holds the row's availability */
  availabilityCell?: string;
  sourceRow: number;
  sheet: string;
  children: DraftNode[];
  /** how the parent/child relation and kind were inferred */
  evidence: string[];
}

export interface TopologyDraft {
  fileName: string;
  sheet: string;
  root: DraftNode;
  columns: ColumnGuess[];
  headerRow: number;
  notes: string[];
  /** 0..1 */
  confidence: number;
}
