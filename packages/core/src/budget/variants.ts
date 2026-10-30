/**
 * v5.9 appendix variants of the report (user's request 2026-10-29): the hierarchical budget of the records under an alternative
 * mechanism set — another checkpoint policy, such as Young's interval (C-YOUNG) on the reference set or C-MEM instead of C-FAST —
 * reduced to what Appendix A of the Findings pages prints per scale: the derated design's τ / δ and saves, the goodputs, the
 * requirement of formula (2′) with its two ends, and the window rule's plan or, when no move set reaches the goal, the all-moves
 * design with its ceiling. The variant is computed with the main run's candidates, levers, split, derating, windows and seed
 * (`budgetFromRecords` on the variant set); the main document's tables never read it.
 */
import type { BudgetDocument, BudgetResult } from './index.js';
import { mechanismLibraryTable } from './index.js';
import { resolveMechanismSet, type MechanismSet } from '../records/mechanismSet.js';
import type { LeverId } from '../strategy/index.js';
import type { Requirement } from '../strategy/requirement.js';

export interface VariantSizeRow {
  npus: number;
  /** the reference design under the variant, derated: checkpoint period and save time (s), saves per job hour (3600 δ/τ), the effective and delivered goodput, MTBF_hw (h, null without hard interruptions), R_eff (s) */
  today: { tauS: number; deltaS: number; saveSPerH: number; effective: number; delivered: number; mtbfHwH: number | null; lossS: number };
  /** formula (2′) on the variant's derated design */
  required: Pick<Requirement, 'B' | 'totalBudget' | 'reachable' | 'terms' | 'mtbfAtTodayMttrH' | 'mttrAtTodayMtbfS'>;
  /** the window rule's recommended plan under the variant, or (feasible false) the all-moves design at k = 1 with the ceiling at perfect hardware (derated) */
  recommended: {
    feasible: boolean; cause?: NonNullable<BudgetResult['recommended']['cause']>;
    mechanisms: string[]; levers: LeverId[]; k: number; effective: number; delivered: number;
    pWindow: number; verdict: string; ceiling: number | null; constrained: number | null;
  };
}
export interface VariantSummary {
  /** the variant's mechanism set */
  id: string;
  source: string;
  baseline: string[];
  /** what the variant's baseline adds to / removes from the main run's reference set */
  added: string[];
  removed: string[];
  /** the added mechanisms' library rows (name, change, nominal and derated parameters, effort) */
  mechanisms: ReturnType<typeof mechanismLibraryTable>;
  archs: Record<string, VariantSizeRow[]>;
}

/** the appendix rows of a variant run: `main` the report's document (its reference set), `set` the variant set, `doc` its budget document */
export function variantSummary(main: BudgetDocument, set: MechanismSet, doc: BudgetDocument): VariantSummary {
  const r = resolveMechanismSet(set);
  const added = r.baseline.filter((id) => !main.reference.includes(id)), removed = main.reference.filter((id) => !r.baseline.includes(id));
  const archs: Record<string, VariantSizeRow[]> = {};
  for (const [arch, A] of Object.entries(doc.archs)) {
    archs[arch] = doc.sizes.map((n) => {
      const z = A.sizes[String(n)];
      if (!z) throw new Error(`variant ${set.id}: no budget of ${arch} at ${n} NPUs`);
      const k = z.today.kpiDerated, q = z.required, rc = z.recommended, f = rc.final.kpiDerated;
      return {
        npus: n,
        today: { tauS: k.tauS, deltaS: k.deltaS, saveSPerH: 3600 * k.saveFrac, effective: k.effective, delivered: k.delivered, mtbfHwH: Number.isFinite(k.mtbfHwH) ? k.mtbfHwH : null, lossS: k.lossS },
        required: { B: q.B, totalBudget: q.totalBudget, reachable: q.reachable, terms: { ...q.terms }, mtbfAtTodayMttrH: q.mtbfAtTodayMttrH, mttrAtTodayMtbfS: q.mttrAtTodayMtbfS },
        recommended: {
          feasible: rc.feasible !== false, ...(rc.cause ? { cause: rc.cause } : {}),
          mechanisms: [...rc.mechanisms], levers: [...rc.levers], k: rc.k, effective: f.effective, delivered: f.delivered,
          pWindow: rc.window.pAtLeastTarget, verdict: rc.window.verdict,
          ceiling: rc.ceiling ? rc.ceiling.derated : null, constrained: rc.ceiling?.constrained ? rc.ceiling.constrained.derated : null,
        },
      };
    });
  }
  return { id: set.id, source: set.source, baseline: [...r.baseline], added, removed, mechanisms: mechanismLibraryTable(added, r.parameters, r.derate, r.efforts), archs };
}
