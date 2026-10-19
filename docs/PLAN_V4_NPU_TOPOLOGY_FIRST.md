# HAC-D v4 — NPU, topology-first: topology → hardware → mechanisms → allocation

Status: implemented 2026-10-18 with the decisions **Q1 = built-in parameterised templates, Q2 = fault rates per hardware unit, Q3 = option C (split workbench) with A's template cards, Q4 = GPU removal from the UI and the examples only** (internal field names kept, GPU-measured records kept as tagged analogues, local git tag `v3.7-gpu` at ad75799). Deviations from the proposal: the A2 Clos derives its tier count from the radix (64-port switches need three tiers above 2,048 ports, so the 10k / 20k / 50k rows of §2.4 read 313 + 313 + 157, 625 + 625 + 313 and 1,563 + 1,563 + 782 instead of a two-tier leaf + spine); the A3 / Atlas 950 scale-out RDMA network is included by default (UB analogue FIT, switchable off; without it CloudMatrix384 reproduces the catalog exactly); `fabricFill` defaults to `full-pod` in the schema (v2 compatibility) and `proportional` in the templates. Code: `packages/core/src/topology`, `packages/core/src/strategy`, `apps/web/src/pages/TopologyPage.tsx`, `apps/web/src/panels/*`; goldens `packages/core/test/golden/compute_golden_v4.py`.

v4.1 (2026-10-18, user request): the built-in scales are 10k / 100k / 200k / 500k NPUs (`TOPOLOGY_SCALES`; was 1k / 10k / 20k / 50k — the topology page chips, the bill-of-materials columns, the cross-scale and study defaults, CLI `--sizes`, MCP `topology_bom`), and the example registry is exactly the three topology templates: the scale is a parameter (`resizeTopology`, `hacd example <id> --npus N`, MCP `get_example` with `npus`), the v2 Ascend examples left the registry and the reference baselines became unlisted fixtures (`REFERENCE_FIXTURES`); goldens gained the template counts at 100k / 200k / 500k.

Original status: proposal 2026-10-16, nothing implemented. Inputs: the HAC-D code as of v3.7 (`apps/web/src/pages/*`, `packages/core/src/scenario/{schema,build,examples}.ts`, `mechanisms/index.ts`, `study/index.ts`, `allocation/index.ts`), `docs/ASCEND_SOURCES.md` (104 records with URL and confidence), `docs/ASCEND_CLUSTER_ARCHITECTURE.{zh,en}.html` (Figure 2 = the three topologies attached by the user), the survey note `docs/RELIABILITY_MODELING_TECH_SURVEY.html` (2026-10-15), the v3.8 allocation plan `docs/PLAN_V3_8_ALLOCATION_ARCHITECTURE.md`. Wireframes of the three frontend options: `docs/design/TOPOLOGY_PAGE_OPTIONS.html`. Open decisions are marked **[Q1–Q4]** (§10).

---

## 0. What changes, in one paragraph

HAC-D becomes an NPU tool whose first page answers "for this topology at this scale, which hardware units are there, how many, which fault types do they carry and with which default mechanisms". The user picks one of three typical topologies (A2 8-NPU servers on RoCE, A3 / CloudMatrix384 384-NPU UB supernode, Atlas 950 UB 2.0 SuperPoD), a scale (1k / 10k / 20k / 50k NPUs or any N), and gets a live topology picture, a hardware bill of materials (unit, count, per-NPU ratio, fault classes with FIT, blast radius, provenance) and the headline reliability KPIs. The six ReMAP default mechanisms are on by default and edited on the Mechanisms page as today. The Allocation page then distributes the target over hardware FIT and mechanism parameters under constraints, with three strategies: optimal, MTTR reduction preferred, MTTF reduction preferred. The Training page merges into the first page, the Audit page folds into Mechanisms and Allocation, GPU scenarios leave the UI.

---

## 1. The main flow and where each step lives

| Step | Question | Page (proposed) | Code that already exists |
|---|---|---|---|
| ① Topology | Which architecture, how many NPUs? | 拓扑与硬件 / Topology & hardware (first page) | `SUPERPOD_PRESETS`, `computeCounts`, examples `cloudMatrix384Training`, `atlas950Training`, `ascendSupercluster` |
| ② Hardware | Which units, how many, how they fail (fault-type library) | same page, hardware table | `componentInstances`, count scopes `l1_switch / l2_switch / subplane / optical_link / transceiver / comm_rack / supernode`, catalog domains (`referenceEvents.ts`) |
| ③ Mechanisms | Which fault-management mechanisms, with which parameters | 机制 / Mechanisms (default = ReMAP six) | `MECHANISM_LIBRARY`, `DEFAULT_PLAYERS`, chain, attribution, audit |
| ④ Evaluate | A_op, delivered goodput, MTBI, R̄, ledger | first page, KPI strip + details | `evaluateScenario`, ledger, SDC model |
| ⑤ Constraints | FIT floors per unit type, parameter limits per mechanism | 分配 / Allocation | `component.allocation.*`, `derateParameters`, `PRIMARY` map of `scripts/agree-allocation-98p5.ts` |
| ⑥ Allocation | Optimal / MTTR-preferred / MTTF-preferred split | 分配 / Allocation | `planToTarget`, `allocationStudy` (`rateFactorFor`, `recoveryFactorFor`), AGREE water-filling, iso-target curve of `scripts/hardware-mechanism-split-98p5.ts` |

---

## 2. The topology → hardware function

### 2.1 Interpretation of "convert a picture to hardware with numbers"

Proposed **[Q1]**: the "picture" is one of three built-in, parameterised topology templates drawn live (the three panels of Figure 2), not recognition of an uploaded image. Each template is a small model whose parameters reproduce the drawing; the function turns template + N into a hardware bill of materials and a scenario. Image upload (vision or OCR → template parameters) would be a later, separate adapter on the same interface (the importer IR of `packages/importers` is the plug-in point already reserved for it, see `PLAN_V2_AVAILABILITY_ENHANCEMENTS.md` §4).

### 2.2 Interface

```ts
type TopologyTemplate = 'a2-roce' | 'a3-ub384' | 'a950-ub2';
interface TopologyParams { npusPerNode: number; cpusPerNode: number; nodesPerCabinet: number; /* template-specific */ … }
interface BomRow { unit: string; scope: 'npu' | 'node' | 'cabinet' | 'comm_cabinet' | 'superpod' | 'link' | 'switch' | 'cluster';
  count: number; perNpu: number; faultDomains: string[]; fitPerUnit?: number; blastRadiusNpus: number; confidence: 'paper' | 'vendor' | 'derived' | 'assumed' }
function topologyBom(t: TopologyTemplate, npus: number, opts?: { fabricFill?: 'proportional' | 'full-pod'; params?: Partial<TopologyParams> }): { rows: BomRow[]; scenario: Scenario; picture: SvgSpec; notes: string[] }
```

`scenario` is a normal HAC-D scenario (topology + components with count rules), so every downstream page and the CLI / MCP work unchanged. `picture` drives the live drawing.

### 2.3 The three templates

| Template | Scale-up domain | Unit types (count rule) | Source of the geometry |
|---|---|---|---|
| **A2 · 8-NPU server + RoCE** (`a2-roce`) | 8 NPUs (one server, HCCS) | NPU (per NPU) · server: 4 CPU, DDR, SSD, BMC (per server) · 200GE RoCE port, one per NPU · leaf / spine switches of a two-tier non-blocking Clos · cabinet (8 servers, 4+4 power feeds, liquid cooling) | 8 × 200GE direct RoCE ports and 4 × Kunpeng 920 per server (Atlas 800T A2 product page, vendor); Atlas 900 A2 PoD basic unit = one 47U liquid-cooled cabinet with 32 × Kunpeng 920, 8 AC feeds 4+4, 50.5 kW max (vendor page) → 8 servers = 64 NPUs per cabinet (derived); HCCS 392 GB/s per 910B = 7 × 56 GB/s, consistent with direct links to the other 7 NPUs (hardware blog, scan-level); leaf / spine radix and oversubscription are editable assumptions (default radix 64, non-blocking) — no public source |
| **A3 · CloudMatrix384** (`a3-ub384`) | 384 NPUs | NPU · node (8 NPU, 4 CPU, 7 UB L1 chips on board, Qingtian card) · UB L2 chips (7 sub-planes × 16) · L1–L2 optical links (112 per node) · compute cabinets (4 nodes) · communication cabinets (4 per pod) · RDMA ports (one per die) · scale-out leaf / spine | arXiv 2506.12708 §3.3 (paper) as in `SUPERPOD_PRESETS.cloudmatrix384`; scale-out switch counts assumed |
| **Atlas 950 · UB 2.0 SuperPoD** (`a950-ub2`) | 8,192 NPUs | as A3, 64 NPUs per compute cabinet, 128 + 32 cabinets per pod; all-optical between cabinets; scale-out RoCE or UBoE | vendor totals (HC2025 keynote, MWC 2026); internal fabric radix assumed from CloudMatrix384 (`SUPERPOD_PRESETS.atlas950.assumed`) |

### 2.4 What the engine gives today at 1k / 10k / 20k / 50k NPUs (`computeCounts`, hot spares 0)

| NPUs | A2: servers · cabinets* · CPUs · 200GE ports · leaf + spine** | A3 / CM384: pods · nodes · compute + comm. cabinets · L1 · L2 · links | Atlas 950: pods · compute + comm. cabinets · L1 · L2 · links |
|---|---|---|---|
| 1,000 | 125 · 16 · 500 · 1,000 · 32 + 16 | 3 · 125 · 32 + 12 · 875 · 336 · 14,000 | 1 · 16 + 32 · 875 · **2,394** · 14,000 |
| 10,000 | 1,250 · 157 · 5,000 · 10,000 · 313 + 157 | 27 · 1,250 · 313 + 108 · 8,750 · 3,024 · 140,000 | 2 · 157 + 64 · 8,750 · 4,788 · 140,000 |
| 20,000 | 2,500 · 313 · 10,000 · 20,000 · 625 + 313 | 53 · 2,500 · 625 + 212 · 17,500 · 5,936 · 280,000 | 3 · 313 + 96 · 17,500 · 7,182 · 280,000 |
| 50,000 | 6,250 · 782 · 25,000 · 50,000 · 1,563 + 782 | 131 · 6,250 · 1,563 + 524 · 43,750 · 14,672 · 700,000 | 7 · 782 + 224 · 43,750 · 16,758 · 700,000 |

\* 8 servers per cabinet (Atlas 900 A2 PoD, derived). \*\* Assumed two-tier non-blocking Clos with 64-port switches (32 down, 32 up per leaf); not in `computeCounts` yet.

Two defects for the new feature: (1) **partially filled SuperPoDs count a full L2 tier and all communication cabinets** — 1,000 NPUs on the Atlas 950 template get 2,394 L2 chips and 32 communication cabinets for 125 nodes, while the L1–L2 link count (14,000) follows the populated nodes, so links and L2 ports disagree; proposed default `fabricFill: 'proportional'` (L2 chips per sub-plane = ⌈populated nodes × links per L1 ÷ L2 ports⌉, communication cabinets scaled the same way) with a `full-pod` switch for "the whole SuperPoD is bought"; (2) the A2 template has no switch counts in any source, so the leaf / spine radix and oversubscription are editable assumptions tagged `assumed`; its cabinet count follows the Atlas 900 A2 PoD unit (derived).

### 2.5 Fault types on the hardware (the essential modelling change) **[Q2]**

Today the 54-event reference catalog states every class **per card-hour**, so the job interruption rate does not depend on the topology: switching from A2 to A3 changes the displayed counts but not λ. For the main purpose ("based on different topology, get numbers of hardware with the fault-type library") the rate must attach to the **hardware unit**: λ_job = Σ_units count × FIT_unit × P(job interrupted | unit event). Proposed:

- The fault-type library stores FIT **per device** (per L1–L2 link, per UB chip, per cabinet, per server …) with the catalog domain it belongs to and its 口径.
- Defaults are converted from the catalog under the CloudMatrix384 geometry, where the catalog and the geometry agree: OPT 66.7 FIT per card ≈ 4.8 FIT per L1–L2 link, FABRIC 66.7 ≈ 57 FIT per UB chip, POWER 166.7 ≈ 5,333 FIT per 32-card compute cabinet, BOXIO 46.7 ≈ 373 FIT per node, CPU 166.7 ≈ 333 FIT per CPU (`docs/ascend-architecture/counts.json`, derived). On CloudMatrix384 the new model reproduces today's numbers exactly; on A2 and Atlas 950 the rates change with the hardware mix, which is the point.
- Mapping of the 18 catalog domains to units: CORE, SRAM, IOD, MEMT, MEMP → NPU; MODULE → NPU module; CPU, DDR, SSD, MGMT, BOXIO → node / chassis; NIC → NPU network port; OPT → optical links; FABRIC → UB L1 / L2 chips (A2: leaf / spine); POWER, COOL → cabinets; STORAGE, UNKNOWN → cluster.

---

## 3. Pages after the change

| Proposed page | Content | From today's pages |
|---|---|---|
| ① 拓扑与硬件 / Topology & hardware (first page) | template, scale, live picture, hardware table, fault types per unit, default mechanisms (read-only chips, link to ②), KPI strip, evaluation details (collapsed) | Scenario (topology, superpod, workload, components editor, JSON) + **Training** (all of it, as "evaluation details") |
| ② 机制 / Mechanisms | selection (default ReMAP six), parameters, chain order, attribution (single, last-added, Shapley), single-point audit (tab) | Mechanisms + Audit's audit half + Scenario's SDC / chain editors |
| ③ 分配 / Allocation | target and 口径, constraints (FIT floors, parameter limits), strategy (optimal / MTTR-preferred / MTTF-preferred), result tables, cross-scale study (tab, 1k–50k), verification | Allocation + Audit's study half + Mechanisms' "plan to target" |
| ④ 故障库 / Fault library | fault types × hardware units, FIT with provenance and confidence | Library (filtered to NPU-relevant records, GPU analogues tagged) |
| Advanced (behind "All pages") | Import (Excel), Simulate (ledger MC), Report, Compare, Spares, Inference | unchanged |

**Can the first page and the Training page be merged?** Yes. The Training page only displays the evaluation of the active scenario (KPIs, loss decomposition, recovery stages, ledger, silent-corruption card, chain, sub-health, scale and interval curves, component shares); the first page already shows the same headline KPIs. After the merge the KPI strip sits under the hardware table and the rest goes into a collapsed "evaluation details" section (or a tab, depending on the frontend option). Nothing is computed twice.

**Can the Audit page be removed?** Yes, as a page. Its two halves are duplicates or belong elsewhere: the single-point audit of the 16 mechanisms becomes a tab of Mechanisms; the cross-scale allocation study (sizes, target, planner, Shapley, levers, verification, HTML report) becomes the cross-scale tab of Allocation, where the 1k / 10k / 20k / 50k sizes match the new scale chips. `hacd audit`, `hacd study`, MCP `audit_mechanisms` and `allocation_study` stay.

---

## 4. Three frontend options for the first page (wireframes: `docs/design/TOPOLOGY_PAGE_OPTIONS.html`)

| | **A · Picture-first canvas** | **B · Guided stepper** | **C · Split workbench** |
|---|---|---|---|
| Layout | three topology cards on top, scale chips, large live picture (left 60 %) with the hardware table beside it (right 40 %), KPI strip and default-mechanism chips below, evaluation details collapsed at the bottom | left vertical stepper ① topology ② hardware ③ fault types ④ mechanisms ⑤ allocation ⑥ results; one panel per step; running KPI bar on top | left input pane with collapsible groups (template and scale, hardware parameters, fault library, mechanisms, workload and checkpoint); right output pane with tabs: picture · hardware table · reliability (former Training) · allocation |
| Merges | Scenario + Training | Scenario + Training + Mechanisms + Allocation (one guided page; the other pages stay for experts) | Scenario + Training; Allocation reachable as a tab |
| Best for | showing and comparing architectures; reviews with non-specialists | a fixed workflow, newcomers, demos | daily use by the modeller; every edit recomputes in place |
| Phone (375 px) | cards and table stack; the picture scrolls sideways | steps become an accordion | panes stack, tabs stay |
| Effort | medium: three parameterised SVG generators + table | high: new navigation model, state per step | lowest: reuses today's editors and Training cards |
| Risk | detailed editing (components, recovery) moves below the fold | experts must click through steps | dense; the picture is one tab among four |

Recommendation: **C** for the working tool (lowest risk, nothing lost, the picture and the hardware table are one click away), with A's three topology cards as the template selector at the top of the input pane. **[Q3]**

---

## 5. Duplicate information across today's 12 pages

| # | Duplicated item | Where it appears | Resolution |
|---|---|---|---|
| D1 | Effective goodput, A_op, MTBI, recovery R̄ | Scenario KPI row; Training KPIs | one KPI strip on the merged first page |
| D2 | "Scenario for" selector (active vs default catalog) and the provisional-assumptions switch | Mechanisms; Audit | one selector on Mechanisms |
| D3 | Mechanism selection toggles | Mechanisms (35 entries); Audit (16 audited) | one list on Mechanisms, default ReMAP six, audited entries tagged |
| D4 | Planner (cheapest feasible set, derating, verification) | Mechanisms "plan to target"; Audit study (exact ≤ 10 / greedy) | one planner on Allocation (strategy selector) |
| D5 | Shapley attribution | Mechanisms (exact ≤ 12); Audit study heatmap (sampled beyond 12) | Mechanisms only; the study links to it |
| D6 | Hardware-only and recovery-only budgets | Allocation (first-order goodput budget, ARINC rate table, stage table); Audit study (bisection on the engine, ARINC, Albert, stage budgets) | Allocation only, computed by bisection on the engine (the first-order form shown as a check) |
| D7 | Recovery stage budget | Allocation stage table; Audit 60 / 60 / 60 KPI; Scenario recovery editor | edit on the first page (recovery group), budget on Allocation |
| D8 | Silent-corruption detection coverage | Scenario SDC editor (direct value); D-SDC mechanism (applies 0.95); Training SDC card; Allocation q* / D* | one owner: the mechanism (D-SDC) sets it, the first page shows it read-only; today a manual edit and an applied mechanism can disagree |
| D9 | Mechanism chain order and rung parameters | Scenario chain editor; Mechanisms library parameters; Training chain card | edit on Mechanisms, display on the first page |
| D10 | Per-class failure rates (FIT) | Scenario components editor; Library; Training component shares; Allocation rate table; Audit study domain table | one hardware / fault-type table on the first page; Allocation shows allowed vs current |
| D11 | Window-ledger verification (Monte Carlo) | Mechanisms plan verify; Audit study verification; Simulate page | one "verify" action on Allocation; Simulate stays as the advanced page |
| D12 | Original vs compensated availability, MTBF, MTTR | Scenario KPI row; Report measures | Report keeps them for export only |
| D13 | Metric versus scale curves | Training scale chart (goodput vs N); Audit study curves (A_op vs N with max N) | one curve on the first page driven by the scale chips; the study curves move to Allocation's cross-scale tab |

---

## 6. Removing GPU information **[Q4]**

Scope found in the code: 366 GPU-named identifiers or strings in core, web, CLI and MCP (most in `scenario/examples.ts` 63, `scenario/build.ts` 40, `i18n/strings.ts` 37, `ScenarioPage.tsx` 30, `evaluate.ts` 23, `cost` 18, `allocation` 15), plus 46 GPU strings in the i18n file. Examples: `survey-ex1 / ex3 / ex4` (H100 worked examples), `nvl72-16k` (NVIDIA), `ref-baseline-100k` (four-source shares from Llama 3 H100 data) are GPU scenarios; `ref-three-classes-100k`, `ref-catalog-100k` (Ascend terminology), `ascend-cm384`, `ascend-atlas950`, `ascend-supercluster-100k` stay.

Caveat: the parameter library has 635 records, 355 of them mention GPU hardware, and **19 of the 47 failure-rate records are GPU fleets**. No public Ascend failure data exists (`ASCEND_SOURCES.md` §4): the NPU example rate itself is the Llama 3 H100 rate × the GPU-class share. Removing every GPU record would leave the NPU tool without rate evidence. Proposed: keep GPU-measured records as **analogues** (tagged "GPU analogue", shown only where they back an NPU parameter), remove GPU scenarios, labels and examples from the UI.

Proposed implementation order: (1) tag the current commit as the GPU baseline (`v3.7-gpu`) so the GPU tool can be forked from it; (2) UI and examples: relabel GPU → NPU, NVLink domain → scale-up domain, remove the five GPU examples, hide GPU cost wording ($/GPU·h → $/NPU·h); (3) core: keep field names (`nGpus`, `gpusPerNode`, count rule `gpu`) as internal names with NPU aliases in the schema so goldens, CLI, MCP, the ReMAP bridge and saved scenarios keep working; a full rename is possible later with a schema migration.

---

## 7. Default mechanisms

The default set is `DEFAULT_PLAYERS` = **D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST**, the six-mechanism combination of the reference catalog (ReMAP's defaults; 83 % delivered goodput at 500k in the reference runs, survey note §2). The first page shows them as chips with their key parameters; editing stays on the Mechanisms page as today (selection, parameters, order, attribution). D-HARD and D-SLOW remain available but off by default.

---

## 8. Allocation strategies

All three solve the same problem: reach the target (A_op or delivered goodput, 30-day window) nominally and derated, optionally with P(window ≥ target) ≥ 90 %, under constraints — per-unit FIT floors (best known or user-set), per-mechanism parameter limits (e.g. detection ≥ 1 s, success ≤ 99.9 %, automatic attempt ≥ 60 s), allowed mechanism set.

| Strategy | Rule | Output |
|---|---|---|
| **Optimal** | minimise total effort (or cost when cost curves exist) over mechanism set, mechanism parameters and per-unit FIT factors jointly | the point on the iso-target curve with the lowest effort; Pareto front |
| **MTTR reduction preferred** | push recovery first: add mechanisms and move their recovery parameters to their limits in order of gain per effort; only the remaining gap goes to hardware FIT (AGREE water-filling over unit types) | the MTTR-side end of the iso-target curve; the hardware task that remains, often zero below ~200k NPUs |
| **MTTF reduction preferred** | push hardware first: lower FIT towards the floors (AGREE over unit types), add mechanisms only for the remaining gap | the MTTF-side end; which unit types hit their floor |

Existing building blocks: iso-target curve f(g) and budget ledger (`scripts/hardware-mechanism-split-98p5.ts`), bisection factors (`rateFactorFor`, `recoveryFactorFor` in `study/index.ts`), planner (`planToTarget`), AGREE availability allocation with reallocation (`scripts/agree-allocation-98p5.ts`). With per-unit FIT (§2.5) the AGREE weights become the unit counts × blast radius of the chosen topology, which is WP1 of the v3.8 plan.

---

## 9. Work packages

| WP | Content | Depends on |
|---|---|---|
| P1 | `topologyBom` with the three templates, fabric fill rule, per-unit fault types (§2), goldens for the counts at 1k / 10k / 20k / 50k | — |
| P2 | first page per the chosen option (§4), Training merged, scale chips, live picture | P1, **[Q3]** |
| P3 | Mechanisms: default six, audit tab, single owner of SDC and chain settings (D8, D9) | — |
| P4 | Allocation: constraints, three strategies, cross-scale tab (from Audit), single planner and verification (D4, D6, D11) | P1 |
| P5 | GPU removal per **[Q4]**: tag, UI / examples, analogue tagging in the library | — |
| P6 | Duplicates D1–D13, nav (remove Training and Audit), i18n, manual, screenshots 1280 / 375 light / dark, goldens and tests | P2–P5 |

---

## 10. Open questions

- **[Q1]** "Picture → hardware": built-in parameterised templates (recommended) or recognition of uploaded images?
- **[Q2]** Fault rates per hardware unit, so that the topology changes λ (recommended), or keep the per-card catalog and use the topology for counts only?
- **[Q3]** Frontend option A, B or C (recommended C with A's topology cards)?
- **[Q4]** GPU removal depth: UI and examples only with GPU field data kept as tagged analogues (recommended), a full rename including schema / CLI / MCP, or fork first and strip everything?
