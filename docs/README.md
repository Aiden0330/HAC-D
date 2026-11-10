# Report pages in `docs/`

Status on 2026-11-09 (HAC-D v5.12). Three groups:

- **Current** — written by the report pipeline from the input records; `node packages/reports/test/reproduce.mjs` re-renders them byte for byte from `docs/backup/ascend-allocation`. Quote numbers from these pages only.
- **Background** — evidence, architecture and method pages. They carry no allocation result that a later version replaced; where they quote engine numbers, the engine version is given.
- **Superseded** — results of an earlier engine version, failure-rate basis or mechanism set. Kept as the record of how the study developed; their numbers are not the tool's present answer.

The basis of each generation, so that numbers are not compared across them:

| Generation | Dates | Target and basis | Failure rates | Mechanisms |
|---|---|---|---|---|
| 1 · allocation studies | 2026-10-14 … 16 | A_op ≥ 98.5 %, nominal and derated | 54-event reference catalog, FIT per card | ReMAP's original set, the 16 added mechanisms, the latest ReMAP set; ARINC and AGREE splits |
| 2 · v4 reports | 2026-10-19 … 20 | A_op ≥ 98.5 %, nominal and derated; the 2026-10-20 summary adds the share of windows | per card (the level and summary pages) or converted per hardware unit (the scaling and 500k pages) | six default mechanisms; candidates from the library of that date (D-HARD, R-NETFAIL, …) and the recovery levers |
| 3 · v5 report set | 2026-10-21 … 11-01 | A_op until v5.5 (2026-10-28), then effective goodput G_eff ≥ 98.5 % (v5.6 – v5.11) | per hardware unit from the topology records | reference set + pruned candidates, window rule |
| 4 · three-target report | 2026-11-09 (v5.12) | A_op ≥ 98.5 % for the allocation; floors on G_eff (97 %) and G_del (90 %) as two tiers | as generation 3, plus the field-level case | as generation 3 |

## Current

| Page | Content | Written |
|---|---|---|
| [ASCEND_ALLOCATION_METHODOLOGY.html](ASCEND_ALLOCATION_METHODOLOGY.html) | The method: formulas 1–8 with their 口径, the window rule, the hardware split, the mechanism set and the pruning rule, the procedure; zh / en in one file | 2026-11-09 · `hacd findings` |
| [ASCEND_ALLOCATION_FINDINGS_950.html](ASCEND_ALLOCATION_FINDINGS_950.html) | Native Atlas 950 SuperPoD at 10k / 100k / 200k / 500k NPUs: Tables 1–6 (the A_op allocation: today, requirement, recommended moves, k, the allowed FIT by layer and unit, mechanism parameters, MTTR composition, the mechanism set), Table 7 (checkpoint tier), Table 8 (delivered tier), Table 9 (field-level case), Appendix A (C-MEM in place of C-FAST) | 2026-11-09 · `hacd findings` |
| [ASCEND_ALLOCATION_FINDINGS_UBL128.html](ASCEND_ALLOCATION_FINDINGS_UBL128.html) | The same for Atlas 950 SuperPoD Flex (UBL128) | 2026-11-09 |
| [ASCEND_ALLOCATION_FINDINGS_CM384.html](ASCEND_ALLOCATION_FINDINGS_CM384.html) | The same for the 910C CloudMatrix384 | 2026-11-09 |
| [ASCEND_ALLOCATION_FINDINGS_A3SERVER.html](ASCEND_ALLOCATION_FINDINGS_A3SERVER.html) | The same for the Atlas 800T A3 server cluster | 2026-11-09 |
| [ASCEND_BOM_100K.html](ASCEND_BOM_100K.html) | Hardware counts and the interruption FIT by unit of 18 designs at 100,000 NPUs, with the topology schematics | 2026-10-27 · `hacd bom`; the v5.12 change does not touch its data |
| [USER_MANUAL.html](USER_MANUAL.html) · [USER_MANUAL.zh.html](USER_MANUAL.zh.html) | The user manual with page images and the methods reference | 2026-11-09 · `npm run manual` |

Regenerate: `hacd findings --record native950,ubl128,cm384,a3server --study-dir docs/backup/arch-mechanism-shapley --field-rates field-llama3-2026-11 --variants remap-latest-2026-10--cmem --out docs --data-out docs/backup/ascend-allocation`; after a recipe change alone, `hacd findings --data docs/backup/ascend-allocation --out docs`.

## Background

| Page | Content | Date · engine |
|---|---|---|
| [ASCEND_CLUSTER_ARCHITECTURE.zh.html](ASCEND_CLUSTER_ARCHITECTURE.zh.html) · [.en.html](ASCEND_CLUSTER_ARCHITECTURE.en.html) | Ascend cluster architectures from public material: levels, three generations of topology, the CloudMatrix384 UB fabric, where the catalog's 18 hardware domains sit | zh 2026-10-20 (v4.3); en is the 2026-10-16 edition |
| [ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html](ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html) | Evidence survey: Atlas 950, Atlas 960E, the roadmap and customer deployments, with the public reliability figures | 2026-10-19 · v4.2 |
| [RELIABILITY_MODELING_TECH_SURVEY.html](RELIABILITY_MODELING_TECH_SURVEY.html) | Modeling technologies for AI-cluster reliability and a 500k-NPU design discussion | 2026-10-15 |
| [ALLOCATION_METHODS_SUMMARY.zh.html](ALLOCATION_METHODS_SUMMARY.zh.html) · [.en.html](ALLOCATION_METHODS_SUMMARY.en.html) | The classical allocation methods (equal, ARINC, AGREE, feasibility, minimum effort, cost-optimal, unavailability split) with formulas and the engine's algorithms | 2026-10-16 |
| [ALLOCATION_STRATEGY_V4.zh.html](ALLOCATION_STRATEGY_V4.zh.html) · [.en.html](ALLOCATION_STRATEGY_V4.en.html) | The three allocation strategies of the Strategies tab (optimal, MTTR reduction preferred, MTTF reduction preferred) and the hardware split; the 500k example in it is a v4 result | 2026-10-19 · v4 |
| [HACD_REMAP_COMPARISON.zh.html](HACD_REMAP_COMPARISON.zh.html) · [.en.html](HACD_REMAP_COMPARISON.en.html) | HAC-D against ReMAP and the reference engine: data provenance, the 950 differences, the availability formulas. The later text comparison is `markdown/TOOL_COMPARISON.md` | 2026-10-20 · v4.3 |
| [design/TOPOLOGY_PAGE_OPTIONS.html](design/TOPOLOGY_PAGE_OPTIONS.html) | Design options for the Topology page (UI study) | 2026-10-16 |

## Superseded

| Page | What it was | Date · basis | Read instead |
|---|---|---|---|
| [ASCEND_ALLOCATION_SUMMARY.zh.pptx](ASCEND_ALLOCATION_SUMMARY.zh.pptx) · [.en.pptx](ASCEND_ALLOCATION_SUMMARY.en.pptx) | Slides of the first six-file report set | 2026-10-21 · v5.0, A_op | the current Findings pages (same basis; values moved with the v5.5 and v5.8 corrections) |
| [ASCEND_AVAILABILITY_ALLOCATION.html](ASCEND_AVAILABILITY_ALLOCATION.html) · [ASCEND_AVAILABILITY_ALLOCATION-Opus5.5.html](ASCEND_AVAILABILITY_ALLOCATION-Opus5.5.html) | One-file allocation summary of three topologies (and a second build of the same summary) | 2026-10-20 · v4.3, A_op, FIT per card | Findings pages, Table 1 |
| [ARCH_ALLOCATION_98P5_500K.zh.html](ARCH_ALLOCATION_98P5_500K.zh.html) · [.en.html](ARCH_ALLOCATION_98P5_500K.en.html) | 98.5 % at 500k across six architectures: hardware alone, then D-HARD + R-NETFAIL and two levers | 2026-10-20 · v4.3, A_op | Findings pages, Table 1 at 500k (the candidates are now those of the pruned set; R-NETFAIL is not among them) |
| [ATLAS950_LEVEL_ALLOCATION.zh.html](ATLAS950_LEVEL_ALLOCATION.zh.html) · [.en.html](ATLAS950_LEVEL_ALLOCATION.en.html) | Atlas 950 by topology level on the per-card catalog | 2026-10-20 · v4.3, A_op, FIT per card | Findings 950, Tables 2 and 3 |
| [ASCEND950_SCALING_RELIABILITY.zh.html](ASCEND950_SCALING_RELIABILITY.zh.html) · [.en.html](ASCEND950_SCALING_RELIABILITY.en.html) | Native 950 and UBL128 from 10k to 500k: hardware scale, A_op with scale, thresholds, bottleneck classes | 2026-10-20 · v4.3, A_op | counts: the BOM page; "today" and the requirement: Findings Table 1 (the page's requirement is the nominal one, the current pages decide on the derated value) |
| [ASCEND910C_SCALING_RELIABILITY.zh.html](ASCEND910C_SCALING_RELIABILITY.zh.html) · [.en.html](ASCEND910C_SCALING_RELIABILITY.en.html) | The same for CloudMatrix384 and the 800T A3 server cluster | 2026-10-20 · v4.3, A_op | as above |
| [MTBF_MTTR_TOPDOWN.zh.html](MTBF_MTTR_TOPDOWN.zh.html) · [.en.html](MTBF_MTTR_TOPDOWN.en.html) | Top-down from the availability target to the MTBF and MTTR each scale needs (A3 · CloudMatrix384 main case) | 2026-10-19 · v4, A_op | Methodology formula 2; Findings Table 1 |
| [HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html](HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html) | The split between hardware FIT and mechanisms; why ARINC can allow a FIT above today's | 2026-10-16 · A_op, FIT per card | Methodology (hardware split); Findings Tables 1–3 |
| [REMAP_LATEST_ALLOCATION_98P5.zh.html](REMAP_LATEST_ALLOCATION_98P5.zh.html) · [REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html](REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html) | Allocation with ReMAP's latest mechanism set, ARINC and AGREE | 2026-10-15 / 16 · A_op, FIT per card | Findings pages |
| [REMAP_ALLOCATION_98P5.zh.html](REMAP_ALLOCATION_98P5.zh.html) · [REMAP_ALLOCATION_98P5_AGREE.zh.html](REMAP_ALLOCATION_98P5_AGREE.zh.html) | Allocation with ReMAP's original mechanisms only, ARINC and AGREE | 2026-10-15 / 16 · A_op, FIT per card | Findings pages |
| [MECHANISM_COMPARISON_98P5.zh.html](MECHANISM_COMPARISON_98P5.zh.html) · [MECHANISM_COMPARISON_98P5_AGREE.zh.html](MECHANISM_COMPARISON_98P5_AGREE.zh.html) | ReMAP's original mechanisms against the 16 added ones and both together | 2026-10-15 / 16 · A_op, FIT per card | Findings Table 6 (the set with its verdicts and Shapley values) |
| [AVAILABILITY_ALLOCATION_98P5.zh.html](AVAILABILITY_ALLOCATION_98P5.zh.html) | The first allocation study at four scales | 2026-10-15 · A_op, FIT per card | Findings pages |
| [ALLOCATION_METHODS_MECHANISM_PARAMETERS.zh.html](ALLOCATION_METHODS_MECHANISM_PARAMETERS.zh.html) | Allocation methods and the parameter allocation of the 19 mechanisms the library then had | 2026-10-14 | ALLOCATION_METHODS_SUMMARY; the Mechanism library page of the app |

The Findings pages written between 2026-10-28 and 2026-11-01 (v5.6 – v5.11, the effective-goodput basis: "98.5 % out of reach" at every scale, Appendix A1–A3) are in the git history of the five current files (`git log -- docs/ASCEND_ALLOCATION_FINDINGS_950.html`); `hacd findings --metric effective --variants …` writes that form again.

Data behind the pages: `docs/backup/<study>/` (one folder per study; `ascend-allocation` for the current set). Pilot evidence of the operator protocol: `docs/backup/pilots/`.
