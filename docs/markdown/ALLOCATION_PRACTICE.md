# Availability allocation with fault-management mechanisms: practice notes (2026-10-11)

How to decide, in the allocation phase, which fault-management methods a cluster needs in addition to hardware failure-rate budgets, and how HAC-D supports each step. Decisions taken with the user on 2026-10-11: mechanism cost enters as editable relative effort scores; the target is a mean plus a per-month probability; assumed mechanism parameters are derated by confidence.

## 1. Allocate the ledger, not only the failure rate

Classical reliability allocation apportions a system failure-rate (or unavailability) budget to subsystems: equal, ARINC (proportional to current rates), AGREE (complexity × importance × duty), feasibility of objectives, minimum effort (Albert) and cost-optimal (Lagrangian) methods, all implemented in `packages/core/src/allocation`. For an AI training job the target is a share of a time window (delivered goodput, 正确有效产出, or operational availability A_op), and every line of its loss ledger has an owning lever:

| Ledger line | Lever | Parameters | HAC-D |
|---|---|---|---|
| downtime | detection, recovery ladder, manual fallback | p_d, t_auto, timeout; replay / elastic / process success and times; T_manual | Scenario → Recovery, Mechanism chain |
| rollback after interruptions | checkpoint interval, step recovery, no-rollback rungs | τ, W, replay / elastic shares | Workload, Mechanism chain |
| checkpoint saves | checkpoint cost | δ | Workload |
| sub-health slow-down | sub-health detection, isolation policy | p_det, delay, policy | Component details |
| silent-corruption rollback and terminal discard | immediate detection, fallback delay, retention | q, t_d, D | Silent corruption policy |
| spares exhausted | hot-spare pool | k, replenishment | Workload, Spares |
| interruption frequency | hardware rates, screening, prediction | λ_i, infant mortality | Components, Allocation |

A λ-only allocation solves the wrong problem whenever a non-hardware line dominates: on the reference three-class baseline at 50,000 cards the delivered goodput is 76.7 % and cannot exceed 77.9 % even with zero hardware failures, because undetected silent corruption alone costs 20 points.

## 2. Procedure

1. **Fix the metric and 口径** (design-review item 1): delivered goodput over the job window, or A_op; mean and/or per-window probability; the window length.
2. **Current ledger and no-fault bounds.** Evaluate the scenario; for each lever family compute the value reachable when the others are perfect (HAC-D: Allocation page on the delivered basis reports "reachable by hardware alone"). Levers without which the target is unreachable are *necessary*.
3. **Rank the optional levers by marginal gain per effort.** Shapley values are the fair ranking under interactions; single gains show what a lever does alone; last-added gains what it still adds once everything else is in place. Replay, elasticity and process rescheduling are substitutes (diminishing returns); detection and step recovery are complements.
4. **Choose the cheapest sufficient set** of mechanisms (effort scores) that meets the target with margin, then apportion the remaining interruption budget to component classes (ARINC when current proportions are trusted, AGREE with complexity and importance weights, cost-optimal with cost curves) and to recovery stages.
5. **Derate assumed parameters.** Mechanism parameters that are targets or priors (the reference catalog tags most of them so) are worsened in a second evaluation (coverage − 5 points, success − 8 points, times × 1.5); the plan must hold in both. Allocate for the largest N that will run: detection and recovery terms grow ∝ N, the checkpoint term ∝ √N at the Young interval, silent-corruption episodes ∝ N.
6. **Verify on the distribution.** A plan that meets the target on average can still miss it in a sizeable share of months (the reference's 500k-card scan: 94.0 % mean, 98 % of months ≥ 90 % at 99.9 % coverage, but 85 % of months at 99 %). Use the window-ledger simulation's P(window ≥ target) with a stated confidence (default 90 %).
7. **Close the loop** with measured stage times, detection coverage and incident logs (design-review items 2 and 8), and re-allocate.

## 3. What other fields do

| Field | Practice | AI-cluster analogue |
|---|---|---|
| Aerospace / defense (MIL-HDBK-338, ARINC, AGREE, feasibility of objectives) | top-down apportionment of λ or R, bottom-up prediction, iterate; weights for complexity, importance, state of the art, environment | component-class budgets on the Allocation page |
| Automotive functional safety (ISO 26262) | diagnostic-coverage targets and a fault-tolerant time interval per safety goal; ASIL decomposition onto independent channels; single-point and latent-fault metrics | detection coverage and detection-time budgets (D-HARD, D-SLOW, D-SDC); latent corruption = the undetected SDC state; redundancy groups with switchover |
| Telecom (Bellcore / TL 9000, ITU-T E.800) | annual downtime budget split by cause: hardware, software, procedural, planned; manual recovery as its own line | ledger lines per fault class and per recovery path (automatic vs manual share) |
| Nuclear / process safety (PRA) | risk-informed ranking with importance measures (Fussell-Vesely, RAW, RRW); defence in depth, no single lever carries the budget | Report page importance measures; necessary-mechanism screening, substitutes vs complements |
| Cloud SRE | SLO with an error budget consumed by incidents and change; MTTD / MTTR objectives; burn-rate alerts | window ledger as the error budget; detection and recovery budgets per stage |
| HPC resilience (Young, Daly, exascale resilience studies) | checkpoint overhead budget vs replication and ABFT; interval optimisation | Young / Daly interval, C-FAST, step recovery; integrity checks priced at 1–2.6 % of throughput (OSDI'26 data point in the survey) |

## 4. Worked example: 90 % delivered goodput at 50,000 cards (reference three-class baseline)

- Necessary lever: immediate silent-corruption detection ≥ 71.5 % (hardware as is, fallback 120 h), or a fallback delay ≤ 32 h at 0 % detection.
- Cheapest sufficient set with the library targets: D-SDC at 95 % (effort 5) gives 95.4 % nominal; derated (coverage 90 %, times × 1.5) it still exceeds 90 %.
- With that set the interruption budget has slack: component rates may rise ×4 (per-unit MTBF HBM 432 k h, accelerator 247 k h, network 885 k h, other 168 k h under ARINC) or the recovery may grow to 24 min. Replay (effort 2) is the next lever if more margin is wanted.
- Verification: the ledger simulation gives the per-month probability; at 500,000 cards the same library set reaches only 83 % and the scan shows that coverage ≥ 99 % with a 120 s recovery is needed (the reference's finding).

## 5. HAC-D implementation

`planToTarget(scenario, {target, players, effort, derate, scan, verify})` in `packages/core/src/mechanisms/plan.ts` evaluates all coalitions of the candidate mechanisms (closed forms, nominal and derated), returns the cheapest feasible coalition, the necessary mechanisms, the effort–value Pareto front, a coverage × recovery scan and the optional ledger verification. UI: Mechanisms page → "Plan to target"; CLI `hacd plan`; MCP `plan_mechanisms`. The allocation of the remaining interruption budget stays on the Allocation page (delivered basis).

## Addendum 2026-10-13 (v3.6)

When even 100 % immediate silent-corruption detection cannot reach the delivered target, `allocateScenario` now computes the class and stage budgets at q = 1 (the best the detection lever can do) and says so in the notes, instead of at the current coverage, where the implied effective target saturated and the budgets were meaningless. The worked examples of the user manual §7.5–§7.7 (54-event catalog at 90 % and 95 %, three-class baseline at 50,000 cards) show the three readings: detection is the requirement; detection plus a hardware or recovery improvement; slack after a mechanism is applied. The loss budget over the ledger lines (§7.1 of the model reference) complements the interruption budget: it says which line to attack first.

## Addendum 2026-10-15 (v3.7)

The procedure of §2 is now one function: `allocationStudy` (Audit & study page, `hacd study`, MCP `allocation_study`) runs steps 2–7 for every cluster size — hardware-only and recovery-only budgets, the cheapest feasible mechanism set with derating, Shapley ranking, the residual loss by domain group (the weak links after the plan), the recovery levers beyond the library, the per-window verification and the largest size each mechanism set supports — and writes the report with its three charts. The single-point audit (`auditMechanisms`, `hacd audit`, `audit_mechanisms`) is the 口径 of the mechanism audit of 2026-10-14: one applicable, successfully handled event per mechanism against the scenario's own baseline, with the overlap rules and the integration fields that must be measured before a mechanism enters the cluster-level models.
