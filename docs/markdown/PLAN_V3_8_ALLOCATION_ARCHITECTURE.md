# HAC-D v3.8 — allocation components: architecture-aware weights, hierarchical allocation, joint hardware / mechanism / architecture optimisation

Status: proposal 2026-10-16 (nothing implemented yet). Inputs: `docs/ALLOCATION_METHODS_SUMMARY.zh.html` (pages 1–3), the three AGREE reports (`docs/*_AGREE.zh.html`), `docs/HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html`, the architecture report `docs/ARCHITECTURE.zh.html` (§1 capability ① and §9 roadmap), the companion chapter *AI 集群可靠性建模* §2 / §4 / §6 / §7 and the HAC-D code as of v3.7 (`packages/core/src/allocation`, `study`, `mechanisms/plan.ts`, `scenario/build.ts`, `scenario/analysis.ts`). Decisions the user must take are marked **[Q1–Q5]** in §8.

---

## 0. Why a new phase for allocation

The 98.5 % studies of 2026-10-15/16 showed what the current allocation components do well and where they stop:

| Finding (evidence) | Consequence for the next phase |
|---|---|
| AGREE on the per-card reference catalog degenerates to equal apportionment (every class has n_i = N), and counting physical units instead gives factors the hardware cannot deliver (POWER ×188, STORAGE ×8400 at 100k) — `docs/REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html` §1, §4. | The AGREE weights (complexity n_i, importance E_i, duty t_i) must be *derived from the cluster architecture and the recovery chain*, not typed per class. |
| After any mechanism set the residual hardware task sits in the classes without a recovery rung (UNKNOWN ×2.4, POWER ×1.3, STORAGE ×1.05 at 500k with the latest ReMAP set; MGMT, COOL close behind) — AGREE reports §4–§5. | Their levers are architectural (2N power, control-plane continuity, storage multipath, root-cause attribution), so architecture options must become allocation levers next to hardware FIT and mechanism parameters. |
| Hardware and recovery are interchangeable to first order (f · g ≈ constant on the iso-target curves) and the mechanism set removes 95 % of the 500k reduction — `docs/HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html` §3. | Selection should be one joint problem over mechanisms, parameters, hardware factors and architecture options, with the chance constraint P(window ≥ target) ≥ 90 % inside it, instead of three sequential steps. |
| The greedy planner never reaches prerequisite pairs (D-SDC + R-SDC) and picked R-REPLAY + R-PROCESS at 100k where the exact optimum is R-ELASTIC alone — AGREE reports §2 ④. | Exact search beyond 10 candidates (branch and bound with the greedy value as bound) and group-wise evaluation of prerequisite sets. |
| Allowed FIT values above the current value confused readers: they are acceptance ceilings (slack), not tasks — `HARDWARE_MECHANISM_ALLOCATION_98P5` §1. | The deliverable of an allocation is an *acceptance table* per class and per level (FIT limit, pause limit, detection limit, spare count) with an explicit reading (ceiling / task), exported for vendors and operations. |
| Budgets change with N (detection and recovery terms ∝ N, checkpoint ∝ √N) and with the life phase (infant mortality, lemon nodes) while the allocation is static — summary page 2 ⑦. | Allocation for the largest N that will run and per phase, with the incident-log loop (`hacd rate`) closing it. |

---

## 1. Requests and how they map

| # | Request (from the user's questions of 2026-10-16) | Feature | Section |
|---|---|---|---|
| R1 | What to do for the allocation components | WP1–WP7 below; the Allocation page, `allocateScenario`, `allocationStudy`, `planToTarget`, CLI `hacd allocate / plan / study`, MCP `allocate_scenario / plan_mechanisms / allocation_study` all gain the same options | §3–§5 |
| R2 | How cluster architecture (cluster, network, pod, …) changes the numbers of hardware units and mechanisms, hence the allocation | Architecture-derived counts, exposure, importance and duty (WP1); architecture options as allocation levers with their residual rates from the RBD / CTMC layer (WP3); hierarchical cluster → pod / supernode → node → class budgets (WP2) | §2, §3.1–3.3 |
| R3 | Values, not only directions | Every WP ends in a table the user can read on the existing 98.5 % catalog (10k–500k) and on the topology examples (`nvl72Design`, `cloudMatrix384Training`, `atlas950Training`, `ascendSupercluster`) | §6 acceptance |

---

## 2. How the architecture enters the allocation (model statement)

The allocation sees the architecture through four quantities per component class i, all of which HAC-D can already compute or hold (`scenario/build.ts`, `scenario/schema.ts`):

1. **Counts n_i** — `countRule.per` ∈ {gpu, node, rack, zone, fixed, supernode, comm_rack, l1_switch, l2_switch, subplane, optical_link, transceiver} × `factor`, resolved by `computeCounts` from `topology` (gpusPerNode, nodesPerRack, racksPerZone, nvlinkDomainGpus, networkPlanes, superpod geometry). Examples: CloudMatrix384 = 48 nodes × 8 NPU, 7 UB sub-planes × 16 L2 chips, 5,376 optical links and 10,752 transceivers per supernode; NVL72 design = 4 GPUs per compute node × 18 nodes per rack, 8 network planes, 2N power feeds, CDU 5-of-6.
2. **Fan-out (blast radius)** — `component.blastRadius` (domain) and the scope of the count rule decide how many cards one event stops: a card event stops the job in synchronous training but costs one card of spares; a rack / NVLink-domain / supernode / pod event costs the whole domain (TPUv4: an OCS fails 0.04 % per day but its blast radius is the pod; Minder: one switch reboot took 32 of 600 hosts offline; Meta Sparing: 72 / 36 / 18-GPU blocks need 8.6 / 4.7 / 2.6 % inter-block spares with 3.9 / 7.8 / 9.9 % stranding). Common cause enters through `ccf { domain, beta }` (`ccfLeaves`).
3. **Importance E_i** — the share of class-i events that still reach the global recovery after the chain, `ChainOutcome.pGlobal` from `chainOutcome(detectS, globalS, params, applicable)`, with the per-class applicability flags (`component.mechanisms.{replay, process, elastic, predict, netfail, hotswap, custom}`) that the architecture makes possible (multi-NIC / multi-plane for netfail, spare pools for hotswap, DP domains for elastic).
4. **Duty t_i** — the fraction of the window in which the class is exposed with its full effect: network classes during communication phases (`commShare`, `planeLossPerformance`), storage during save / load windows (δ, load stage), power and cooling always.

Design choices change these quantities and nothing else in the allocation: multi-plane networks turn a plane loss into a capacity coefficient c = (P − 1)/P (survey §4, MRC 12 % at 8 planes) instead of an interruption, which moves budget from the downtime line to the slowdown line; 2N power and N+1 cooling turn the raw rate into a residual rate λ² · MTTR (parallel) or the k-of-n equivalent, which is what the reference catalog's POWER / COOL classes already contain (保护后残余); a larger scale-up domain (8 → 72 → 384 → 8,192 cards) raises the fan-out of fabric, tray and power events, the spare granularity and the elastic-domain count; a pod / zone structure sets the scope of shared storage and control-plane classes and of the spare pool (`replicaScope`, `ascendSupercluster`); the checkpoint tier sets δ and the load stage, hence the √N term of the budget.

---

## 3. Model enhancements (packages/core)

### 3.1 WP1 — architecture-derived AGREE weights (`allocation/weights.ts`)

```ts
export interface ClassWeights { id: string; count: number; fanoutCards: number; exposure: number; importance: number; duty: number; basis: 'topology' | 'manual' }
export function weightsFromTopology(s: Scenario, opts?: { mechanisms?: 'current' | 'none'; duty?: 'phase' | 'full' }): ClassWeights[]
```

- `count` = `componentInstances(c, counts).total`; `fanoutCards` = cards per instance of the class's domain (`blastRadius` → domain cards from `topology`: gpu 1, node gpusPerNode, rack gpusPerNode·nodesPerRack, nvlink_domain / supernode nvlinkDomainGpus, zone, cluster N; default = the count-rule scope); `exposure` = count × fanoutCards × duty (card-hours at risk per window, normalised to Σ = 1).
- `importance` = `pGlobal` of the class under the scenario's current mechanisms (`opts.mechanisms = 'current'`) or 1 (`'none'`); for classes with `redundancy` the group's switchover failure probability multiplies in.
- `duty`: `'full'` = 1; `'phase'` = communication share for network classes (`scenario.workload.commShare` or the plane-loss model's `commShare`), save-window share δ/(τ + δ) plus load share for storage classes, 1 otherwise.
- `allocateScenario(s, { method: 'agree', weights: 'count' | 'exposure' | 'topology' | 'manual' })`: `count` is today's behaviour (equal on the per-card catalog), `exposure` uses exposure as n_i with E = 1, `topology` uses exposure, importance and duty together, `manual` reads `component.allocation.{importance, duty}` as before. The Allocation page shows the three derived weights per class next to the manual fields and marks which basis is active.
- Output: the AGREE row gains `weight`, `fanoutCards`, `importance`, `duty` and a per-class *reading* (`ceiling` when λ* ≥ current, `task` otherwise).

### 3.2 WP2 — hierarchical allocation (`allocation/hierarchy.ts`)

```ts
export function allocateHierarchical(s: Scenario, target: { availability?: number; goodput?: number }, opts: { levels?: ScopeLevel[]; method: AllocationMethod; weights: 'exposure' | 'topology' }): HierarchicalAllocation
```

- Levels from `scopeOfCountRule`: gpu → node → rack → supernode → zone → cluster (`SCOPE_RANK`). Step 1 splits the budget across levels by the summed exposure of the level's classes (a level with no classes gets nothing); step 2 splits inside each level with the chosen method; step 3 reallocates slack between levels with the water-filling rule of the AGREE study (no class may get worse); step 4 re-evaluates with the engine (closure check, must return the target).
- Output per level: allowed aggregate rate, MTBF of the level (1 / Σλ), allowed FIT per class, spare requirement at that level (binomial P99 from `sparing`), and the acceptance table. A pod / supernode level is the natural unit for vendor acceptance (one supernode's allowed interruption rate) and for the inference N+k pool.
- Conservation test: Σ levels Σ classes pt_i + fixed = 1 − A* to 1e-9; the equal-weights case must reproduce the flat AGREE result.

### 3.3 WP3 — architecture options as allocation levers (`study/architecture.ts`)

```ts
export type ArchitectureLever =
  | { kind: 'planes'; values: number[] }                                   // topology.networkPlanes with planeLossPerformance(P, commShare)
  | { kind: 'tor'; values: ('single' | 'dual')[] }                          // ToR class redundancy parallel vs series
  | { kind: 'power'; values: ('N+1' | '2N' | 'catcher')[] }                // residual rate of the power class from the RBD group
  | { kind: 'cooling'; values: { modules: number; required: number }[] }
  | { kind: 'domain'; values: number[] }                                   // nvlinkDomainGpus / superpod preset: fan-out, elastic domains, spare granularity
  | { kind: 'hotSpares'; values: number[] }                                // workload.hotSpareNodes → P_blocked, hotswap eligibility
  | { kind: 'checkpointTier'; values: ('shared' | 'local' | 'memory')[] }  // δ, load stage (C-MEM / C-ASYNC parameters)
export function architectureStudy(s: Scenario, levers: ArchitectureLever[], opts: StudyOptions): ArchitectureStudyResult
```

- Each option is applied to the scenario (topology / redundancy / workload fields only), evaluated with the same evaluator, and reported as: the shift between ledger lines (downtime ↔ slowdown ↔ blocked), the change of each class's exposure and importance, the hardware factor f and recovery factor g_eff at which the target holds (the iso-target point of `scripts/hardware-mechanism-split-98p5.ts`), the spare count and the fault-free overhead. The result is an *architecture allocation*: how much of the budget each option buys, in the same pt as hardware and mechanisms.
- Residual rates come from the existing RBD / CTMC layer (`rbd.evaluate`, `kOfNGroup`, `switchover`, `ccfLeaves`) — no new physics; the common-cause β stays an explicit, sweepable assumption (survey §4: no published β).
- `allocationStudy` gains `levers: { recovery: boolean; architecture: ArchitectureLever[] }` and the study report a fourth chart (budget-line shift per option).

### 3.4 WP4 — constraints: floors, costs, common-cause budget

- `component.allocation.minLambda` (per unit, with provenance) replaces the default `minLambdaFactor = 0.05`; the library (`packages/core/data/library.json`) gets a `bestKnown` record per class family so that `Subsystem.minLambda` is filled from evidence; rows below the floor are flagged `tighter-than-best-known` (already in `AllocationRow.feasibility`) and the allocation page offers the alternative path (mechanism or architecture lever) automatically.
- Cost curves `costA`, `costB` with provenance and a currency flag (effort scores remain the default objective; currency is optional **[Q3]**).
- CCF budget: for every `ccf.domain` the allocation returns the largest β at which the domain's common-cause contribution stays within its share (`ccfLeaves` with a bisection on β), reported as an acceptance limit next to the FIT limits.

### 3.5 WP5 — joint optimisation and chance constraints (`mechanisms/plan.ts`, `study/index.ts`)

- `planToTarget(s, { mode: 'joint', candidates, parameters, hardware: { floors }, architecture: levers, objective: 'effort' | 'cost', chance: { p: 0.9, trials } })`.
- Decision variables: mechanism set (binary, prerequisite groups evaluated as a unit), continuous parameters inside their derating range, per-class hardware factors ≥ floors, one value per architecture lever. Integer part by branch and bound ordered by the greedy score with the all-on value as bound (exact up to 23 candidates on the catalog in minutes because the value function is the training block only); continuous part by coordinate descent on the primary parameter of each selected mechanism (the `PRIMARY` map of `scripts/agree-allocation-98p5.ts`); hardware factors by the AGREE reallocation; chance constraint checked with the ledger quantiles (`verify`: P(window ≥ target) with its Wilson interval must be ≥ p with verdict `supported`).
- Output: the Pareto front (effort or cost × nominal margin × derated margin × P(window)), the chosen point, the necessary mechanisms, and the per-class acceptance table.

### 3.6 WP6 — uncertainty-aware derating and rates

- `DerateSpec` graded by provenance confidence: measured −2 pt / −3 pt / ×1.2, paper-reported and vendor −5 / −8 / ×1.5 (today's default), derived −7 / −10 / ×1.7, assumed −10 / −15 / ×2 (values to be confirmed **[Q4]**); `derateParameters` reads the confidence of each parameter from the library record or the audit entry.
- Rates: an option to allocate with the upper Garwood bound of the incident-based rate (`fit/incidents.ts`) instead of the point estimate; the study reports the budget sensitivity to each parameter (tornado over the allocation).

### 3.7 WP7 — several 口径 at once, inference side

- `allocationStudy({ metrics: ['aOp', 'delivered', 'effective'] })` with an intersection view (the feasible region common to the 口径), the hard constraints per 口径 (q*, D*, τ bound from `checkpointBounds`), lexicographic or weighted targets.
- Inference: capacity availability A_cap of the N+k replica pool with the replica scope (`replicaComposition`) as the level of the hierarchical allocation; request-level SLO stays out of scope (architecture report X7).

---

## 4. Algorithms (pseudo-code)

```
weightsFromTopology(s):
  counts ← computeCounts(s)
  for each enabled class c with λ > 0:
    n ← componentInstances(c, counts).total
    fan ← cardsPerInstance(domainOf(c))              # 1, gpusPerNode, rack cards, nvlinkDomainGpus, zone cards, N
    duty ← phaseShare(c)                              # 1 unless opts.duty = 'phase'
    E ← chainOutcome(detectS, globalS, params, applicable(c)).pGlobal   # 1 when no mechanism applies
    exposure ← n · fan · duty
  normalise exposure to Σ = 1; return rows

allocateHierarchical(s, A*, weights):
  U_free ← (1 − A*) − Σ non-domain pauses
  for level L in gpu … cluster: U_L ← U_free · Σ_{i∈L} exposure_i
  for each level: pt_i* ← U_L · w_i / Σ_{j∈L} w_j  (w = exposure / importance / duty per the method)
  water-fill across all classes (no class gets worse) → k′_i; closure check with the engine
  per level: λ_L* = Σ λ_i*, MTBF_L = 1/λ_L*, spares_L = binomial P99(λ_L*, turnaround)

jointPlan(s, candidates, levers, target, p):
  bound ← value(all candidates on, best architecture, hardware at floors)
  if bound < target: return infeasible with the gap and the levers' iso-target point
  branch and bound over the candidate set in greedy order (prerequisite groups as single nodes):
    for a node: parameters ← coordinate descent on PRIMARY keys inside the derating range
                hardware ← AGREE reallocation on the residual (floors respected)
                accept if nominal ≥ target and derated ≥ target and P(window) ≥ p (ledger, Wilson 'supported')
    prune when effort ≥ best or bound(node) < target
  return Pareto front and the acceptance tables
```

---

## 5. Interfaces

- **Allocation page**: weight basis selector (count / exposure / topology / manual) with the derived columns per class; AGREE reallocation switch (strict vs no-class-worse); hierarchical view (level cards with allowed rate, MTBF, FIT per class, spares); architecture levers panel reusing the Compare page's option editor; acceptance-table export (CSV / JSON) with the ceiling / task reading per row.
- **Study / Audit page**: AGREE two-phase selection and joint mode next to exact / greedy; the fourth chart (budget-line shift per architecture option).
- **CLI**: `hacd allocate <s.json> --availability 0.985 --method agree --weights topology [--levels]`, `hacd study <s.json> --select agree|greedy|exact|joint --levers recovery,architecture`, `hacd acceptance <s.json> --format csv|json`, `hacd plan <s.json> --joint --chance 0.9`.
- **MCP**: options on `allocate_scenario`, `allocation_study`, `plan_mechanisms`; new `acceptance_table`.
- **Reports**: `report/agreeReport.ts` generalises `scripts/build-agree-allocation-98p5.mjs` (per-class factor heatmap, A_op(N), closure heatmap, acceptance table) so the Audit page and `hacd study` emit the same HTML; the ReMAP audit request (`scripts/remap-bridge.ts --export`) carries the acceptance table.
- **Skills**: `allocate-to-target` updated with the weight basis, hierarchy and joint mode; `scenario-review` item "architecture levers evaluated".

---

## 6. Validation and acceptance

| WP | Independent check | Acceptance on the 98.5 % catalog and the topology examples |
|---|---|---|
| WP1 | Python golden for `weightsFromTopology` on `nvl72Design` and `cloudMatrix384Training` (counts × fan-out × duty; pGlobal from the chain enumeration in `compute_golden_v3.py`) | On the per-card catalog `count` reproduces the AGREE reports; `exposure` on `nvl72Design` ranks NVSwitch tray (fan-out 72) and power feeds above GPU-level classes; importance of elastic-eligible classes equals 1 − a·s to 1e-9 |
| WP2 | Conservation Σ pt + fixed = 1 − A* (1e-9); equal weights = flat AGREE; closure check returns A* ± 0.03 pt | Per-level acceptance tables for 100k / 200k / 500k; supernode-level allowed rate on `ascendSupercluster` consistent with its N+k capacity result |
| WP3 | Each lever's residual rate equals the RBD / CTMC value (`rbd.evaluate`, `kOfNGroup`); plane loss equals `planeLossPerformance` | Planes 1 → 8 on `nvl72Design` moves the plane class from downtime to slowdown with the documented 12 % at 8 planes; 2N vs N+1 power changes the residual by the parallel formula; the iso-target point of each option lies on the curve of `hardware-mechanism-split-98p5` within 2 % |
| WP4 | Floors and cost curves round-trip through the schema; CCF budget bisection matches a direct evaluation | Classes below floor flagged; β* per domain reported with the FIT limits |
| WP5 | Joint B&B reproduces the exact planner on ≤ 10 candidates (same minimum effort, same set); chance constraint agrees with `verify` | At 100k the joint plan returns R-ELASTIC alone (effort 5, 99.07 %) not R-REPLAY + R-PROCESS; D-SDC + R-SDC reachable as a group; 500k returns the Pareto front with the hardware / architecture point that reaches 98.5 % |
| WP6 | Derating by confidence covered by `test/model_fixes_v37.test.ts` style regression; Garwood mode by the existing `fit` goldens | Study results carry the confidence-graded derated value next to the default one |
| WP7 | Intersection equals the per-metric feasibility results already produced by the A_op and delivered studies | 10k feasible in both 口径, 200k only in A_op (as in `REMAP_LATEST_ALLOCATION_98P5`) |
| All | `npm test`, `npm run typecheck`, web build, CLI smoke (`eval`, `allocate`, `plan`, `study`, `acceptance`), screenshots 1280 / 375 light / dark, manual §7 rebuilt | — |

---

## 7. Work packages, order and dependencies

| WP | Content | Depends on | Milestone |
|---|---|---|---|
| WP1 | Architecture-derived weights (counts, fan-out, importance, duty); weight basis on page / CLI / MCP | — | M1 |
| WP2 | Hierarchical allocation with per-level acceptance tables and spares | WP1 | M1 |
| WP3 | Architecture levers in the study (planes, ToR, power, cooling, domain size, hot spares, checkpoint tier); fourth chart | WP1 | M2 |
| WP4 | Floors, cost curves, CCF budget; library `bestKnown` records | — | M2 |
| WP5 | Joint optimisation with chance constraints; branch and bound; prerequisite groups | WP1, WP3, WP4 | M3 |
| WP6 | Confidence-graded derating; Garwood-bound allocation; allocation tornado | — | M3 |
| WP7 | Multi-口径 intersection; inference level; report generalisation (`report/agreeReport.ts`); docs (MODEL_REFERENCE §25, USER_GUIDE, manual §7, SPEC F20–F23) | WP2, WP5 | M4 |

Suggested order: WP1 → WP2 → WP4 → WP3 → WP5 → WP6 → WP7. WP1 first because every later package allocates on its weights; WP3 before WP5 so that the joint optimiser has architecture options to choose from.

Proposed SPEC entries: F20 architecture-derived weights and hierarchical allocation (WP1–2); F21 architecture levers and constraints (WP3–4); F22 joint optimisation with chance constraints and confidence-graded derating (WP5–6); F23 multi-口径 allocation and acceptance-table export (WP7).

---

## 8. Decisions requested

- **[Q1] Default weight basis.** Recommended: `topology` (exposure × importance × duty) as the default for AGREE, with `count` kept for reproducing the published reports. Alternative: `exposure` only (importance fixed at 1), simpler to explain to vendors.
- **[Q2] Architecture levers: closed form only, or also co-simulation?** Recommended: closed form (RBD / CTMC residual rates and the chain) in this phase; the co-simulation path of the architecture roadmap (P4 scheduling / resource DES) is the phase after, once WP3's option set is fixed.
- **[Q3] Objective of the joint optimiser.** Recommended: effort scores (as today) with an optional currency cost when `costA / costB` are filled; no currency defaults are invented.
- **[Q4] Confidence-graded derating values.** The four tiers in §3.6 are proposals; confirm or supply the house values.
- **[Q5] Repository hygiene.** The AGREE and split reports, their scripts and result folders, the summary pages and this plan are untracked; decide whether they are committed with v3.8 or kept as deliverables outside the repository.

---

## 9. Out of scope for v3.8

Physical-layer models of optical or power protection (represented as residual rates and redundancy groups, as in SPEC §1); multi-job scheduling; request-level inference SLO; cash cost of mechanisms beyond optional cost curves; a UI for drawing topologies (the Excel / JSON import remains the input path).
