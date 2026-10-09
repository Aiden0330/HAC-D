# HAC-D v2 — availability-model enhancements (Ascend topology, dual-path MTTR, sub-health, original vs compensated, switchover, Excel import)

Status: proposal, 2026-10-09. Builds on `DEVELOPMENT_PLAN.md` (v1 complete, 242 tests). Decision points are marked **[Q]** and listed in §8.

## 1. Requests and how they map

| # | Request | Model / feature | Section |
|---|---------|-----------------|---------|
| 1 | Enhance the RBD model for system availability | Blocks gain dual-path repair, switchover, sub-health; every block reports original and compensated measures | §2.1–2.4 |
| 2 | Ascend cluster availability; adjust topology from public info (CloudMatrix 384) | `superpod` topology kind with a CloudMatrix384 preset built from the Huawei paper; parametrised generator for Atlas 950 / 960 | §3 |
| 3 | MTTR automatic vs manual treated differently | Two repair paths with coverage and success rate; recovery ladder (MindCluster rungs) replaces the single pipeline where wanted | §2.1 |
| 4 | Performance degradation and sub-health probability | Three-state units (up / sub-health / down) with performance factor; strict, tolerant and performance-weighted availability; tolerate-vs-isolate policy; straggler law for synchronous jobs | §2.3 |
| 5 | Original and compensated reliability measures | Every block and the system report 原始 (inherent) and 补偿后 (after fault tolerance) A, MTBF, MTTR, plus a mechanism-by-mechanism waterfall | §2.4 |
| 6 | Switchover success rate | `switchover {successProbability, timeS, failureRecoveryHours}` on parallel, k-of-n and standby groups; exact CTMC for identical units | §2.2 |
| 7 | Load Excel, extract the availability method used and the topology (pictures later) | `packages/importers`: SheetJS workbook reader → formula fingerprinting → `TopologyDraft` IR → mapping UI → scenario; reconciliation table Excel vs HAC-D; the IR is the plug-in point for a future image adapter | §4 |

## 2. Model enhancements (packages/core)

### 2.1 Dual-path repair: automatic vs manual (自动恢复 / 人工修复)

Per component (and overridable per block):

```
repair: {
  auto:   { coverage: 0.9, successProbability: 0.95, mttrHours: 0.1 },   // detected & handled by automation
  manual: { mttrHours: 6 },                                               // human-in-the-loop path
  // legacy `mttrHours` still accepted = manual only
}
```

- A failure takes the automatic path with probability `coverage`; the automatic attempt succeeds with `successProbability`, otherwise it escalates to the manual path after spending the automatic time.
- Effective mean repair time `E[R] = c·s·T_a + c·(1−s)·(T_a + T_m) + (1−c)·T_m`.
- For independent units in series the alternating-renewal result makes availability depend only on `E[R]`, so the closed form `U = Σ λ_i·E[R_i]` stays exact. Inside redundant groups the repair-time distribution matters, so the CTMC splits the down state into `down_auto` and `down_manual` (exact for the hyperexponential mixture); k-of-n with identical units becomes a 2-D chain over (failed-in-auto, failed-in-manual), size (n+1)(n+2)/2.
- Reported per block: `E[R]`, downtime share by path (automatic vs manual), fraction of events that reached a human, and the sensitivity of A to coverage (dA/dc).
- **Recovery ladder** (generalises the v1 six-stage pipeline): ordered rungs `{name, kind: auto|manual, successProbability, time}`; `P(reach rung i) = Π_{j<i}(1−s_j)`, `E[T] = Σ P(reach i)·t_i`. The last rung is manual with success 1. Preset `mindcluster-a3` from the MindCluster 7.3 fault-handling ladder: operator-level online recovery (HCCL retransmission; processor-network and UnifiedBus faults) → process-level online recovery (on-chip memory and network faults; peers resend the checkpoint over the parameter plane) → process-level rescheduling (recover / recover-in-place; needs spare servers) → pod-level → job-level rescheduling (default; all pods stop; rank-0 failures jump here) → elastic scale-in (no spare) → manual repair. Rung times are not published by Huawei; the preset ships with `assumed` values and the UI shows the tag.

### 2.2 Switchover success rate (倒换成功率)

```
redundancy: { scheme: 'kofn', n: 2, k: 1, switchover: { successProbability: 0.98, timeS: 30, failureRecoveryHours: 2 } }
```

- On an active-unit failure the group survives with probability `c` after an outage of `timeS` (counted as downtime, reported separately as "switchover micro-outage share"); with probability `1−c` the group is down until `failureRecoveryHours` (manual) completes, after which the failed unit is in repair as usual. This is the v1 `standby` chain generalised to `parallel` and `kofn`.
- Exact CTMC for identical units (states: failed count × switch-down flag); first-order formula for heterogeneous `parallel` groups with a validity flag: `U ≈ U_perfect + Σ λ_i(1−c)·T_fail + Σ λ_i·c·t_sw`.
- UnifiedBus 2.0 marketing cites optical-path detection and switchover of ~100 ns; the preset uses `c = 1, t_sw ≈ 0` for UB link-level protection and user-set `c` for node/replica failover.

### 2.3 Sub-health and performance degradation (亚健康、性能劣化)

Huawei Cloud's reliability lab defines sub-health as hardware or a system in an abnormal state that has not yet caused an obvious fault; MindCluster's slow-node diagnosis flags a node as `SubHealthFault` when training metrics drop by `degradationPercentage` (default 0.3) for `nConsecAnomaliesSignifySlow` (3) consecutive 30 s checks, and recommends isolating it via switchover.

```
subhealth: {
  ratePerHour: 2e-4,        // or steadyStateProbability: 0.01 (converted with the mean duration)
  durationHours: 4,         // mean time in sub-health until recovery or escalation
  performance: 0.7,         // delivered performance while sub-healthy (φ)
  escalationMultiplier: 3,  // failure-rate multiplier while sub-healthy (fail-slow → fail-stop)
  policy: 'tolerate' | 'isolate',   // run slow, or treat as a failure once detected
  detection: { probability: 0.9, delayHours: 0.05 }   // only for 'isolate'
}
```

- Unit model: four-state CTMC up → sub-health (λ_sh) → up (1/D) | down (λ·m) ; up → down (λ); down → up via §2.1 paths. `steadyStateProbability` input is converted: `λ_sh = p_sh / ((1−p_sh)·D)` (flagged if escalation is large).
- Three availability measures per block and for the system: **strict** (sub-health counts as down), **tolerant** (counts as up), **performance-weighted** (performability, capacity φ in sub-health). A **threshold rule** `φ_min` (default 0.7 = MindCluster's 30 % drop) decides which sub-health states count as outages in the strict measure.
- Synchronous jobs follow the straggler law: one slow unit slows the whole step, so `P(job slowed) = 1 − (1−p_sh)^N` and the job's performance factor is `φ` when any unit is sub-healthy; with `policy: 'isolate'` detected sub-health becomes an interruption handled by the recovery ladder (needs a spare), undetected sub-health keeps slowing the job. The Training page compares both policies (goodput, interruptions/day, spare demand).
- Fabric degradation: loss of one of P planes (CloudMatrix: 7 UB sub-planes) multiplies step time by `1 + f_comm·(P/(P−1) − 1)` where `f_comm` is the communication share of the step; this yields the performance factor of plane-level sub-health instead of treating a plane loss as a failure.

### 2.4 Original and compensated measures (原始 / 补偿后)

**[Q2]** Proposed definitions: **original** = inherent hardware behaviour, every unit fault is a service failure, repair is the manual path, no redundancy, switchover or automation credit, sub-health counted by the strict rule; **compensated** = after all fault-tolerance mechanisms (redundancy, switchover success, automatic recovery, sub-health tolerance/isolation, checkpoint or replica recovery for the workload). Both are reported for every block: A, U, MTBF, equivalent MTTR, failure frequency, plus `compensation gain` (ΔA, MTBF ratio, MTTR ratio). A waterfall attributes the gain mechanism by mechanism (original → +redundancy → +switchover → +automatic recovery → +sub-health policy → compensated), computed by enabling mechanisms in that order; an optional Shapley average removes the order dependence.

### 2.5 Schema and API changes

- `ComponentSchema.repair` gains `auto`/`manual`; `redundancy` and custom blocks gain `switchover`; new `subhealth` (the v1 `failslow` field stays as an alias); `recovery` accepts `{mode: 'ladder', rungs}`.
- `TopologySchema` gains `kind: 'generic' | 'superpod'` with the superpod parameters of §3.2; `DomainSchema` gains `ub_subplane`, `l2_switch`, `l1_switch`, `optical_link`, `cabinet`.
- `BlockResult` gains `measures: { original, compensated }`, `subhealth: { strict, tolerant, performability, piSubhealth }`, `repairSplit`, `switchover` sub-results; `EvaluationResult` gains `waterfall`.
- New CTMC builders: `dualRepairUnit`, `kOfNDualRepair`, `kOfNWithSwitchover`, `subhealthUnit`; new `recovery/ladder.ts`.
- CLI: `eval --measures`, `ladder`, `import-excel`, `methods`; MCP: `import_excel_scenario`, `excel_method_report`, `ascend_preset`.

## 3. Ascend / CloudMatrix384 topology

### 3.1 Public facts used (sources recorded in `library.json` with confidence tags)

| Fact | Value | Source / confidence |
|------|-------|---------------------|
| Supernode racks | 16 = 12 compute + 4 communication | Huawei CloudMatrix384 paper (arXiv 2506.12708 v3) §3.3.3, paper-reported |
| Compute nodes | 48 (4 per compute rack), 384 NPUs, 192 CPUs | §3.3.3 / abstract, paper-reported |
| Node composition | 8 Ascend 910C NPUs, 4 Kunpeng CPUs, 7 L1 UB switch chips; 12 processors on a single-tier in-node UB plane | §3.3.2, paper-reported |
| L2 UB fabric | 7 independent sub-planes × 16 L2 chips × 48 ports; each L1 chip fans 16 links out (one to every L2 chip of its sub-plane); non-blocking | §3.3.3, paper-reported |
| Derived counts | 336 L1 chips, 112 L2 chips, 5 376 L1–L2 links (= 768 per sub-plane = 16 × 48 ports, so no spare L2 ports), 10 752 transceiver ends at 2 per link | derived |
| Alternate optics count | 6 912 × 800G LPO transceivers | secondary press citing SemiAnalysis; scan-level, kept as an alternative |
| Per-NPU links | 14 UB links × 28 GB/s (7 per die); one RDMA interface per die | The Register analysis; paper §3.3.1 |
| Planes | UB (scale-up), RDMA/RoCE (inter-supernode), VPC via Qingtian card | paper §3.2 |
| Atlas 950 SuperPoD | 8 192 NPUs; 160 cabinets (128 compute + 32 communication, secondary) | Huawei Connect 2025 press; cabinet split scan-level |
| Atlas 960 SuperPoD | 15 488 NPUs; 220 cabinets (176 + 44) | press, scan-level |
| SuperCluster | 2-tier 4-plane Clos to ~512 k NPUs | Huawei claim |
| Vendor reliability claims | 98 % training availability at 10 k cards; 99.95 % inference requirement; Atlas 960E 99.8 % availability and 2× MTBF; UB 2.0 optical switchover ~100 ns | vendor claims, used as targets only |
| MindCluster | fault-handling ladder (§2.1); slow-node SubHealthFault (code 110001010), 30 % degradation threshold, 3 consecutive 30 s detections | MindCluster 7.3 docs, vendor |

No public failure rates exist for the 910C, UB switch chips or LPO modules. The preset uses class analogues from the v1 library (GPU/HBM, NVSwitch-class ASIC, optical transceiver FIT from the survey's network data) with explicit multipliers, all tagged `assumed` or `derived`, and the tornado page ranks them so the user sees which assumption matters.

### 3.2 Parametrised superpod generator

```
topology: { kind: 'superpod', preset: 'cloudmatrix384',
  npusPerNode: 8, cpusPerNode: 4, l1PerNode: 7, nodesPerRack: 4, computeRacks: 12, commRacks: 4,
  subPlanes: 7, l2PerSubPlane: 16, l2Ports: 48, linksPerL1: 16, transceiversPerLink: 2,
  rdmaPortsPerNpu: 2, vpcNicsPerNode: 1, commShare: 0.3 }
```

Component classes generated: NPU (per node × 8), HBM (folded into NPU or separate), CPU, L1 UB chip, L1–L2 optical link (transceivers + fibre), L2 UB chip, sub-plane (CCF domain), Qingtian NIC, RDMA NIC, node power/cooling, rack power shelf, CDU, management plane. Failure semantics: NPU → node-level interruption (ladder); CPU → node down; L1 chip → node loses 1/7 uplink → sub-health (φ from `commShare`) or node down (policy); optical link → 1/112 of a node's uplink → sub-health; L2 chip → one link per node in that sub-plane → fabric sub-health; sub-plane CCF → 1/7 bandwidth; power shelf / CDU → rack domain. Presets: `cloudmatrix384` (Atlas 900 A3), `atlas950` (8 192 NPUs; node composition and plane count assumed equal; cabinet split from press), both marked with confidence per field. Templates: `ascend-training` (synchronous job over the supernode, hot spares optional) and `ascend-inference` (prefill/decode replica pools over N+k nodes). **[Q3]**

## 4. Excel import (and export)

### 4.1 Pipeline

1. **Read** (`packages/importers`, pure TS; browser via File API, CLI via fs): SheetJS Community Edition 0.20.3 from the SheetJS CDN tarball (the npm `xlsx` 0.18.5 build has known prototype-pollution and ReDoS advisories) reads `.xlsx/.xlsm/.xls/.csv` with cell values **and formulas** (`cellFormula`), merged ranges, outline levels and defined names.
2. **Fingerprint methods**: normalise each formula (strip `$`, sheet names, absolute refs) and match against a pattern catalogue → `MethodTag` with the matched cells and confidence:
   - `A = MTBF/(MTBF+MTTR)`, `U = λ·MTTR`, `λ = 1e9/FIT`, `MTBF = 8760/AFR` and unit conversions;
   - series `PRODUCT(A…)` or `1 − SUM(U…)` (rare-event approximation);
   - parallel `1 − PRODUCT(1 − A)`; k-of-n via `COMBIN`/`BINOM.DIST`/explicit sums; standby with `EXP`;
   - switchover weighting `c·A_sw + (1−c)·A_nosw`; MTTR mixtures `p·T_auto + (1−p)·T_manual`;
   - Markov via `MMULT`/`MINVERSE`/`TRANSPOSE` blocks; manual sensitivity tables;
   - header lexicon zh/en (MTBF, MTTR, 可用度/可用性, 失效率, 冗余, 倒换成功率, 数量, 亚健康, 自动/人工) to label columns.
   Output: a **Method report** (which methods, where, approximations detected, e.g. "rare-event sum used where exact product differs by 3e-5").
3. **Extract topology** → `TopologyDraft` IR `{nodes: [{id, name, count, redundancy, params, children, sourceCells}], edges, confidence}` from four cues: level/indent columns and outline levels; merged header cells; the formula dependency graph (a cell combining other rows' availabilities is their parent, and its pattern gives the combination type); naming conventions (N+1, 1+1, 2/3, 主备).
4. **Mapping UI** (new Import page): drop zone → sheet picker → column-role mapper (auto-guessed, user confirms) → tree preview with detected combination types → import as a `custom` structure scenario with provenance `excel:<file>!<sheet>!<cell>` on every parameter.
5. **Reconcile**: table of Excel's own results vs HAC-D's per block with the reason for each difference (method, rounding, unit); one click adopts the Excel method as an "as-Excel" comparison option so design comparisons can include the legacy calculation.
6. **Future image input**: a vision adapter (copilot) emits the same `TopologyDraft`, so steps 4–6 are shared. Not built now; the IR and the mapping UI are designed for it.
7. **Export [Q4]**: write a HAC-D workbook with live formulas (inputs sheet, structure sheet, results sheet) so results can be audited in Excel.

### 4.2 Fixtures and tests

Synthetic workbooks generated in Python (openpyxl) in `packages/importers/test/fixtures`: series-only sheet, 1+1 with switchover, k-of-n with COMBIN, mixed auto/manual MTTR, Markov block, zh headers with level column, en headers with indentation, a deliberately inconsistent sheet (rare-event sum). Tests assert the recovered tree, method tags and the reconciliation deltas. Real workbooks from the user, if provided, go to `data-staging/excel/` (git-ignored) and get regression tests on anonymised copies. **[Q1]**

## 5. UI changes (apps/web)

- Scenario page: Ascend preset picker and superpod parameters; repair editor with auto/manual paths; redundancy editor with switchover; sub-health editor; recovery ladder editor with the MindCluster preset.
- Results pages: measure switch (original / compensated / strict / tolerant / performance-weighted), waterfall chart with table twin, downtime-by-path stacked bar, switchover micro-outage share, sub-health policy comparison on the Training page.
- New Import page (§4.1 step 4) and Method report view; Compare page gains the measure selector and the "as-Excel" option.
- Report export adds the measures, the waterfall and the method report; bilingual strings; checked at 1280 px and 375 px, light and dark.

## 6. Validation

- New golden vectors computed independently in Python (mpmath / scipy): hyperexponential repair mixtures, k-of-n with imperfect switchover (compare with the v1 standby chain at n = 2), four-state sub-health unit, straggler law, plane-loss performance factor, CloudMatrix count arithmetic, recovery-ladder expectation.
- Property tests: compensated ≥ original; tolerant ≥ performance-weighted ≥ strict; c = 1, coverage = 1, no sub-health reduces to v1 results exactly (regression against the 143 existing goldens).
- Monte Carlo: the simulator gains the two repair paths, switchover failures and sub-health states; the delta badge is shown as in v1.
- Agents: an independent math agent for the new goldens, a fixture agent for the Excel workbooks, a source-curation agent for the Ascend records (every record with URL, date, confidence), one reviewer per package.

## 7. Work plan

| Phase | Content | Depends on |
|-------|---------|-----------|
| E1 | Core: dual-path repair, switchover, sub-health CTMCs; measures and waterfall; schema v2 with v1 compatibility; goldens | Q2 |
| E2 | Recovery ladder + MindCluster preset; training/inference integration (straggler law, isolate policy, plane degradation) | E1 |
| E3 | Superpod generator, CloudMatrix384 and Atlas 950 presets, Ascend library records, two Ascend templates | E1, Q3 |
| E4 | `packages/importers`: reader, fingerprinting, TopologyDraft, fixtures; CLI/MCP commands | Q1 |
| E5 | Web: editors, measure switch, waterfall, Import page, reconciliation; bilingual; browser checks | E1–E4 |
| E6 | Export to xlsx; docs (MODEL_REFERENCE v2, USER_GUIDE import section); release check | Q4 |

## 8. Decision points

- **[Q1] Excel samples** — target the user's real workbooks or build the generic importer on synthetic fixtures first.
- **[Q2] Definition of original vs compensated** — §2.4 proposal, or an operational definition (raw vs. excluding planned/customer-attributable downtime), or compensated = performance-weighted credit.
- **[Q3] Ascend scope** — CloudMatrix384 + parametrised Atlas 950 preset, CloudMatrix384 only, or also multi-supernode SuperCluster (RDMA scale-out Clos).
- **[Q4] Excel export** — import only, or also export HAC-D models as formula-bearing workbooks.
- Decided unless objected: sub-health reported as strict / tolerant / performance-weighted with a 0.7 threshold and tolerate-vs-isolate policies; SheetJS 0.20.3 (CDN tarball) client-side; the image adapter is deferred but the IR is built for it; Ascend failure rates are analogues tagged `assumed` until measured data exists.
