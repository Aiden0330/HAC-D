# HAC-D — AI Cluster Availability / MTBF / MTTR Modeling Tool

**Development plan v0.1 · 2026-10-08**
Grounded in the companion chapter *AI 集群可靠性建模：MTBF、MTTR 与可靠性框图* (`../survey/ai-cluster-reliability-modeling.html`, §2–§7) and the main survey's §11 / §16 estimator.

---

## 0. What we are building (one paragraph)

A browser-based reliability-engineering workbench for AI (LLM) training and inference clusters. The user describes a cluster design (hierarchy of zones / racks / nodes / GPUs plus shared domains such as NVLink domain, ToR, power zone, CDU and network planes), attaches failure and repair parameters whose **口径** (event definition, denominator, level) is typed and carries provenance, describes the workload (synchronous training job or N+k inference service) and the recovery pipeline (the six MTTR stages), and the tool returns **availability, MTBF / MTBI / MTTF, MTTR (composite and per stage), goodput / ETTR / CETT, spare counts, capacity-availability curves and the dollar cost of unavailability**. It then **allocates** a top-level target (goodput or availability) down to subsystem budgets (allowed λ per component class, allowed MTTR per stage, required spares) and **compares design options** side by side with sensitivity and importance ranking. Methods: hierarchical capacity-aware RBD with a fault-tree view and common-cause factors; CTMC for repairable blocks and spare pools; the Young / Daly / Saxena / Meta-RSC checkpoint-goodput family; quantile-based sparing; Monte Carlo discrete-event simulation for non-exponential, heterogeneous and correlated failures; allocation by AGREE / ARINC / minimum-effort plus an AI-specific "goodput budget" allocation.

What makes it state of the art relative to classical RBD tools (BlockSim-style) and to the survey's own three-tab calculator is listed in §3.4.

---

## 1. What the survey fixes as requirements

| Survey finding | Tool requirement |
|---|---|
| §2: the same "MTBF ≈ 3 h" can be job, node or GPU·h; numbers are only comparable after aligning event definition, denominator and level (Fig. 2-1, Tables 2-1/2-2). | Every parameter is stored with a **口径 type** `{event, denominator unit, level, includes_planned, dedup rule}`; the engine converts (per GPU·h ↔ per node·day ↔ FIT ↔ AFR ↔ GPU·day/failure) explicitly and refuses to add numbers of different event classes (interruption vs error vs ticket). |
| §2: 1/N law empirically holds (Meta RSC) but fails under correlated failures, lemon nodes and elastic/degraded operation. | Scale extrapolation is a first-class operation with validity flags; lemon-node heterogeneity (two-population mixture) and CCF are modelable. |
| §2/§4: exponential and independence assumptions fail (Weibull k = 0.7–0.8 at LANL, wear-out k ≈ 5–7 on Titan, lognormal MTTR mean 355 min vs median 54 min, rack-level correlation ρ = 0.92). | Distributions are first class: exponential, Weibull (shape), lognormal, mixtures; closed forms are the default, Monte Carlo is the fallback whenever a non-exponential or correlated input is present. |
| §4: three canonical RBDs (Fig. 4-1): series training job, k-of-n job with hot spares, N+k inference replicas; plus NVL72 domain vs 8-GPU node, power 2N / N+1, multi-plane network, k-of-144 cubes (Table 4-1, five worked diagrams). | Templates for all five, nestable (a k-of-n block can be a leaf of a series chain). |
| §4: Markov birth–death chain for spares (Fig. 4-3), Meta Sparing CTMCs, Poisson blocked-probability closed form, degraded (fail-slow) states with capacity coefficient c_s, SDC "latent" state. | CTMC engine with steady-state, first-passage (MTTF) and transient solvers; performability output A_cap = Σ π_s·c_s. |
| §4: CCF has clear hardware anchors (NVL72 busbar/manifold, CDU, OCS, ToR, shared storage) but no published β. | β-factor CCF per domain is an explicit, sweepable assumption; never a hidden default. |
| §5: MTTR = detection + localization + remediation + restart + load + recompute (+ warm-up/slow-down), with measured ranges per stage (Table 5-1) and restart/localization growing with N. | MTTR is a **pipeline model**, each stage with a value or distribution and a scale law; the composite MTTR is derived, not typed. |
| §6: Young / Daly (3-term, Lambert W) / Saxena availability-optimal / Meta E[ETTR] / SCR multilevel / replica recovery; one-order formulas break when τ+δ ≪ M or R ≪ M fails (Fig. 6-2; 100K-GPU "restart-dominated" regime). | Implement the full family; always check and display the validity conditions; switch to the full Daly model or simulation automatically when violated. |
| §6: spares are a quantile problem (Binomial P99, Poisson blocked), not a ratio; block size trades spare fraction vs stranding vs TP gain (Meta Table 6-3). | Spare sizing by quantile with configurable confidence and repair turnaround; block-size comparison with stranding and performance factors. |
| §6: reliability enters TCO (TrainMover $/day, SemiAnalysis goodput share of TCO). | Cost module: wasted GPU·h → $/day, spare capex, option deltas. |
| §6: design-review checklist (11 items). | Built-in "design review" report that evaluates a scenario against the checklist. |
| §7: SDC is a latent state; prediction buys little on timing but ranks lemon nodes; screening changes infant-mortality λ. | Latent-SDC state and screening/lemon-removal parameters in the model; prediction as (recall, precision, lead time) effect on λ_unplanned. |
| Open problems: CCF parameters, non-exponential, fail-slow, 10⁵–10⁶ extrapolation, data scarcity, 口径 standardization, NVL72 / liquid cooling / CPO. | Where the survey has no data the tool exposes the assumption, offers ranges and runs sweeps; it never silently fills a number. |

---

## 2. Use cases

| # | Use case | Primary output |
|---|---|---|
| UC1 | Evaluate a cluster design: steady-state availability, MTBF, MTTR, failures/year, weakest block | KPI panel + per-block table + RBD diagram |
| UC2 | Training job: MTBI, optimal checkpoint interval, goodput/ETTR, loss decomposition (δ/τ, τ/2, R), wasted GPU·h and $/day, scale extrapolation 1K → 1M GPUs with validity flags | Goodput page + scale table + regime warnings |
| UC3 | Inference service: N+k replicas for a capacity-availability target; "service up" vs "capacity sufficient"; degradable EP instances | N+k curve, capacity availability curve P(X ≥ k) |
| UC4 | Spares: hot/warm/cold counts at P99/P99.9 given repair turnaround; blocked probability; block-size trade-off | Spare table, decision map in the MTBF–MTTR plane |
| UC5 | Allocation: from a goodput or availability target to subsystem budgets (λ per component class, MTTR per stage, spares, CCF ceiling) | Allocation table with derived engineering requirements |
| UC6 | Compare design options (NVL72 vs HGX8; 2N vs N+1; detection by timeout vs probe; checkpoint tier; hot spares 0/4/8; dual ToR) | Side-by-side KPIs, deltas, Pareto (goodput vs cost), tornado |
| UC7 | Sensitivity and importance: which parameter moves the result; Birnbaum / Fussell-Vesely / RAW importance per block | Ranked tables, tornado and 2-D sweeps |
| UC8 | Monte Carlo check: Weibull lifetimes, lognormal repairs, finite repair crews, CCF shocks, lemon-node mixture; confidence intervals; closed-form vs simulation delta | Distributions, CIs, comparison badge |
| UC9 | Parameter library: survey-sourced defaults with provenance and 口径; user parameters; unit conversion | Library browser |
| UC10 | Fit parameters from an incident log (CSV): exponential/Weibull MLE, lognormal MTTR, per-GPU·h conversion, infant-mortality segmentation | Fitted parameters with CIs (v2) |
| UC11 | Report: self-contained HTML (survey visual style), JSON scenario, CSV tables, SVG/PNG charts; design-review checklist verdicts | Export |

---

## 3. Modeling methods

### 3.1 Modeling stack (what the engine computes, bottom-up)

```
L4 Decision     compare options · cost/TCO · allocation (top-down) · design-review checklist
L3 Workload     training goodput (checkpoint + recovery) · inference capacity N+k · job-duration risk
L2 Structure    hierarchical RBD / fault tree (series, parallel, k-of-n, standby, capacity states,
                CCF β, failure domains) · CTMC for repairable blocks & spare pools
L1 Components   failure distributions (exp / Weibull / lognormal / mixture) · MTTR pipeline (6 stages,
                scale laws) · fail-slow degraded state · SDC latent state · screening & prediction effects
L0 Data         口径-typed parameter library with provenance · unit conversion · (v2) log fitting
```

### 3.2 Method table

| Method | Answers | Inputs | Outputs | Survey anchor / validation |
|---|---|---|---|---|
| **Hierarchical capacity-aware RBD** (series, parallel, k-of-n, standby with switch probability, nested blocks; each block has an optional capacity coefficient) | static availability and failure rate of a structure | per-block λ (or MTBF), MTTR, n, k, c_s | A_sys, λ_sys, MTBF_sys, equivalent MTTR, A_cap, weakest block, block contributions | Fig. 4-1, Table 4-1, five worked diagrams; textbook results (two hot units MTTF = 3/(2λ), ideal cold standby 2/λ, (1+p_s)/λ with switch) |
| **Fault-tree view + minimal cut sets** (dual of the RBD; OR = series, AND = parallel, voting = k-of-n) | which single events or event pairs take the job down; where CCF enters | same structure + CCF events | minimal cut sets, top-event probability, importance measures (Birnbaum, Fussell-Vesely, RAW/RRW) | §4 "故障树是对偶视图"; CCF anchors (ToR, OCS, busbar, CDU, Lustre) |
| **Common-cause β-factor** (λ_i = (1−β)λ_i independent + β·λ as a shared series event per domain) | effect of shared power / cooling / switch / storage domains | β per domain (swept), domain membership | corrected A, cut sets, sensitivity to β | §4.3; LANL 5–10× hardware failure after power events; Minder 32/600 per switch event |
| **CTMC repairable models** (birth–death spare chain, k-of-n with c repair crews, degraded states, SDC latent state, post-repair high-risk state) | blocked probability, MTTF to spare exhaustion, steady-state availability, performability | λ, μ = 1/MTTR, N, k, crews, c_s, λ_SDC, T_expose | π, A, A_cap, MTTF (first passage), transient A(t) | Fig. 4-3 (the current calculator's `mttfKofN` tridiagonal solve), Meta Sparing eq. 3/4/7, Poisson approximation, SCR hierarchical chain |
| **Checkpoint / goodput family** — Young √(2δM); Daly 3-term and exact Lambert-W; Saxena availability-optimal T_c* = T_s + √(2(T_f+T_r)T_s + T_s²); Meta RSC E[ETTR] with queue q; SCR multilevel efficiency; replica/in-memory recovery (R → seconds, recompute → 1 step); SPARe / replication (MTTI ≈ √(πb)·μ) as optional | optimal interval, goodput, wasted GPU·h, regime (checkpoint- vs restart-dominated) | δ (exposed save), M = 1/(Nλ), R, levels, q | τ*, goodput, loss decomposition, ETTR(N) | §6 Tables 6-1/6-2, worked examples 1–2, TrainMover ETTR(N), Epoch 2.1% |
| **Sparing** — Binomial P-quantile (ByteRobust), Poisson blocked probability (Meta), Erlang-type pipeline with turnaround L, hot/warm/cold, block-size trade-off with stranding and performance factor | how many spares, where, at what granularity | N, p_daily or λ, MTTR/turnaround, quantile, block K, placement group P | k_hot, pool size, Pr(blocked), CETT-style accounting | Table 6-3/6-4, worked example 3, 1/H scaling law |
| **MTTR pipeline** — six stages, each a constant or distribution with a scale law: constant, a + b·log N, linear, max-order-statistic (slowest-node), bandwidth-bound (size / BW(N)) | composite MTTR and its growth with N | stage parameters, N | R(N), stage shares, which stage dominates | §5 Fig. 5-1 and Table 5-1 (TrainMover 0.52+1.5+4.45 min; Holmes 15.5→30.3 s; FlashRecovery 231→1,115 s; BootSeer slowest-node) |
| **Scale extrapolation** with validity guards | what happens at 64K / 128K / 1M GPUs | λ, N, R(N), δ | MTBI(N), goodput(N), flags: τ+δ ≪ M ?, R ≪ M ?, δ ≥ 2M ? | §2 1/N law, Table 6-6, Daly Fig. 6-2 |
| **Non-exponential & heterogeneity** — Weibull series (scale shrinks as N^(−1/k)), mean-matched Weibull α = (1/λ)/Γ(1+1/k), two-population lemon mixture, infant-mortality segment, lognormal repair | when the exponential answer is wrong and by how much | k, mixture fraction, multiplier | MTTF(N) from-new vs steady renewal, quantile MTTR | §4.3 formulas; AIReSim good/bad servers (15 % at 5×); SPARe k = 0.78 flipping r* |
| **Monte Carlo DES** (TypeScript, seeded, Web Worker) — units with age-tracked lifetimes, repair with finite crews, hot/warm/cold spares with replenishment, CCF shocks per domain, synchronous-job semantics (any failure stops the job), checkpoint interval and recovery draws, degraded states, screening | distributions and CIs for everything above when closed forms do not apply; cross-check of closed forms | full scenario + replications + seed | goodput / MTBI / spare usage distributions, P50/P99, CI, closed-form delta | AIReSim design; Meta Sparing vs Arcadia < 1 %; SPARe vs MC MAPE 1.13 % |
| **Allocation** — equal apportionment; ARINC (∝ current λ_i); AGREE (complexity n_i, importance w_i, duty time t_i); feasibility-of-improvement (Karmiol weights); minimum-effort / cost-optimal (Albert's algorithm, convex cost G_i(λ_i)); **goodput-budget allocation** (split 1−goodput into δ/τ, λ·τ/2, λ·R, then λ across component classes weighted by n_i and MTTR across the six stages) | what each subsystem must achieve for the top-level target | target (A*, goodput*, SLO), structure, weights / cost curves, fixed items | allowed λ_i (per unit and aggregate), allowed MTTR per stage, required k spares, CCF ceiling; feasibility vs library ranges | Checklist "先压 R 与 δ，再谈备件与间隔"; Meta RSC "r_f 6.50 → 1 or w_cp → 10 s to keep ETTR 0.9" |
| **Importance & sensitivity** — Birnbaum, Fussell-Vesely, RAW/RRW; ∂goodput/∂x; one-at-a-time tornado; 2-D sweeps (MTBF–MTTR decision maps); optional Sobol via MC | where to spend engineering effort | scenario, ranges | ranked lists, tornado, heat maps | §4 "敏感性可从公式读出" (n_i weighting; R linear vs √λ) |
| **Cost / TCO** | monetary value of reliability options | $/GPU·h, N, spare capex, option deltas | $/day lost, spare cost, option NPV-style deltas | TrainMover $0.95M/$3.63M per day; SemiAnalysis 92 % goodput share |
| **Prediction & screening effects** | λ_unplanned = (1−R)·λ, λ_alarm = R·λ/P; λ_eff = λ_steady + (1−y)·λ_infant | recall, precision, lead time, interception y | adjusted λ, net benefit | §7 formulas |

### 3.3 Three system templates (instantiate the hierarchy; all editable)

1. **Synchronous training job** — series chain of {GPU×N, NVSwitch, NIC/optics, switches, checkpoint storage, power feed, cooling, software}; optional hot-spare pool turning the GPU/node block into k-of-n; failure domains: node (8 GPU), NVL72 rack (72 GPU), ToR, power zone, CDU, network planes (lose one plane = capacity (P−1)/P). Outputs MTBI, goodput, spares.
2. **Inference service** — N+k replicas (k-of-n with capacity), replica = series of TP/EP ranks (or degradable k-of-n under EEP-style elasticity), PD split as series of pools; "service up" (A_any) vs "capacity sufficient" (A_cap); SLO window risk.
3. **Infrastructure** — power 2N (1-of-2) / N+1 / 4N/3 catcher; cooling N+1 mCDU (5-of-6); dual-ToR vs single ToR; multi-plane network; storage mirroring; CCF between them.

### 3.4 What is new versus the survey's calculator and classical RBD tools

- Arbitrary nested structures with **capacity (performability) states**, not two-state blocks only.
- **口径-typed** parameters with provenance and refusal to mix event classes.
- **MTTR as a six-stage pipeline with scale laws**, so MTTR grows with N instead of being a constant.
- **CCF β per failure domain** and **non-exponential / lemon-node** inputs with automatic fallback to Monte Carlo.
- **Validity guards** on every first-order formula, with the restart-dominated regime detected.
- **Top-down allocation** from goodput or availability targets to procurement-grade requirements.
- **Option comparison with cost**, tornado and MTBF–MTTR decision maps.
- Headless **CLI / MCP** access so agents can run analyses, and reproducible scenario files.

---

## 4. Architecture options

| | A. Client-only static app | **C. Hybrid, client-first (recommended)** | B. Web frontend + Python backend |
|---|---|---|---|
| Compute | TypeScript in Web Workers | TS core package shared by browser, Node CLI and MCP server; Web Workers in the browser; optional compute service later | FastAPI + numpy/scipy + SimPy in Docker |
| Persistence | scenario JSON download/upload, localStorage autosave, URL state | same in v1; optional SQLite service in v2 for team libraries | database from day one |
| Deployment | static hosting or a single self-contained HTML file (matches your survey deliverables) | same as A; `packages/cli` and `packages/mcp` run from Node | docker compose; needs ops |
| Monte Carlo capacity | 4,096 servers × months × 200 replications ≈ seconds in a worker | same; batch sweeps via CLI | best for very large sweeps |
| Agent access | none | CLI + MCP tools (`evaluate`, `allocate`, `compare`, `simulate`) | REST API |
| Cost of ownership | lowest | low | highest; two languages |

**Recommendation: C.** One numerics core in TypeScript with golden tests, consumed by a static web app; CLI and MCP wrappers come almost for free. The Python backend is deferred to a v2 decision (only if sweeps outgrow the browser or a shared team library is required).

**Stack (if C):** TypeScript 5 · Vite · React 18 · Zustand · zod (schema + validation + generated JSON Schema) · Comlink Web Workers · Observable Plot / D3 for charts (per the `dataviz` skill) · custom SVG auto-layout for RBD / fault tree / Markov diagrams (ELK.js or dagre for chains) · i18next for zh/en · Vitest for unit and golden tests · Playwright for browser checks at 1280 px and 375 px, light and dark (your existing convention) · npm workspaces monorepo (`packages/core`, `apps/web`, `packages/cli`, `packages/mcp`) · design tokens taken from the survey page (IBM Plex Sans/Mono/Serif, the `--accent #3B3FB6` palette, light/dark via `data-theme`). Node 20 is installed; no extra runtime needed.

**Core API sketch**

```ts
evaluate(scenario: Scenario): Result                 // RBD + CTMC + goodput + spares + cost
allocate(scenario, target: Target, policy: AllocationPolicy): Allocation
compare(scenarios: Scenario[]): Comparison           // KPIs, deltas, Pareto
sensitivity(scenario, ranges: ParamRange[]): Tornado
simulate(scenario, opts: {replications, seed, horizon}): McResult   // runs in a worker
convert(value: Quantity, to: Unit): Quantity         // 口径-aware
```

---

## 5. Data model (scenario file, JSON, zod-validated)

```
Scenario
├─ meta            name, version, author, notes, created, basis (survey refs)
├─ library[]       ParameterRecord { id, component class, value, unit, distribution{type, shape},
│                   口径{event, denominator, level, includes_planned, dedup}, provenance{source, venue,
│                   year, url, confidence: measured|vendor|derived|assumed, caveat} }
├─ topology        Hierarchy: zone > rack > node > device; domains: nvlink_domain, tor, power_zone,
│                   cdu, plane; counts and membership
├─ components[]    { class, count_rule (per GPU | per node | per rack | fixed), λ_ref → library,
│                   mttr_ref → pipeline or value, β_ccf per domain, failslow{p, slowdown, duration},
│                   infant{multiplier, duration}, lemon{fraction, multiplier} }
├─ structure       Block tree: series | parallel | kofn{n,k} | standby{n, p_switch} | leaf → component,
│                   capacity_rule (min | sum/required | plane (P−1)/P), nestable
├─ workload        training{N, gpus_per_node, duration_days, δ_exposed, checkpoint tiers[],
│                   parallel groups DP/TP/PP/EP, elasticity: none|replica|slice}
│                   | inference{n_required, g_per_replica, k, capacity_target, window_h, degradable}
├─ recovery        pipeline{detect, localize, remediate, restart, load, recompute, warmup}: each
│                   {value or distribution, scale_law{type, params}}
├─ spares          {hot, warm, cold, turnaround_days, replenish_policy, quantile, block_size K,
│                   placement_group P}
├─ targets         {availability, goodput, capacity_availability, slo_window}
├─ costs           {$ per GPU·h, spare unit cost, $ per interruption, horizon}
└─ assumptions     explicit list rendered in reports (independence, exponential, β values, ...)
```

Comparison sets are arrays of scenarios sharing a base and listing overrides, so an option is "base + patch" and diffs are explicit.

---

## 6. Inputs and outputs

### 6.1 Inputs

| Group | Fields | Default source (all with provenance) |
|---|---|---|
| Cluster | GPUs, GPUs/node, nodes/rack, racks/zone, NVLink domain size (8 / 72), network planes, ToR mode (single / dual), power (2N / N+1 / catcher), cooling (N+1 mCDU) | templates: HGX-8 node cluster, GB200 NVL72, TPU cube/OCS, Ascend CloudMatrix (structure only) |
| Component failure | λ or MTBF with unit; distribution and shape; infant / wear-out; lemon mixture; β per domain | Table 3-2 / 4-2: 1/50,000 GPU·h (Llama 3), r_f 6.50 / 2.34 per 1,000 node·day (RSC), 1/9.0e4–9.9e4 GPU·h (CoreWeave, Nebius), TPU 0.08 % / 0.005 % / 0.04 % per day, HBM UE MTBE 88,768 h (H100) / 283,271 h (A100); missing classes (NVLink, optics, NIC, PSU, CDU) marked `assumed` |
| Recovery pipeline | six stage values or distributions, scale laws, automation level | Table 5-1 presets: timeout 10–30 min vs probe 2–60 s; TrainMover 0.52 + 1.5 + 4.45 min; FlashRecovery 78–116 s; warm standby ≈ 20 s; node repair 12 min (Nebius) to days (SIGMA) |
| Checkpoint | exposed save δ, end-to-end save, load bandwidth, tiers (GPU/host memory, peer replica, remote) | Table 6-2: 2.43 s / 0.32 s (Epoch), ByteCheckpoint 0.59 s block / 51 s save / 129 s load, Lablup 18–32 s |
| Workload | N, duration, parallel groups, elasticity mode; inference n, g, k, capacity target, window | worked examples 1–4 |
| Spares | hot/warm/cold counts, turnaround, quantile, block size, placement group | ByteRobust P99; Meta tray 20K h / rack 10K h / MTTR 24 h |
| Targets & costs | goodput*, A*, capacity availability*, $/GPU·h | AWS Capacity Blocks $1.44M per 16K GPU·day (TrainMover) |
| Import formats | UI forms, scenario JSON, CSV component list, (v2) incident-log CSV | — |

### 6.2 Outputs

| Output | Definition shown next to the number |
|---|---|
| A_sys, A_cap | ΠA_i over series blocks; k-of-n binomial; Σ π_s c_s for degraded states |
| MTBF / MTBI / MTTF | 1/Σ n_i λ_i; job MTBI = 1/(Nλ); spare-exhaustion MTTF from the birth–death chain |
| MTTR composite and per stage; equivalent MTTR (1−A)·MTBF | pipeline sum with scale laws |
| Optimal checkpoint interval (Young, Daly 3-term, Saxena) and regime flags | τ+δ ≪ M, R ≪ M, δ ≥ 2M |
| Goodput / ETTR, loss decomposition (δ/τ, τ/2·λ, R·λ), wasted GPU·h/day, $/day | first-order goodput ≈ 1 − δ/τ − (τ/2 + R)/M |
| Scale table 1K → 1M GPUs | MTBI(N), τ(N), goodput(N), interruptions/day |
| Spares: hot count at P99/P99.9, pool size, Pr(blocked), block-size table | Binomial / Poisson / CTMC |
| Capacity availability curve P(X ≥ k) | binomial tail; MC when correlated |
| Minimal cut sets, importance measures, tornado, 2-D decision map | fault-tree and derivative analysis |
| Allocation table: per subsystem allowed λ (unit and aggregate), per stage allowed time, spares, β ceiling, feasibility flag vs library range | chosen policy |
| Comparison: KPI matrix, deltas, Pareto plot, ranking | — |
| Monte Carlo: distributions, P50/P99, CI, closed-form delta | — |
| Design-review verdicts (11 checklist items) and assumption list | — |
| Exports: HTML report, JSON scenario, CSV, SVG/PNG | — |

---

## 7. UI (pages)

1. **Scenario** — topology form + structure outline editor; auto-rendered RBD and fault-tree diagrams (SVG, light/dark); assumption banner.
2. **Library** — parameter records with 口径 and provenance; filters by confidence; unit converter; "use in scenario".
3. **Training job** — goodput, interval, loss decomposition, scale table, regime flags (the survey's tab 1, extended).
4. **Inference** — N+k, capacity availability curve, degradable replicas (tab 3, extended).
5. **Spares & domains** — quantile sizing, block-size trade-off, MTBF–MTTR decision map.
6. **Allocation** — pick target and policy, see budgets and feasibility.
7. **Compare** — option matrix, Pareto, tornado.
8. **Simulate** — Monte Carlo runs with progress, CIs and closed-form comparison.
9. **Report** — design-review checklist, exports.

Bilingual zh/en toggle (as in your build notes), light/dark/auto theme, keyboard-navigable forms, WCAG AA contrast (checked with the `design:accessibility-review` skill), mobile layout at 375 px.

---

## 8. Validation plan (golden vectors from the survey)

Unit tests in `packages/core` must reproduce these to stated tolerances before any UI work:

| Case | Expected |
|---|---|
| Unit conversion (Table 2-2) | 54×24×16,384/419 ≈ 50,680 GPU·h; 1000×24×8/6.50 ≈ 2.95e4; 3,748.25×24 ≈ 9.0e4; 33.0×3,000 ≈ 9.9e4 |
| 1/N law | r_f = 6.50, 8 GPU/node: 16,384 GPU → 1.8 h; 131,072 GPU → 0.23 h; CoreWeave 3,748.25 GPU·day → 1,024 GPU 3.66 days |
| Worked example 1 (Table 6-5) | λ_job 0.323/h; MTBI 185.6 min; τ_YD 232.6 s; Daly lowest-order 230.2 s, 3-term 231.0 s; goodput 97.9 % (R=0), 95.5 % (R=4.45 min), 94.4 % (R=6.47 min); availability-optimal interval 237.8 s |
| Worked example 2 (Table 6-6) | N = 65,536: M 46.4 min, τ 116.3 s, loss 4.2 %, goodput 86.2 % / 74.3 % (R = 4.45 / 10 min); N = 131,072: 23.2 min, 82.2 s, 5.9 %, 74.9 % / 51.0 % plus a regime warning (R/M = 0.43) |
| Worked example 3 (Table 6-7) | 1,024 nodes, r_f 2.3: Binomial P99 = 7, P99.9 = 8; Poisson MTTR 8 h → 3, 2.2 h → 2. r_f 6.50: P99 13, P99.9 16; Poisson 6 and 3 |
| Worked example 4 (Table 6-8) | n = 64, p = 0.993: k = 0 → 63.8 %; k = 1/2/3 → 92.4 / 98.87 / 99.87 %; k = 4 → 99.988 %; k = 5 → 99.999 %; p = 0.99: k = 4 → 99.94 %; mirrored pairs (1−0.007²)^64 ≈ 99.69 % |
| Daly 2006 | M = 24 h / 6 h / 15 min with δ = 5 min → τ_opt 117 / 57 / 9.1 min |
| Saxena 2024 | T_f = 1 h, T_s = 30 s, T_r = 16 min → 9.23 min vs Young 7.74 min; T_s = 1 s, T_r = 4 min → 1.477 vs 1.414 min |
| TrainMover ETTR(N) | D = 4.45 min, MTTF 216/108/54/27/14 min → 97.94 / 95.88 / 91.76 / 83.52 / 68.21 % |
| Lablup | M = 56.2 h, δ = 18 s → Young 44.9 min |
| Google Ironwood k-of-n | n = 144, k = 130 at 95 % ⇒ p ∈ [0.935, 0.940]; k99 = 127–128 at the same p |
| ByteRobust | Binomial P99 = 4 at N = 1,024 ⇒ p_daily ≈ 0.08–0.125 %; 3 at 512; 2 at 128/256 |
| Meta Sparing | tray MTBF 20K h, rack 10K h, MTTR 24 h: inter-block spare fraction 8.6 / 4.7 / 2.6 % for 72 / 36 / 18-GPU blocks (tolerance to be set once L and the blocked-probability target are reverse-engineered); 1/H scaling law exact |
| Textbook CTMC | two hot units MTTF 3/(2λ); ideal cold standby 2/λ; two units, one repairman (3λ+μ)/(2λ²); k = 0 chain reduces to 1/(Nλ) |
| Replication (Benoit SC'19) | n_fail(2b) = 1 + 4^b / C(2b,b) ≈ √(πb); b = 1e5 → 561 |
| NTP amplification | p = 0.001, T = 64 → 1 − (1−p)^T ≈ 0.062 |
| Monte Carlo vs closed form | exponential inputs: goodput, MTBI, Pr(blocked) within 1–2 % of closed forms (Meta/SPARe precedent); Weibull k = 0.78 reproduces the SPARe-style flip in optimal redundancy direction |
| Property tests | monotonicity in λ, MTTR, N, k; A ≤ A_cap bounds; allocation budgets sum to target |

Browser checks: Playwright at 1280 px and 375 px, light and dark; no horizontal scroll; every KPI shows its formula; exports round-trip (JSON → load → same KPIs).

---

## 9. Skills, agents and workflows

### 9.1 Claude skills to use during development

| Skill | Where |
|---|---|
| `engineering:architecture` | three ADRs: client-first hybrid; TypeScript numerics core; scenario schema |
| `engineering:system-design` | module boundaries, worker protocol, export pipeline |
| `engineering:testing-strategy` | golden-vector plan above, property tests, browser checks |
| `dataviz` | every chart, KPI tile, tornado, heat map, decision map |
| `artifact-design` | if a hosted preview artifact is wanted during review |
| `design:accessibility-review`, `design:ux-copy` | forms, bilingual microcopy, error and validity messages |
| `code-review`, `security-review`, `simplify` | before each phase gate |
| `engineering:documentation` | user guide, model reference (formula per output), CLAUDE.md via `init` |
| `claude-api` | only if the optional copilot is built |

### 9.2 Project skills to create (`.claude/skills/`)

- `model-check` — re-derive a formula independently and compare against the golden vectors; run on every change to `packages/core`.
- `add-parameter` — add a library record with all 口径 and provenance fields filled, validated against the schema.
- `scenario-review` — apply the survey's 11-item design-review checklist to a scenario JSON and emit the verdict table.
- `release-check` — build, run goldens, Playwright at 1280/375 light/dark, export round-trip.

### 9.3 Development agents (Claude Code subagents, orchestrated from this session)

| Role | Deliverable | Gate |
|---|---|---|
| Spec writer | PRD, model spec (every formula with source), schema, UI spec | you review |
| Independent math verifier (fresh context, Python/mpmath) | numeric golden vectors from the formulas and survey tables; discrepancies filed | goldens agreed |
| Core implementer | `packages/core` with tests | goldens pass |
| UI implementer | `apps/web` pages against a fixed core API | Playwright green |
| Library curator | parameter records from survey Tables 3-2 / 4-2 / 5-1 / 6-2 / 6-4 (optionally cross-checked against `cluster-modeling-build/corpus.json`) | provenance complete |
| Reviewers (correctness, a11y/i18n, security) | patch lists | applied |
| Docs writer | user guide + model reference | — |

Default: I orchestrate and implement directly, delegating only the independent verification, the library curation and the reviews (independent eyes are where delegation pays). A full fan-out `Workflow` is available if you prefer the survey-style pipeline; it costs several times more tokens.

### 9.4 Runtime agents (optional, later phases)

- **MCP server** (`packages/mcp`) exposing `evaluate`, `allocate`, `compare`, `simulate`, `convert` so Claude Code sessions and other agents can run analyses headlessly on scenario files.
- **Copilot panel** (Claude API): explain a result and its assumptions; propose an allocation under constraints; turn a BOM / topology description into a scenario; fit an incident log; draft the design-review memo. Needs an API key path (user-held key in browser, or a tiny proxy) — a decision for you.

---

## 10. Roadmap

| Phase | Scope | Exit criteria | Rough size |
|---|---|---|---|
| **P0 Specs** | PRD, model spec, scenario schema, golden-vector file, ADRs, repo skeleton (git, workspaces, CI) | you approve specs; goldens computed independently | 1 session |
| **P1 Core** | RBD/FT + cut sets, CTMC solvers, goodput family, sparing, MTTR pipeline, scale guards, unit conversion, importance; CLI | all goldens and property tests pass | 2–3 sessions |
| **P2 Web app v1** | Scenario, Library, Training, Inference, Spares pages; diagrams; bilingual; themes; JSON import/export | Playwright checks; worked examples 1–4 reproducible in the UI | 2–3 sessions |
| **P3 Decision layer** | Allocation (all policies), Compare, Sensitivity/tornado/decision maps, cost module | allocation goldens; option comparison on the five worked diagrams | 2 sessions |
| **P4 Simulation** | Monte Carlo DES in workers, Weibull/lognormal/mixture/CCF/finite crews, CI, closed-form delta badge | MC vs closed form within tolerance on exponential inputs | 2 sessions |
| **P5 Report & polish** | HTML report in survey style, design-review checklist, a11y pass, docs, release-check skill | release-check green | 1–2 sessions |
| **P6 Optional** | MCP server, incident-log fitting, copilot, Python compute service / team library | per decision | — |

Sizes are rough and assume the recommended architecture.

---

## 11. Risks and standing assumptions

- **No published β for CCF, no NVLink/optics/PSU/CDU failure rates.** The tool ships these as `assumed` ranges and forces a sweep; reports list them under "assumptions".
- **Exponential defaults can be wrong in both directions** (k ≈ 0.7 infant vs k ≈ 5 wear-out). Monte Carlo is the fallback, with a visible badge when it disagrees with the closed form by more than a threshold.
- **口径 mixing is the most likely user error.** Typed units and refusal to add errors to interruptions mitigate it; conversions are shown step by step.
- **First-order formulas silently break at 10⁵ GPUs.** Guards are mandatory; the UI switches models rather than printing a number.
- **Monetization depends on a price assumption.** Prices are inputs with provenance, never hard-coded.
- **Vendor-reported recovery times (Huawei, CoreWeave, Databricks) are not measurements.** Confidence tags propagate into reports.

---

## 12. Questions for you (decisions that change the build)

Asked interactively:

1. Architecture — hybrid client-first (recommended) vs client-only vs frontend + Python backend.
2. UI language — bilingual zh/en toggle (recommended) vs Chinese only vs English only.
3. v1 scope — full (analytical + Monte Carlo + allocation + comparison) vs analytical first vs minimal.
4. Build approach — I build directly with targeted subagents (recommended) vs survey-style multi-agent workflow vs detailed specs for review before code.

Defaults I will take unless you say otherwise:

- Hardware structure presets in this order: HGX-8 H100/B200 node clusters, GB200 NVL72, TPU cube + OCS, Ascend CloudMatrix (structure only; no vendor numbers beyond what the survey tags as vendor-reported).
- Parameter provenance comes from the companion chapter's tables; I will read `../survey/cluster-modeling-build/corpus.json` read-only to cross-check citations.
- Visual style follows the survey page (IBM Plex, the indigo accent, light/dark); the tool is named HAC-D until you choose a name.
- Repository initialised with git in this folder; static deployment target left open (GitHub Pages or a single HTML file both supported).
- No Claude-API copilot in v1; MCP server is in P6.
- English code and docs; bilingual UI strings.

---

## 13. Status (2026-10-09)

Decisions taken: hybrid client-first architecture; bilingual zh/en UI; full v1 scope; direct build with subagents for independent verification and library curation.

| Phase | Status | Evidence |
|---|---|---|
| P0 Specs | done | this plan; `docs/MODEL_REFERENCE.md`; zod schema with JSON-Schema export; 143 golden vectors computed independently (`packages/core/test/golden`) |
| P1 Core | done | `packages/core`: 245 tests green (goldens, textbook CTMC identities, worked examples 1–4, Daly/Saxena/TrainMover/Ironwood/ByteRobust, allocation methods, MC chunking); CLI `eval/compare/allocate/tornado/simulate` |
| P2 Web app | done | Scenario editor (forms, component table, recovery pipeline editor, JSON editor, RBD diagram), Training, Inference, Spares, Library pages; bilingual; light/dark; checked at 1280×900 and 375×812 |
| P3 Decision layer | done | Allocation page (6 methods + goodput budget + stage budgets + availability split), Compare page (KPI matrix, bars, tornado), cost module |
| P4 Simulation | done | Monte Carlo DES in a Web Worker with progress; agreement badge vs closed form (worked example 1: 95.65 % ± 0.06 vs 95.51 %) |
| P5 Report & polish | done (initial) | Report page: checklist, importance, cut sets, exports (HTML report, CSV, JSON); README, model reference, user guide; project skills `model-check`, `add-parameter`, `scenario-review`, `release-check` |
| P6 Optional | partly | MCP server (`packages/mcp`, 9 tools) done; incident-log fitting, copilot and Python compute service not started |

Known gaps and next steps:
- Playwright automation of the browser checks is not set up (checks were done manually in the built-in browser); `release-check` documents the manual procedure.
- Fault-tree and Markov-chain diagrams are not drawn (the RBD diagram and cut-set table cover the structure).
- Inference workloads are not simulated by the Monte Carlo module (training only).
- The CCF treatment in the closed forms is conservative (β·Σλ over all domain instances); the simulator uses blast radii.
- Library records are not yet editable from the UI beyond "use as rate"; adding records goes through the `add-parameter` skill.

- 2026-10-09: v2 enhancement proposal (Ascend topology, dual-path MTTR, sub-health, original vs compensated, switchover, Excel import) in `PLAN_V2_AVAILABILITY_ENHANCEMENTS.md`.

### v2 status (2026-10-09, all four decisions = recommended options)

| Phase | Status | Evidence |
|---|---|---|
| E1 Core models | done | `ctmc/repair.ts` (dual repair, k-of-n with switchover, sub-health, straggler, plane loss), `rbd` measures + waterfall, schema v0.2 (backward compatible); 26 v2 golden vectors computed independently (`test/golden/golden_v2.json`), 298 core tests |
| E2 Ladder + integration | done | `recovery/ladder.ts` with `mindcluster-a3` / `generic-auto-restart`; evaluation uses straggler law, isolation interruptions, ladder R(N); MC adapter with the dual-repair distribution |
| E3 Ascend | done | `SuperpodSchema` + presets (`cloudmatrix384`, `atlas950`), superpod count scopes, examples `ascend-cm384` / `ascend-atlas950`; 104 sourced records merged into the library (`docs/ASCEND_SOURCES.md`) |
| E4 Importers | done | `packages/importers`: SheetJS reader, 19-tag fingerprint catalogue with header-context retagging, topology extraction (levels / indentation / outline / formula graph), scenario conversion, reconciliation, xlsx export; 9 fixture workbooks, 29 tests; CLI `methods` / `import-excel` / `export-excel`, MCP tools |
| E5 Web | done | Import page; measures card and waterfall (Report), KPIs (Scenario), columns (Compare), sub-health and ladder cards (Training); scenario editors for supernode geometry, measures, ladder, component details |
| E6 Export + docs | done | xlsx export (Report / Import / CLI / MCP); README, USER_GUIDE, MODEL_REFERENCE §10–17, ASCEND_SOURCES |

Open after v2: image / diagram import (adapter onto the TopologyDraft IR), Monte Carlo for the isolate policy and switchover failures (closed forms only), per-block measures in the RBD diagram, Playwright automation.

### v3 status (2026-10-10, decisions: goodput-based allocation, four-source granularity, mechanism library + Shapley, SDC first)

| Phase | Status | Evidence |
|---|---|---|
| V1 Silent corruption delivery model | done | `sdc/index.ts` (alternating renewal, finite window), schema `component.sdc` / `scenario.sdc`, §20; 5 independent goldens (renewal equations on a grid) |
| V2 Mechanism chain + mixed renewal | done | `mechanisms/chain.ts`, `checkpoint/renewalGoodputMixed`, §19; 10 goldens |
| V3 Window-ledger Monte Carlo | done | `mc/ledger.ts`, `mc/ledgerFromScenario.ts`, §21; conservation asserted per replication |
| V4 Mechanism library + Shapley | done | `mechanisms/index.ts` (12 reference mechanisms, exact Shapley), Mechanisms page |
| V5 Reference reproduction | done | `ref-three-classes-100k`; delivered within the reference CI at four scales (`docs/REFERENCE_COMPARISON_100K_500K.md` §5) |
| Tests | 349 core (18 files incl. `golden_v3`, `v3_models`) + 29 importers | `npm test` |

Open after v3: DP-elastic *template* (F5) beside the chain rung, Monte Carlo confidence intervals for Shapley (ledger over coalitions), image / diagram import. Done since: target scans (planner, v3.1); 54-event catalog as the built-in example `ref-catalog-100k` with per-event applicability (2026-10-12, `docs/MECHANISM_CONTRIBUTIONS.md`).

### v5 status (2026-10-21): report pipeline (plan `PLAN_V5_REPORT_PIPELINE.md`, milestones M1–M3)

| Phase | Status | Evidence |
|---|---|---|
| M1 inputs (T1–T3) | done | `packages/core/src/records/` — `TopologyRecordSchema` + four built-in records (`data/records/{native950,ubl128,cm384,a3server}.json`, optional `schematic` labels), `FaultRateOverride` (`data/fault-rates/remap-per-card-2026-10-09.json`), `MechanismSet` (default `data/mechanism-sets/remap-latest-2026-10.json`); `test/records.test.ts` |
| M2 core (T4–T9) | done | `budget/kpiForm.ts`, `mttr/decompose.ts`, `layers/{index,shapley}.ts`, `strategy/{requirement,window}.ts`, `study/{prune,hierarchy,archStudy}.ts`, `budget/{index,bom}.ts`; `test/budget_v5.test.ts` reproduces `results.json` / `bom.json` / `mechanisms.json`; goldens G1–G6 (`test/golden/golden_v5.json`, Python, independent verifier) |
| M3 reports + CLI (T10–T12) | done | `packages/reports` (kit + Findings / Methodology / BOM recipes, byte-identical reproduction `test/reproduce.test.mjs`, `topoGeomFromRecord`, footer provenance); CLI `hacd findings | bom | budget | methodology | prune | study --record | records | schema --record|--mechanisms|--rates` (`packages/cli/src/pipeline.ts`); a new record `data/records/a960e.json` (Atlas 960E, template `a960e-ub`) yields a Findings report without code change; docs `MODEL_REFERENCE.md` §25, `USER_GUIDE.md` "v5 CLI", manual §16.1 |
| M4 web page (T13) | deferred | a "报告 / Reports" page running `hierarchicalBudget` in the worker — optional, not started |
| M5 agent module (T14) | deferred | `packages/agent` (extract / author / narrate, three provider adapters) — optional, separate decision, not started |

Closed on 2026-10-21 (v5 final, version 0.5.0): the BOM recipe is generic over the records in its data (families, architectures, variants, assumptions and page split follow the data; `hacd bom --records native950,ubl128,cm384,a3server,a960e` renders 20 designs); the Methodology prose is generated by `contentFor(ctx)` from the run (target, scales, record names and pod sizes, mechanism counts, window trials, derating, levers, permutations, decision scale, threshold, engine version), and formula (4) states k as the engine's root with the closed form as the first-order check; the six `docs/*.html` were regenerated by the CLI (footer: command, record / set / override ids, engine 0.5.0; sidecars incl. `provenance.json` / `bom-provenance.json` in `docs/backup/ascend-allocation`, which `packages/reports/test/reproduce.test.mjs` re-pins). Parameter reconciliation (CLAUDE.md's max-effort pass): `docs/markdown/V5_PARAMETER_RECONCILIATION.md` — the ReMAP extension parameters, the recovery baseline and the 54 per-card rates confirmed against ReMAP f53ab7e / the audited catalog (no value changed); topology-record provenance re-tagged (podSwitchRadix, cpusPerNode, transceiversPerLink derived; scale-out designs assumed; a3server UB domain derived), assumptions bilingual, the mechanism set and the override carry a `provenance` / `catalog` block. Still open: M4 web page, M5 agent module.

### v5.3 (2026-10-22): pages and reports in one 口径

User questions: what nominal and derated availability mean and whether one can be kept; whether each calculation page is consistent with the output report; make the report / pages more concise. Decisions: keep both nominal and derated (definitions added where they appear); remove nothing yet (the user decides on the regenerated reports); align the pages with the report's calculation.
- Nominal = each applied mechanism's parameters as the library states them (vendor / paper targets, assumed); derated = the same design with every applied mechanism's parameters and the recovery levers worsened by coverage −5 pt, success −8 pt, times ×1.5, rate reductions ×0.5 (`DERATE_DEFAULT`). The target must hold for both and the derated value decides; P(window) is computed on nominal parameters (stated in the Findings 口径 note). Definition added to Findings Table 1's note, the manual (§3.1, §17) and the web (strategy tables).
- Consistency check (engine agrees with itself: record + set reproduces `results.json` exactly): the web Atlas 950 template differed from the native950 record in the scale-out design (2 ports / 2 planes / radix 128 vs 4 / 4 / 1024 → FIT/NPU 3091.1 vs 3096.8, A_op 96.139 vs 96.146 % at 500k); the KPI strip's MTBI (1/λ_job incl. isolation) and mean pause (all events) differed from the report's MTBF_hw / MTTR_hw (hard classes, formula 1); the Allocation page's optimal plan used the library's candidates and efforts, the min-effort split and no window rule, so it differed from the report's (500k native950: D-HARD + R-NETFAIL + levers, effort 16.0, vs D-HARD + D-RECOVERY-CLASSIFY + R-LINK-LOCAL + H-CONTROL-CONTINUITY + levers, k 0.863, effort 24.5); Findings Table 7 repeats Methodology Table 2's 500k Shapley column; the Review HTML export was a third 口径.
- Fixes: `RECORD_EXAMPLES` (Atlas 950 example = native950 record; `topology-ubl128`, `topology-a3server` added); KPI strip in formula (1) with the old values kept in the notes; Allocation › Strategies **Report settings** preset and **Report budget (window rule)** card (`hierarchicalBudget` in the worker); export key figures aligned; `hacd findings --data <dir>` render-only; dead planner / study strings removed. 2026-10-25: the Cross-scale tab (same form as Strategies, only the output differed: one summary row per size) merged into the Strategies tab as the across-sizes card; `AllocationTab` = strategies | classic, a stored 'cross' normalises to strategies. Findings pages trimmed on the user's decisions of 2026-10-25 (report recipes only, re-rendered with `hacd findings --data`, reproduce six OK): Table 2b (layer budgets at the other sizes) and Table 6 (window-rule internals) removed; Table 7 and Methodology Table 2 merged into one table, Findings Table 6 (the mechanism set grouped by verdict with deployment layer, layers acted on, quantity changed, effort, reason, A_op Shapley per scale with the in-design boxes, goodput Shapley at 500k, and an all-on A_op row), the Methodology keeps §4 text, Figure 2 and the outcome with a pointer and its capabilities table becomes Table 2; the subtitle is the goal and key points (geometry and assumptions in Table 3's note), the callout is one conclusion (the MTBF / MTTR requirement) with the former gap / layer / hardware sentences in the notes of Tables 1–3 and the plan bullet dropped as a duplicate of Table 1; the note under every table (Findings Tables 1–6, Methodology Table 1) is one 口径 sentence (the geometry assumptions and counts are referred to ASCEND_BOM_100K, the FIT-tag legend stays conditional); screen fonts one size larger (print sizes unchanged). Kept on the user's decision: Table 4's attribution columns and Methodology §6. Reliability tab tables simplified the same day: the models table shows A_op and the headline model with the other three models collapsed, the chain table goes from 13 to 6 columns (the rungs with a non-zero share in one "ends at" cell, the applicable fractions as the class name's tooltip), the scale table keeps one goodput column (the headline model per row).

### v5.2 (2026-10-22): pages merged, 12 → 8

Review of every page ("what are the pages used for and can some be merged") and the user's decision "merge the pages". One place per function:
- **Projects** page: tabs 列表 / 新建 / 导入 / 对比 — the Import page (JSON, reset, the Excel flow with method report, column roles, topology draft, reconciliation, xlsx export) and the Compare page's picker and KPI table moved here.
- **Review** page (new, 评审 / Review, main nav after 故障库): tabs 评审清单 (the former Report page: checklist with the exports, original vs compensated, RBD, importance, cut sets, assumptions, warnings), 仿真校核 (the former Simulate page), 敏感性 (the tornado of the former Compare page). The deferred M4 web Reports page of the v5 budget belongs here when it is built.
- **Inference & spares** page (推理与备件): the Inference and Spares pages as two sections of one page behind All pages.
- **Fault library**: the unit fault-type catalog card removed (the Topology page's Hardware tab shows the table once, with the scenario's values and overrides); the page is the parameter library with a link to the Hardware tab.
- **Scenario editor**: the RBD card removed (Review › Checklist shows it); the JSON section stays because it is an editing surface.
- Kept apart on purpose: Allocation and Mechanism library (allocation answers what to adopt for a target; attribution answers what each mechanism contributed).
Implementation: `ProjectSettings.projects.tab` and `review.tab`; `Page` union and `PAGES` / `MINIMAL_HIDDEN` (`scenario`, `inference`) in `App.tsx`; panels `ImportPanel`, `CompareTable`, `ChecklistPanel`, `SimulatePanel`, `TornadoPanel`; pages `ReviewPage`, `InferencePage` (both sections); `ComparePage`, `SimulatePage`, `ReportPage`, `ImportPage`, `SparesPage` deleted; `scripts/screenshots.mjs` and `scripts/manual-images.py` follow the new tabs (shots review / simulate / sensitivity / compare / import / inference); manual §8–§17 renumbered (Fault library, Review, Import & compare, Inference & spares, then the reference sections), USER_GUIDE "Pages merged (v5.2)".

### v6 (2026-10-22): input migration pipeline (plan `PLAN_V6_INPUT_MIGRATION.md`)

Decisions (user, 2026-10-22): the pipeline direction rather than a Skill for the migration itself; Markdown worksheets as the human- and model-facing format with the JSON records as the contract; internal records under their own ids beside the public ones. Assumptions for the open points: generic layouts with synthetic samples, an OpenAI-compatible endpoint with constrained JSON and a fenced fallback, mechanisms as parameter updates plus proposals (no new transforms).

| Part | Status | Evidence |
|---|---|---|
| core `src/ingest/` | done | `fields.ts` (vocabularies and field paths generated from the schemas), `evidence.ts` (cards, grounding, two-pass agreement, number parsing), `koujing.ts` (device table + 口径 mapping → override; conversions FIT / per 10⁶ h / per h / MTBF h / AFR; confidence policy; derivations), `validate.ts` (vocabulary incl. the parameter keys a mechanism reads, provenance completeness, plausibility ×0.1–×10, structural consistency, id policy), `diff.ts` (field / rate / set changes with provenance, KPI rows before / after, Δ), `extension.ts` (proposal and request schemas, Markdown); `test/ingest_v6.test.ts` (18) with goldens G7a–G7e (`compute_golden_v6.py` → `golden_v6.json`) |
| importers `src/worksheet/` | done | strict Markdown profile `hacd-worksheet-1` (parser + writer), converters for topology / fault-rates / device-fit / koujing-mapping / mechanisms (delta or complete) / mechanism-proposal, templates, spreadsheet device-table importer; `test/worksheet.test.ts` (23): every public record, the default set and the ReMAP override round-trip through a worksheet |
| `packages/agent` | done | adapters (OpenAI-compatible with json_schema / guided_json / fenced, mock, none), chunker, prompts with two variants and closed vocabularies, `extractDocuments` (grounding + agreement, retries, jsonl log), review Markdown, `draftWorksheet`; 30 tests incl. a synthetic end-to-end document → worksheet → record |
| CLI `hacd ingest` | done | `template, fields, worksheet, import-fit, normalize, validate, dry-run, diff, promote, extract`; `HACD_DATA` / `HACD_VERSION` for the bundle; smoke-tested end to end incl. the two refusals (public id, existing id without `--force`) |
| reports `delta.mjs` | done | bilingual review page `deltaHtml` + `deltaMarkdown`; `test/delta.test.mjs`; checked at 1280 and 375 px |
| offline bundle | done | `scripts/bundle-offline.mjs` → `dist/offline/hacd-<version>.tgz` (9 MB unpacked; esbuild bundle, katex beside it, `data/`, launchers, templates, docs); run from an empty folder: records, budget, methodology render, the ingest chain, extract with the built-in mock |
| docs and skill | done | USER_GUIDE "v6 ingest", MODEL_REFERENCE §26, INGEST_RUNBOOK.md (inside-the-network), CLAUDE.md layout, `update-inputs` skill |

Checks: typecheck clean in all six workspaces; `npm test` = core 817 + importers 52 + agent 30 + reports 28; `reproduce.mjs` six OK (the public report set did not move). Finding while building the parameter-key gate: three audited transforms (`C-LOSSLESS`, `R-HCCL-ELASTIC` read `share`; `D-RECOVERY-CLASSIFY` reads `eligibleShare`, `success`) took optional keys they did not declare; `MechanismDef.reads` now declares them and a test keeps every transform's reads declared. Not built: a web page for ingest (CLI only), new mechanism transforms, PDF reading (convert to text first).

### v5.1 (2026-10-22): projects and page order
- Topology page: the "分配 / Allocation" overview tab (the three strategies with default inputs) removed as a duplicate of the Allocation page's strategies tab; the tab bar keeps a "分配 ›" link to it (2026-10-22, "multiple pages have similar functions, keep one").
- Allocation page: the "机制规划 / Mechanism planner" tab and the v3.7 allocation study panel under "跨规模 / Cross-scale" removed (the optimal strategy covers the planner's search with levers and hardware on top; the cross-scale study is the v5 report set of `hacd findings`); `panels/PlannerPanel.tsx`, `panels/StudyPanel.tsx` and the worker's `plan` / `study` methods deleted; the core keeps `planToTarget` / `allocationStudy` (CLI `hacd plan` / `hacd study <scenario>`).

Decisions (user, 2026-10-22):
1. A **project** = the scenario JSON + the page settings, so that reopening a project restores the whole setup. Persisted per project: Allocation — tab, the strategy form (`StrategySettings`, stored `null` until changed and resolved against the scenario's `defaultSettings(s)`), the classic tab's method / goodput and availability targets / restart share / basis / loss method / loss weights, the planner inputs and the cross-scale study inputs; Mechanism library — tab, players, metric, overrides, provisional, efforts and the audit tab's ids / provisional; Topology — tab and "carry"; Compare — the projects compared and the metric (was global `compareIds`). Transient state (results, reports, plans, studies, audits, busy / progress / error) stays local.
2. One place to load and save: the **Projects page** (`项目 / Projects`), the first nav tab, shown in minimal mode too — list with open / rename / duplicate / delete (never the last) / export JSON / reset to template; new project from a template at a built-in scale, import JSON, reset to built-ins. The header shows the current project's name as a button that opens the Projects page (the header `<select>` is gone). Removed: the Topology page's "Scenario file" group (a link to the scenario editor stays), the scenario editor's file buttons, the Mechanism library page's own scenario selector.
3. Saving stays automatic (every edit persists immediately).
4. Navigation: Projects → Topology & hardware → Allocation → Mechanism library → Fault library, then the "All pages" extras. The Mechanisms page is renamed **Mechanism library / 机制库** everywhere it is named.

Implementation: `apps/web/src/state/settings.ts` (`ProjectSettings`, defaults, merge over defaults with unknown keys dropped and enumerations checked), `state/store.ts` (projects under `hacd-projects-v1` `{version: 'hacd-projects-1', activeId, builtIns, projects: [{scenario, settings, modified}]}`; one-time migration of `hacd-scenarios-v1` with the GPU / retired-example / v4.1 Atlas 950 filters, the legacy key removed after the new one is written; built-ins never offered before are appended, deleted ones stay deleted; `useActiveSettings`, `updateActiveSettings`, `renameProject`, `duplicateProject`, `resetProject`, `importProject` / `exportProject` with the bundle `{version: 'hacd-project-1', scenario, settings}`; import also takes a bare scenario), `pages/ProjectsPage.tsx`; the pages and panels read and write their settings through the store. `scripts/screenshots.mjs` adds the `projects` shot first.

