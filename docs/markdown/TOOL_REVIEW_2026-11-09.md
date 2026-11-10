# HAC-D tool review, 2026-11-09

Reviewed at commit 532fc8e (version 0.5.11), by Claude in one session, on the request "review the tool; my goals feel not achieved and I am not sure the models are correct".
Scope: the goals as the plan, the specification and the recorded decisions state them; the published report set (Findings 950, Methodology); the training model, the allocation and the window rule in `packages/core`; the inputs behind the "today" values. The evidence scripts of this review are in `data-staging/tool-review-2026-11-09/` (ignored by git); section 7 lists what was not reviewed.

## 1. Verdict

1. **The mathematics is right for the model it states.** An independent simulation written for this review from the prose of MODEL_REFERENCE §19–§21 reproduces the engine's effective and delivered goodput at 10k, 100k and 500k NPUs, nominal and derated, and the one feasible 500k plan of Appendix A1 (section 4.1). All 1,075 tests pass, and 16 classic formulas match an independent calculation.
2. **The allocation goal was met on its original basis and lost when the target moved.** From 2026-10-15 to v5.5 the goal was an operational availability A_op of 98.5 % (running share of the window). On 2026-10-28 the same number was moved to the effective goodput. With the reference checkpoint mechanism (a save of 1 s every 60 s, 1.5 s derated) the saves alone cost 1/60 = 1.67 % nominal and 1.5/60 = 2.5 % derated of the running time, more than the whole 1.5 % budget, so the goal is out of reach at every scale, including 10k NPUs where the job is interrupted once in 32 hours. Tables 1–5 of every Findings page then describe a design that fails the goal, with a hardware factor of 1.00. On the A_op basis the same engine returns a complete allocation at every scale today (section 3.2).
3. **The inputs are scenario values, not evidence.** All 60 fault classes carry the confidence "assumed". The hard-interruption basis, 3,097 FIT per NPU, is 3 to 11 times below the field rates of the survey chapter, which sit in the tool's own parameter library (section 4.2, item 1). The mechanism parameters are targets of the reference tools. "Today" in the report means "under the reference catalog", and the conclusions move by tens of points with that basis.
4. **Three statements printed in the report are wrong or misleading** (section 5): "out of reach by hardware alone" under the Young variant at 500k, two different hardware requirements in one appendix row, and "allowed FIT" columns printed for designs that do not meet the goal.

The remaining sections give the evidence, the ranked assumptions, the recommendations and four questions.

## 2. What was done

| Check | Method | Result |
|---|---|---|
| Test suite at HEAD | `npm test` on Node 24 | 921 core + 56 importers + 37 agent + 46 reports + 15 CLI = 1,075 passed |
| Goldens | count of the vectors in `packages/core/test/golden/golden*.json` | 578 vectors in 7 files |
| Training model, today's designs | independent event simulation in Python (`des.py`, written from the prose semantics, not from `mc/ledger.ts`), native 950 at 10k / 100k / 500k, nominal and derated, 1,500–4,000 windows each | section 4.1 |
| Training model, a plan design | the same simulation with transparent rungs, levers, hardware factors and its own Young interval (`des2.py`) on the Appendix A1 plan at 500k | section 4.1 |
| Formulas re-derived by hand | mixed exact renewal, requirement (2′), P_clear, the pre-episode loss U, the detection mixture, the global recovery | all as documented |
| Classic formulas | 16 values (Young, Daly three-term and exact, renewal, Daly goodput, mixed renewal, Saxena, FIT / node-day / AFR conversions, binomial and Poisson spares, Poisson blocking, straggler law, A from MTTF / MTTR) against Python | agreement to 1e-8 or better |
| Allocation | effort and hardware factor of the report's plan against five alternative move sets (`effort.mjs`) | the plan is at or near the least effort among them |
| Acceptance basis | `hacd budget --metric aOp` at the four scales | section 3.2 |
| Inputs | every class of the native 950 scenario at 500k listed; compared with survey Table 3-2 and the library records | section 4.2 |
| Sensitivity | hard FIT × 3.2 / 6.5 / 11, save time 1 / 0.5 / 0.3 / 0.1 s under Young (`whatif.mjs`) | sections 3.3 and 4.2 |
| Pages against the report | Topology page of the Atlas 950 project in the browser | the KPI strip shows the report's values (97.46 %, 32.28 h, 109.5 s, 3,098 FIT) |

## 3. The goals

### 3.1 Status against the stated goals

| Goal (source) | Status | Remark |
|---|---|---|
| Evaluate a design: availability, MTBF / MTBI, MTTR, goodput (plan UC1, UC2) | achieved | closed forms, flags, cross-check with the reference engine, this review's simulation |
| Every number with its formula and 口径 (CLAUDE.md, F1) | achieved | notes under every table, event classes kept apart |
| Allocate a target to hardware MTBF, recovery MTTR and mechanisms (UC5; the request of 2026-10-15 and 10-20) | achieved in the engine, not delivered by the current report | section 3.2 |
| Compare architectures and design options (UC6) | weak | the four architectures differ only by unit counts: 3,043–3,384 FIT per NPU, less than 1 point of goodput at every scale; redundancy and topology-specific recovery are not credited in the training model (decision of 2026-10-29) |
| Parameters from evidence with provenance (plan §1, F4) | fields exist, substance missing | section 4.2, item 1 |
| Scale extrapolation with validity flags and scale laws for MTTR (plan §1) | partly | the engine has scale laws; the record-based reports use none: the loss per interruption is 109 s at 10k and at 500k |
| Non-exponential and correlated inputs through Monte Carlo (plan §1, F3) | partly | the classic Monte Carlo module does; the training model and the window ledger are exponential and independent, and list the inputs they ignore |
| Spares by quantile (UC4) | in the engine, absent from the report | records set 0 hot spares, so blocking is 0 and replacement capacity is taken as always available |
| Findings report as self-contained bilingual pages (UC11, v5) | achieved | reproducible from records, byte-identical |
| Internal inputs through worksheets and an on-prem model (v6) | built, not yet used on real data | the repository holds mock-model pilots only |
| One place per function, a usable app (v5.1–v6.4) | achieved | eight pages, the Report tab runs the pipeline |

### 3.2 Why the report says "out of reach", and what the same engine says on the availability basis

The target of the first allocation study (`docs/AVAILABILITY_ALLOCATION_98P5.zh.html`, 2026-10-15) was "98.5 % 运行可用率": A_op, the running share of the 30-day window, "不含 checkpoint 保存、回滚与静默错误损失". The scenario documents still carry `targets.operational = 0.985` and `targets.goodput = 0.90`. The decision of 2026-10-28 ("the output report uses goodput as default availability value … the 98.5 % goal is also based on goodput") moved the number to the effective goodput G_eff, which adds the checkpoint saves, the recompute after rollbacks and the throughput factors.

Loss budget at the target: 1 − 0.985 = 54 seconds per hour. Under the reference mechanism C-FAST the saves take 60 s/h nominal (1/60) and 90 s/h derated (1.5/60). No hardware or recovery improvement can pay for that.

Native 950, derated values, today's design:

| Scale | MTBF_hw | A_op | G_eff | lost to saves | lost to pauses and recompute (all event classes) | lost to throughput factors | G_del |
|---|---|---|---|---|---|---|---|
| 10k | 32.3 h | 99.91 % | 97.46 % | 2.44 pt | 0.10 pt | 0.01 pt | 96.94 % |
| 100k | 3.2 h | 99.11 % | 96.55 % | 2.42 pt | 0.98 pt | 0.05 pt | 91.73 % |
| 500k | 38.7 min | 95.70 % | 92.70 % | 2.32 pt | 4.72 pt | 0.25 pt | 73.95 % |

At 10k the hardware and the recovery chain cost 0.10 point; the 2.44 points come from one assumed pair of numbers. The reference set without C-FAST (the baseline save of 4 s every 300 s) gives 98.56 % nominal and 98.55 % derated at 10k: the mechanism "kept as is" is what fails the goal there. Its Shapley value in Table 6 is −0.74 point at 10k and −0.25 at 100k.

The same pipeline on the A_op basis (`hacd budget --record native950 --scale N --metric aOp`, 400 windows, seed 1):

| Scale | Today A_op nominal / derated | Requirement (2) | Plan | Hardware factor k | Plan A_op nominal / derated | P(window) | G_eff of the plan, derated |
|---|---|---|---|---|---|---|---|
| 10k | 99.92 / 99.91 % | met | no move | ceiling × 14.3 | 99.92 / 99.91 % | 92.5 % | 96.23 % |
| 100k | 99.21 / 99.11 % | met | no move | ceiling × 1.31 | 99.21 / 99.11 % | 93.5 % | 96.27 % |
| 200k | 98.42 / 98.23 % | MTBF_hw ≥ 1.93 h or MTTR_hw ≤ 83 s | manual fallback 2 h to 30 min | × 0.984 | 98.73 / 98.50 % | 97.0 % | 95.83 % |
| 500k | 96.15 / 95.70 % | MTBF_hw ≥ 2.12 h or MTTR_hw ≤ 30 s | D-HARD + R-LINK-LOCAL + H-CONTROL-CONTINUITY + three levers | × 0.887 | 99.27 / 98.50 % | 100 % | 95.56 % |

This is the allocation the earlier requests asked for: a requirement, a plan, a hardware factor, and budget tables that mean something. It is one flag away in the current code.

### 3.3 What the goodput goal needs where it is feasible

Appendix A1 (Young's interval instead of the fixed 60 s) is the only place where the goodput goal is met: hardware factor 7.11 (ceiling) at 10k, 1.01 at 100k, 0.648 at 200k, 0.213 at 500k. Four observations that the pages do not make:

- The layer, unit, mechanism and MTTR tables (Tables 2–5) are not produced for these designs; the appendix has one row per scale.
- At 500k the mechanisms hardly matter. The hardware factor is 0.101 with no added move, 0.213 with the report's plan and 0.221 with all nine moves. The goal is decided by the hardware interruption rate and the cost of a checkpoint.
- The save time is the strongest lever and is not offered as one. Under Young at 500k, with the report's plan: k = 0.213 at a save of 1 s, 0.295 at 0.5 s, 0.355 at 0.3 s, 0.472 at 0.1 s; at 200k the same series is 0.648, 0.883, 1.054, 1.375.
- The plan that "meets the goal" at 500k delivers 77.93 % (derated) once undetected silent corruption is counted. The goal carries no condition on it.

## 4. The models

### 4.1 What is verified

The independent simulation draws hard interruptions, sub-health entries and silent corruptions on the running clock, walks the recovery chain per event (detection mixture, replay, elastic, process, global recovery with the manual fallback), keeps the checkpoint cycle, and books a window's effective and delivered work. It shares no code with the engine and takes only raw parameters and per-class rates.

| Design (native 950) | G_eff simulated (95 % interval) | G_eff engine, exact | G_del simulated | G_del engine |
|---|---|---|---|---|
| 10k nominal | 98.271 ± 0.002 | 98.269 | 98.02 ± 0.06 | 98.01 |
| 10k derated | 97.459 ± 0.003 | 97.459 | 96.97 ± 0.08 | 96.94 |
| 100k nominal | 97.449 ± 0.009 | 97.452 | 94.96 ± 0.22 | 94.95 |
| 100k derated | 96.552 ± 0.009 | 96.553 | 91.52 ± 0.30 | 91.73 |
| 500k nominal | 93.985 ± 0.027 | 93.963 | 83.43 ± 0.57 | 83.35 |
| 500k derated | 92.721 ± 0.028 | 92.703 | 74.35 ± 0.66 | 73.95 |
| A1 plan at 500k, nominal (k = 0.2127) | 98.930 ± 0.007 | 98.921 | 87.38 ± 0.43 | 87.37 |
| A1 plan at 500k, derated | 98.504 ± 0.008 | 98.500 | 77.93 ± 0.51 | 77.93 |

The simulation counts the compute in progress when the window ends, while the closed form is the long-run rate; this accounts for the offsets of +0.002 to +0.009 point in the G_eff column. With the engine's convention the nominal plan gives 98.925 ± 0.007 against 98.921, the derated plan 98.497 ± 0.008 against 98.500 and 10k nominal 98.2696 ± 0.0020 against 98.2690, and all sixteen comparisons lie inside the simulation's 95 % interval. For the A1 plan the simulation's own Young interval is 309.7 s nominal and 351.9 s derated (engine 309.4 and 352.0), and its share of windows at or above 98.5 % is 96.7 % for the nominal design (report 96.5 %).

Conclusion: the exact renewal form, the chain, the silent-corruption window, the Young variant, the transparent rungs, the levers and the hardware factor compute what the documents say they compute. Together with the reference engine's agreement recorded in MODEL_REFERENCE §20 (delivered goodput inside its interval at four scales), I found no error in the formulas.

### 4.2 The assumptions that decide the results, by size of effect

"Correct formulas" is not "correct answers". The following inputs and rules decide the numbers; none is a coding error.

| # | Assumption | Where | Effect |
|---|---|---|---|
| 1 | Hard-interruption basis 3,097 FIT per NPU (one interruption per 323,000 NPU-hours), all classes "assumed" | unit fault library, from the ReMAP / reference catalog | The library's own field records are all higher: Llama 3 1 per 50,700 GPU-h (× 6.4), RSC-1 6.50 per 1,000 node-days (× 10.9), RSC-2 2.34 (× 3.9), GPU clouds 1 per 90,000–99,000 GPU-h (× 3.3–3.6). Their 口径 is not the catalog's (GPU clusters of other vendors, node failures or job interruptions with a software share), so they bound the question, they do not answer it. With the rates × 3.2 / 6.5 / 11, today's derated G_eff at 100k falls from 96.55 to 94.57 / 91.73 / 88.10 % and at 500k from 92.70 to 84.09 / 73.55 / 62.46 %; A_op at 500k from 95.70 to 87.80 / 78.12 / 67.91 %. |
| 2 | Checkpoint: save 1 s every 60 s at every scale (C-FAST in the reference set, never removed) | mechanism set | 1.67 points nominal, 2.5 derated, at every scale; the goal is unreachable by construction (section 3.2). |
| 3 | Derating: times × 1.5, coverage −5 points, success −8 points, on every applied mechanism at once | `DERATE_DEFAULT` | The save time alone adds 0.83 point. Silent-corruption coverage 95 to 90 % doubles the undetected rate: delivered loss at 500k 10.6 points nominal, 18.8 derated. The acceptance value is the derated one. |
| 4 | Undetected silent corruption: every event spoils all later work until found after a fixed 120 h; 48 FIT per NPU; coverage 95 % | `sdc` block, reference semantics | Delivered goodput at 500k is 83.35 % nominal and 73.95 % derated against an effective 93.96 / 92.70 %. The loss is nearly proportional to (1 − coverage) × rate × 120 h; all three are assumed. |
| 5 | Recovery times do not grow with scale: detection 95 % in 10 s, automatic attempt 180 s at 99 %, manual 2 h | `recovery` mixture of the mechanism set | MTTR_hw 99 s at 10k and at 500k. The plan and survey §5 ask for scale laws; a restart of a 500k-NPU job in 180 s is at the best edge of the published range (survey Table 3-2: tens of seconds to about 25 minutes when automated). |
| 6 | Mechanism performance as targets: elastic recovery 98 % with a 1 s job pause, replay 90 % in 5 s | ReMAP policy parameters | R-ELASTIC is the largest single gain (+4.6 points at 500k). The hardware requirement rests on it. |
| 7 | "Job-level services" (UNKNOWN 410 + STORAGE 133 FIT per NPU), proportional to the NPU count, no fast recovery | catalog | 17.5 % of the interruptions and 47 % of the hard-interruption loss at 500k (80 of 169 s/h). It is allocated as a hardware unit although it is unattributed. |
| 8 | Exponential, independent arrivals in the training model and the window ledger | model | Survey §2 and §4 report Weibull shapes of 0.7–0.8 and correlated failures; bursts widen the spread between windows, so P(window) is optimistic. |
| 9 | Replacement capacity always available (0 hot spares, blocking 0) | records | About 65 units are out for repair at any time at 500k (0.587 × 1.55 per hour × 72 h); the report gives no spare-pool size. |
| 10 | Sub-health entry about 60–70 FIT per NPU, slowdown to 95 % | catalog | 0.04 expected slowed units at 500k and a 0.19-point loss; the survey cites 0.5 % straggling machines (MegaScale). |
| 11 | Effort scores (mechanisms 2–5, levers 2–3, hardware 2 per halving per class) | mechanism set, defaults | They choose the "recommended plan". They are judgments, not costs. |

### 4.3 Two properties of the acceptance rule that a reader should know

- **The per-window probability is the nominal design's; the mean criterion binds on the derated one.** For the A1 plan at 500k the nominal design passes 96.5 % of the windows ("supported"). The derated design, which is the acceptance yardstick of the tables, passes 56.8 % of the engine's windows and 55.7 % of this review's (mean 98.50 %, standard deviation 0.22 point). If the mechanisms perform at their derated values, the goal is met in about one window out of two.
- **One manual fallback costs 0.28 point of a window** (2 h of 720 h). The spread between windows at 500k is 0.55 point for today's design. The levers on the manual path matter more for the window criterion than for the mean.

## 5. Defects in the published output

| # | Defect | Evidence | Severity |
|---|---|---|---|
| D1 | Appendix A1 and A3 print "B ≤ 0: out of reach by hardware alone" at 500k under C-YOUNG. Formula (2′) is evaluated at today's interval; under Young the interval lengthens as the hardware improves. Hardware alone reaches the target at k = 0.101, above the floor of 0.05. | `effort.mjs`, row "none" at 500k | medium: a false statement next to a feasible plan |
| D2 | The same appendix rows give two hardware requirements: at 10k "MTBF ≥ 5.6 h" from (2′) and "ceiling × 7.11", which is 4.5 h. The Methodology calls the closed form a lower bound; the appendix note does not. | Appendix A1, row 10k | low |
| D3 | For scales without a feasible plan, Table 3 prints "allowed FIT" = today × 1.00 and Table 2 "MTBF per instance today → allowed" with equal values. An allowed value does not exist for a design that fails the goal. | Findings 950, Tables 2 and 3 | medium: the title promises budgets and the tables look like budgets |
| D4 | The appendix note does not say that P(window) is the nominal design's while the goodput beside it is the derated one (Table 1's note does). | Appendix A1–A3 notes | low |
| D5 | `SPEC.md` §3 and §7 still count 187 golden vectors and 358 + 29 tests; the header says v3.1. | `docs/markdown/SPEC.md` | low |
| D6 | `docs/` holds 40 report pages of four generations (per-card and per-unit FIT; A_op and G_eff basis; bare and reference designs) with different "today" values and opposite conclusions on 98.5 %, and no index of which are current. | `docs/*.html` | medium for a reader, none for the engine |

## 6. Recommendations

In order of value for the goal:

1. **Decide the target structure (question 1).** My recommendation is three targets on three quantities, each with its owner, instead of one number on a quantity that mixes them: A_op ≥ 98.5 % for the MTBF / MTTR allocation of hardware and recovery mechanisms (the original goal, Tables 1–5 as in section 3.2); the effective goodput with a checkpoint interval that follows the scale, and a floor if one is wanted, which becomes a requirement on the save time; the delivered goodput with a floor, which becomes a requirement on silent-corruption detection. The engine computes all three today.
2. **Stop fixing the checkpoint period in the main body.** Young's interval as the default policy and the fixed 60 s as the variant, or at least the save time as a lever of the allocation.
3. **Show the failure-rate basis beside field data.** One failure-rate override built from the library's field records (for example 1 per 50,000 GPU-hours spread over the classes in the catalog's proportions) and one extra table: the result under the catalog and under field rates. It tells the reader how much of the conclusion is the catalog.
4. **Produce Tables 2–5 for the feasible design** whenever the main design is infeasible, and print "—" instead of "allowed" values for an infeasible one (D3). Fix D1 and D2 by evaluating the requirement with the interval re-optimised, or by removing the two columns under C-YOUNG.
5. **State the window rule as it is** (nominal windows, derated mean), or add the derated design's window share to the tables.
6. **Give the recovery a scale law and report the spare pool** in the record-based reports, since both exist in the engine.
7. **Run the ingest pipeline on one real internal batch.** Everything above is sensitivity analysis until measured rates replace the catalog; this step is on your side of the boundary.
8. **Add an index of the report pages** that marks the current set and the superseded ones.

I have not changed any tracked file. The review and its scripts are the only additions.

## 7. Not reviewed

The geometry and unit counts of the topology records against public sources; the Excel importers and the model adapters beyond their tests; the web pages at 375 px and in dark mode (unchanged since the v5.11 checks); the Shapley studies (not re-run); the other three records in the independent simulation; the inference and spares modules beyond the spot checks.

## 8. Reproduce

From the repository root, on Node 24:

```sh
D=data-staging/tool-review-2026-11-09
node --import tsx $D/dump2.mjs $D && /usr/bin/python3 $D/des.py $D/des-inputs.json      # today's designs
node --import tsx $D/dump3.mjs $D && /usr/bin/python3 $D/des2.py $D/des-plan.json       # the A1 plan at 500k
node --import tsx $D/effort.mjs      # the plan against alternative move sets, Young variant
node --import tsx $D/whatif.mjs      # failure-rate basis and save time
node --import tsx $D/last.mjs        # C-FAST at 10k, A_op at field rates, the derated plan's windows
node --import tsx packages/cli/src/main.ts budget --record native950 --scale 500000 --metric aOp --json
```

## 9. Questions for the owner

1. **On which quantity should 98.5 % stand, and where does the number come from?** The running share A_op (the basis until 2026-10-28, on which the allocation exists), the effective goodput (today's basis, unreachable with the reference checkpoint), or the delivered goodput (ReMAP's headline "availability", today 74–97 %)? A three-target structure is recommendation 1.
2. **Is the save of 1 s every 60 s a constraint to keep in the main result,** or may the main result use an interval that follows the scale, with the save time as a lever?
3. **Should "today" stay on the reference catalog alone,** or be shown beside a field-level case built from the library's records?
4. **Which goals feel unmet to you?** My reading is the missing allocation (section 3.2) and the trust in the inputs (section 4.2). If it is something else, such as the architecture comparison, the internal-data path or the size of the tool, the next step changes.

## 10. Resolution (2026-11-09, v5.12)

The owner's answer: "go with your recommendations and fix the defects. For question 4, architectures have very little impact." Questions 1 to 3 are answered by the recommendations: three targets on three quantities (question 1), a checkpoint period that follows the scale in the goodput tier with the save time as its requirement (question 2), and a field-level case beside the catalog (question 3). Question 4 is section 11. Sections 1 to 9 are the review as written before any change; this section and the next were added afterwards.

### 10.1 What changed

| Item | Resolution | Where |
|---|---|---|
| R1 three targets | A_op ≥ 98.5 % carries the MTBF / MTTR allocation again (default metric; `--metric effective` keeps the v5.6 basis). The effective goodput is the checkpoint tier with a floor (default 97 %) and the delivered goodput the delivered tier with a floor (default 90 %); each tier prints whether the floor is met and the requirement that follows from it. The three are never added or merged. | `budget/tiers.ts`, `budget/index.ts`; Findings Tables 1–8, Methodology formulas 1–8; MODEL_REFERENCE §36 |
| R2 checkpoint period | The checkpoint tier quotes the recommended design at Young's period τ = √(2δ·M_rb) where its own period is fixed, with the as-designed value beside it; the save time δ* that meets the floor is the tier's requirement. The reference set keeps C-FAST: A_op does not depend on it. | Table 7 |
| R3 field data | `--field-rates` runs the same budget on a second failure-rate basis. The record `field-llama3-2026-11` scales the 18 interruption classes by 5.92 to the published Llama 3 total. It is a bound from another vendor's cluster, tagged `assumed`. | `budget/fieldCase.ts`, Table 9 |
| R4, D1, D2, D3 | Under an optimised period the requirement is taken from the engine's hardware-only root, with one MTBF end and no MTTR end (`required.interval = 'optimised'`); "out of reach by hardware alone" is printed only when that root does not exist. A scale without a feasible plan prints "—" in Tables 1 to 3 and in the overlay, with ‡ and the ceiling in the note. | `findings.mjs`, `variants.test.ts` |
| R5, D4 | Table 1 prints the window share of the nominal and of the derated design; the note says the rule accepts on the nominal one. | `recommended.windowDerated` |
| R6 | A mechanism set may give the automatic recovery a scale law; the public set has none, because no source states one for this hardware, and the Table 5 note now says that the recovery times are the same at every scale. The same note gives the node repair pipeline: at 500k the native 950 design keeps 52 nodes in repair on average, 69 at the 99 % quantile. | `recovery.automatic.scale`, `BudgetResult.spares` |
| R7 | Not done here: it needs internal data, which stays on the owner's side of the boundary. | `INGEST_RUNBOOK.md` §8 |
| R8, D6 | `docs/README.md` lists every report page as current, background or superseded, with the basis of each generation and what to read instead. | `docs/README.md` |
| D5 | Header, counts, KPI rows, interfaces and pointers of the specification brought to v5.12. | `SPEC.md` |

### 10.2 The result on the Ascend set

400 windows, seed 1, derated values unless marked; the four records in the order native 950 / UBL128 / CM384 / 800T A3.

| Scale | A_op today | Recommended moves | k (allowed FIT per NPU at 500k) | P nominal / derated | G_eff tier, floor 97 % | Save time allowed (nominal) | G_del tier, floor 90 % | Detection needed | G_del with the five detectors |
|---|---|---|---|---|---|---|---|---|---|
| 10k | 99.91 / 99.92 / 99.90 / 99.90 % | none | 14.3 / 14.4 / 11.4 / 11.6 | 92.5–96.8 % / 86.5–93.3 % | 97.7–97.8 %, met | 2.6–3.2 s | 97.2–97.3 %, met | none | 97.4–97.6 % |
| 100k | 99.11 / 99.15 / 98.98 / 99.01 % | none | 1.31 / 1.43 / 1.12 / 1.15 | 93–95 % / 88–92 % | 97.7–97.8 %, met | 2.8–3.0 s | 92.9 %, met | coverage ≥ 83.4–83.6 % or discovery ≤ 212–214 h | 96.8 % |
| 200k | 98.23 / 98.32 / 97.98 / 98.03 % | 950 and UBL128: manual recovery 2 h → 30 min; CM384 and 800T A3: C-LOSSLESS + D-HARD, automatic attempt 60 s, manual 30 min | 0.98 / 1.04 / 1.43 / 1.47 | 97–100 % / 53–57 % | 97.1 % met (950, UBL128); 96.7 % not met (CM384, 800T A3) | 1.2 s; 0.68 s | 87.6–88.1 %, not met | coverage ≥ 92.3–92.8 % or discovery ≤ 84–90 h | 95.0–95.5 %, met |
| 500k | 95.70 / 95.91 / 95.10 / 95.22 % | D-HARD + R-LINK-LOCAL + H-CONTROL-CONTINUITY, automatic attempt 60 s, success 99.9 %, manual 30 min | 0.887 / 0.897 / 0.772 / 0.779 (2,748 / 2,729 / 2,613 / 2,571) | 100 % / 52–56 % | 96.5 %, not met (ceiling 98.2 % as the save goes to 0) | 0.51–0.54 s | 76.6–76.8 %, not met | coverage ≥ 97.2 % or discovery ≤ 31–32 h | 92.6–92.7 %, met |

Reading: the availability target has an allocation at every scale. Up to 100k it is an acceptance ceiling (the hardware may be worse than the catalog by the factor k); at 200k it is held by recovery moves; at 500k the interruption FIT must also fall to 77–90 % of the catalog. On the field-level basis the plan at 500k is the same and so is the allowed FIT (2,571–2,748 per NPU), which is then 13–15 % of "today" (k 0.130–0.152); at 200k the field basis already needs the 500k plan with k 0.34–0.39, where the catalog needs one lever.

### 10.3 What the numbers still rest on

- **Every input is still an assumption.** Section 4.2 stands unchanged. The field-level case shows the size of the dependence; it does not remove it. Recommendation 7 is the step that does.
- **The two floors are defaults I chose,** 97 % and 90 %, so that the tiers print a requirement. No source gives them. They are options (`--effective-floor`, `--delivered-floor`, the project's targets) and should be set by the owner.
- **Where k sits on the mean limit (200k and 500k), the derated design passes about one window in two.** The rule accepts on the nominal design (P 97–100 %). If the mechanisms perform only at their derated values, the target holds on average and fails in half of the 30-day windows. Table 1 now prints both shares.
- **At 10k one verdict is unresolved:** the recommended ceiling of the native 950 passes 92.5 % of fresh windows, and the Wilson interval contains 90 %.
- **The delivered tier's 120 h discovery delay and 48 FIT per NPU of silent corruption** decide Table 8 as they decided the delivered goodput before (assumption 4 of section 4.2).

### 10.4 Checks

1,088 tests pass (core 933, importers 56, agent 37, reports 46, CLI 16), among them 598 golden vectors computed in Python; the v5 goldens gained group G8 (Young's twin and the save-time root, 97 cases, findings 0). `node packages/reports/test/reproduce.mjs` prints six OK in the local zone and under `TZ=UTC`. The report pages, the web pages and both manuals were rendered at 1280 px and 375 px in light and dark. Nothing was committed: the owner's standing rule is to commit on request.

## 11. The architecture comparison (question 4)

The observation is correct, and it is a property of the inputs and of what a synchronous job is, not of the formulas.

### 11.1 What the tool shows

At 500,000 NPUs today, derated: A_op 95.70 % (native 950), 95.91 % (UBL128), 95.10 % (CM384), 95.22 % (800T A3). The spread is 0.81 point, against 4.2 points between 10k and 500k for one architecture. The hardware factor at 500k is 0.887 / 0.897 / 0.772 / 0.779, and the recommended moves are the same for all four.

### 11.2 Why

Today's unavailability at 500k, nominal, in points of the job hour by layer:

| Layer | Native 950 | UBL128 | CM384 | 800T A3 | Same in every record? |
|---|---|---|---|---|---|
| Cluster: job-level services (storage, unattributed) | 1.92 | 1.92 | 1.91 | 1.91 | yes, per NPU |
| Node (tray, memory, disk, management, CPU) | 0.67 | 0.67 | 0.67 | 0.67 | yes, 8 NPUs per node everywhere |
| NPU | 0.33 | 0.33 | 0.33 | 0.33 | yes |
| Cabinet (power, cooling) | 0.47 | 0.47 | 0.94 | 0.94 | no: 64 against 32 NPUs per cabinet |
| Supernode fabric (UB switches and links) | 0.24 | 0.02 | 0.27 | 0.18 | no |
| Scale-out network | 0.02 | 0.02 | 0.07 | 0.07 | no |
| Other event classes (isolation, detected silent corruption, false alarms) | 0.21 | 0.20 | 0.23 | 0.22 | nearly |
| Total | 3.85 | 3.64 | 4.41 | 4.31 | |

Four causes, in order of size:

1. **Three quarters of the loss sits in layers that are identical per NPU.** The NPU, the node and the job-level services carry 87–94 % of the interruption rate (2,850 or 2,933 of 3,043–3,384 FIT per NPU) and 2.91–2.92 of 3.64–4.41 points of unavailability. No topology changes them in this model.
2. **The largest difference between the 950 and the 910C records is one assumption about the cabinet.** The catalog gives power and cooling 267 FIT per card. HAC-D converts it to 8,533 FIT per cabinet under the CloudMatrix384 geometry (32 NPUs per cabinet) and applies that value to every cabinet, so a 64-NPU cabinet of the 950 carries half the rate per NPU. This is 0.47 of the 0.56 point between native 950 and CM384. With the 950 cabinet at the per-card rate instead, its A_op at 500k is 95.25 % and its k 0.80, within 0.15 point and 0.03 of CM384. No source says which reading holds for a liquid-cooled 64-NPU cabinet.
3. **The fabric carries 4 % of the interruptions in the catalog.** Optical links and switch chips have 66.7 FIT per card each, described there as the residual after protection. Per unit this is 4.76 FIT per optical link, one job interruption per 24,000 link-years, and 57 FIT per switch chip. Mesh links, transceivers and ports carry no interruption rate at all. So 14 optical UB links per NPU (CM384), 2 (native 950) or none (800T A3) differ by 67 FIT in 3,300. For comparison, in other 口径: network switch and cable faults are 8.4 % of the Llama 3 interruptions and InfiniBand link flaps 12.4 % on SIGMA's platform B, both about twice to three times the catalog's share; the TPUv4 cable failure rate of 0.005 % per day is 2,083 component failures per 10⁹ cable-hours, 440 times the catalog's interrupting rate per link, which means the catalog assumes that 99.8 % of link faults never reach the job.
4. **A synchronous job has no blast radius.** Any hard interruption stops the whole job, so the size of the failure domain does not enter A_op. Elastic recovery uses a fixed 1/50 of the job as its domain; setting it to the topology's own domain count (489 supernodes to 62,500 servers at 500k) moves the effective goodput by 0.06–0.07 point and the difference between architectures by 0.01. Redundancy is not credited in the training model (decision of 2026-10-29), the recovery chain and the mechanisms are the same for every record, and the effect of the UB domain size on training throughput is outside the model.

### 11.3 The model does separate the architectures when the fabric carries weight

A what-if on the existing override path, no model change (`data-staging/tool-review-2026-11-09/arch/`): the catalog with the fabric classes multiplied, today's design at 500k, A_op derated.

| Failure-rate basis | Native 950 | UBL128 | CM384 | 800T A3 | Spread |
|---|---|---|---|---|---|
| Catalog | 95.70 % | 95.91 % | 95.10 % | 95.22 % | 0.81 pt |
| Links and switch chips × 5 | 94.66 % | 95.68 % | 93.72 % | 94.27 % | 1.96 pt |
| Links and switch chips × 20 | 90.97 % | 94.84 % | 88.87 % | 90.86 % | 5.97 pt |
| Links × 20 (95 FIT per link) | 94.94 % | 94.99 % | 93.46 % | 94.61 % | 1.53 pt |
| Links × 100 (476 FIT per link) | 91.86 % | 91.32 % | 87.14 % | 92.15 % | 5.02 pt |
| 950 cabinets at the per-card rate | 95.25 % | 95.46 % | 95.10 % | 95.22 % | 0.36 pt |

The order changes with the assumption: with heavier links the server cluster without UB optics is best and CM384 worst; with heavier switch chips UBL128 is best. The comparison is therefore decided by three inputs that are all assumed and that no page names as deciding: the interruption rate of a cabinet as a function of its NPU count, the share of link faults the fabric absorbs, and the same share for switch chips.

### 11.4 Options

| Option | What it is | Changes the model? |
|---|---|---|
| A. The three deciding inputs per architecture | A failure-rate worksheet per record with only these rows: cabinet power and cooling per cabinet type, UB link per link type (electrical mesh, optical with and without path switchover), switch chip per chip type. Internal data through the existing `hacd ingest` path, or stated assumptions with a source. | no |
| B. A sensitivity table in the report | The table of 11.3 as a section of the BOM or Findings pages, so that a reader sees what the comparison rests on. | no, a report addition |
| C. Protection credited explicitly | Raw device rate × the share that reaches the job, with the protection (retry, lane degrade, reroute, path switchover) as a parameter per architecture. In the ingest normaliser this is the 口径 mapping and exists; inside the training model it reverses the decision of 2026-10-29. | yes |
| D. A quantity on which topology matters by construction | Capacity availability and blast radius (NPUs out per fault × repair time, spare pool per domain), or training throughput as a function of the UB domain size. The first exists in the engine for the structure view; the second has no evidence base in the survey. | yes, new scope |

My recommendation is A and B: they say whether the difference is real before any model is built around it. Nothing in the model was changed for this section.
