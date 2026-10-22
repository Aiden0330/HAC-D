# v5 parameter reconciliation (2026-10-21)

The final pass of the v5 phase (CLAUDE.md: the one reconciliation pass over a parameter set) over the three default input records
that every v5 report inherits: the topology records (`packages/core/data/records/*.json`), the mechanism set
(`packages/core/data/mechanism-sets/remap-latest-2026-10.json`) and the per-card failure-rate override
(`packages/core/data/fault-rates/remap-per-card-2026-10-09.json`). Every value was checked against the source named in its
provenance; the tables below give the verdict (confirmed / re-tagged / corrected) and the change applied. No numerical value
changed: the v4.4 numbers (results.json, bom.json, mechanisms.json, the arch Shapley studies) stay reproducible to 1e-9.

Confidence vocabulary (ConfidenceSchema): `measured` (fleet or test data) · `paper-reported` · `vendor` (product page, keynote,
release) · `derived` (arithmetic on stated values) · `assumed` (engineering assumption, analogy, prior) · `scan-level` (single
secondary source).

## 1. Mechanism set `remap-latest-2026-10` vs ReMAP f53ab7e

Source: `remap/remap-latest` at commit f53ab7e (2026-10-16), `packages/contracts/src/audit-extensions.ts` (`extensionScenario()`
generic fields + `parameterSets`), `references/expert-review-2026-10-09/{mechanism-policy,config}.json`;
`node --import tsx scripts/remap-param-check.ts` → `SAME fault rates, flags, baseline settings and mechanism parameters`.

| Block | Set value | Source value | Verdict |
|---|---|---|---|
| generic fields | eligibleShare 1 (FP8 / FP4: 0.5 of the CORE silent risk), success 0.95, failureSeconds 0, overhead 0 (D-ABFT 0.001) | `extensionScenario()`: `eligibleShare` 0.5 for D-SDC-FP8 / FP4 else 1; `success` 0.95; others 0; `overhead` 0.001 for D-ABFT | confirmed |
| R-LINK-LOCAL | successSeconds 2 | pauseSeconds 2 | confirmed |
| R-FABRIC-DEGRADE | switchSeconds 2, exposedCommunicationFraction 0.3, remainingBandwidthRatio 0.75, repairSeconds 1800 | pauseSeconds 2, communicationFraction 0.3, bandwidthRatio 0.75, repairSeconds 1800 | confirmed |
| H-CONTROL-CONTINUITY | pauseSeconds 1 | pauseSeconds 1 | confirmed |
| R-WARM-PROCESS / R-RUNTIME-SNAPSHOT | startupTargetSeconds 20 / 15, eligibleShare 0.95 | stageSeconds 20 / 15; eligible 1 × success 0.95 folded | confirmed |
| R-CANN-GRAPH | graphTargetSeconds 7.5, eligibleShare 0.95 | stageSeconds 7.5 | confirmed |
| C-ASYNC | blockingTargetSeconds 1.15 (= 4 × 0.05 + 1 × 0.95), durableLagSeconds 10 | blockSeconds 1, durableLagSeconds 10, success 0.95 | confirmed |
| C-LOSSLESS | compressionRatio 2, decompressSeconds 10, share 0.95 | compressionRatio 2, decompressSeconds 10 | confirmed |
| D-RECOVERY-CLASSIFY | manualProbabilityTarget 0.001, eligibleShare 1, success 0.95 | manualProbability 0.001 | confirmed |
| D-SDC-FP8 / FP4 | detectionTarget 0.95, detectSeconds 1, riskShare 0.475 (= 0.5 × 0.95) | coverage 0.95, detectSeconds 1, eligibleShare 0.5 | confirmed |
| D-ABFT | upstreamDetection 0.95, conditionalMissDetection 0.855 (= 0.9 × 0.95), overhead 0.001 | coverage 0.9 (conditional), overhead 0.001 | confirmed |
| D-NET-SDC | detectionTarget 0.9025 (= 0.95 × 0.95), detectSeconds 1 | coverage 0.95, detectSeconds 1 | confirmed |
| H-SDC-SCREEN | occurrenceReduction 0.25, eligibleShare 0.95 | reduction 0.25 | confirmed |
| R-HCCL-ELASTIC | communicationBeforeSeconds 60, communicationTargetSeconds 15, share 0.95 | stageSeconds 15 | confirmed |
| baseline set (6) | D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST with library parameters | mechanism-policy.json (8 originals, identical values) | confirmed |
| recovery baseline | detection 0.95 in 10 s else 60 s; automatic 180 s at 0.99; manual 7200 s | config.json | confirmed; confidence stays `assumed` (an engineering baseline of the audited reference, not a measurement); source text now cites the file and the catalog anchor |
| levers, derate, efforts, threshold, dominated map | HAC-D conventions | PLAN_V4 §8, plan.ts DERATE_DEFAULT, library efforts, audit overlap rule | **provenance added** (`provenance` map in the set), all `assumed` except the verdict lists (`derived` from the Shapley rule) |
| prune.rule text | named "500k on the four topologies" | — | **generalised** to "the decision scale on every architecture" (the hierarchy function prints the actual scale) |
| remap note | "unchanged since eaacb05" | git log f53ab7e 2026-10-16 | confirmed; date added |

Confidence of the extension parameters: ReMAP calls them an explicit scenario (`evidence: "scenario"`, "never a measured default
or silently deployed protection"), so they stay `assumed`.

## 2. Failure-rate override `remap-per-card-2026-10-09` vs the audited catalog

Source: `remap/remap-latest/references/expert-review-2026-10-09/inputs.json` (`current.events`, revision
`event-budget-v3-sdc1.4-reviewed-85`, catalog sha256 `6b0f6c20…1d5dc`), `legacy.events` for the per-event evidence fields,
`config.json` for the anchor.

| Item | Result |
|---|---|
| 54 FIT values | equal to `inputs.json` and to `REFERENCE_EVENTS` to 1e-9 (0 mismatches) |
| rate basis (口径) | 每十亿 NPU 等效运行暴露小时的业务影响事件；非物理器件 FIT — now recorded in `catalog.rateBasis` (zh / en) |
| anchor | class totals hard 3,333.3 / slow 69.0 / silent 48.3 FIT per card (shares 0.966 / 0.020 / 0.014), normalised to a 30 h hard-interruption MTBF at 10,000 cards; CORE carries 85 % of the silent class, 12 silent ids are zero — recorded in `catalog.anchor` |
| per-event evidence | every event is labelled `PRIOR（保持USER总量及V4粗分组）` with a domain note (e.g. `WP §4.3.6；普通CRC丢包不是SDC`) and status `待审计先验` (3 events: `不单列该直接影响；非已测零故障`) — copied into each entry's `note` |
| confidence | stays `assumed` for all 54: none is a vendor or fleet measurement; the catalog's own labels say prior / modelling assumption (`catalog.confidenceNote`) |
| RoCE analogues | FABRIC / OPT classes mapped to the scale-out units by analogy (no public RoCE data for Ascend clusters) — unchanged, `assumed` |

## 3. Topology records

Sources: `docs/markdown/ASCEND_SOURCES.md` (fetched 2026-10-09, with the verification status of each URL), the SUPERPOD_PRESETS
sources in `packages/core/src/scenario/schema.ts`, the TOPOLOGY_TEMPLATES sources, and the v4.4 scaling-report builders.

| Record · field | Before | After | Reason |
|---|---|---|---|
| native950 · superpod (16 + 4 cabinets, 64 NPUs + 16 CPUs per cabinet) | vendor | vendor | product page (read 2026-10-19), MWC 2026 release ("64 NPUs per cabinet") |
| native950 · rackSwitches 72 | paper-reported | paper-reported, note added | UB-Mesh §3.3.1 reference cabinet applied to the shipped cabinet |
| native950 · podUplinksPerNpu 2 | derived | derived | LightCounting: 128 × 800G OSFP per 64-NPU cabinet |
| native950 · podSwitchRadix 128 | assumed | **derived** | Hot Chips 2025 slide 9: 128 × 100 Tb/s switches for 8,192 NPUs at 2 × 800G → 128 ports per switch |
| native950 · cpusPerNode 2 | assumed | **derived** (blast radius of a CPU still assumed) | 16 Kunpeng per cabinet ÷ 8 NPU trays (vendor arithmetic) |
| native950 · transceiversPerLink 2 | assumed | **derived** | LightCounting: 4,096 modules per 1,024 NPUs including the switch side |
| native950 · scaleOut (4 planes × 2 tiers, radix 1,024, 4 × 200G) | derived | **assumed** | the network design is an analogy with the 960 cluster (HC2026); only the per-NPU bandwidth (950 white paper 2 × 400G UBoE) is stated |
| ubl128 · superpod (128 NPUs, single layer, 3.2 Tb/s) | vendor | vendor | Huawei Computing 2026-09-30 |
| ubl128 · podUplinksPerNpu 4 | derived | derived | 3.2 Tb/s ÷ 800G |
| ubl128 · podSwitchRadix 128 | derived | **assumed** | the 950 pod switch assumed for the UBL128 layer; only the count (4 per pod) follows |
| ubl128 · computeRacks 2, commRacks 1, rackSwitches 0, countOverrides (1 switch cabinet per 4 pods, 28 tray links) | assumed | assumed | user attachment / geometry choice, not public |
| ubl128 · scaleOut | derived | **assumed** | as native950; the vendor states two-tier scale-out to 256K NPUs |
| cm384 · superpod, domainNpus 384, portsPerNpu 2 | paper-reported | paper-reported | arXiv 2506.12708 v3 §3.3 |
| cm384 · transceiversPerLink 2, scaleOut.radix 64 | assumed | assumed | not public |
| a3server · superpod (8 × Ascend 910, 4 × Kunpeng 920) | vendor | vendor | Atlas 800T A3 product page |
| a3server · domainNpus 8 | vendor | **derived** | by definition of the stand-alone-server option; node internals from the CM384 paper; the vendor's "up to 384 cards" is the SuperPoD use |
| a3server · 4 servers per cabinet, no L2 / optics / comm cabinets, scale-out ports as CM384 RDMA, radix 64 | assumed | assumed | not public |
| a960e · cabinet counts 56 + 14, 9 blades × 8, 18 CPUs | scan-level | scan-level | single media source (智东西 2026-09-19); vendor headline 4,096 ≠ 56 × 72 = 4,032 |
| a960e · LinkDevice 176 ports, NPO 5,500 engines / 48,000 modules, two-tier four-plane Clos | vendor | vendor | HUAWEI CONNECT 2026 releases |
| a960e · 5 LinkBlade chips per cabinet, 5.5 LinkDevice ports per NPU, scale-out 4 ports / radix 1,024 | assumed | assumed | fabric counts inferred |
| all records · `assumed` list | field notes (English, verbatim from the builders) | **bilingual items** (zh / en) | the BOM report prints them; the field-level notes live in `provenance` |

Confidence counts after the pass (provenance fields): native950 vendor 1, paper-reported 1, derived 4, assumed 1 · ubl128 vendor 1,
derived 1, assumed 7 · cm384 paper-reported 3, assumed 2 · a3server vendor 1, derived 1, assumed 6 · a960e vendor 3, scan-level 3,
derived 1, assumed 4.

## 4. Formula (4) and the uniform factor k

The independent verifier (golden G5) showed that the closed form k = B / Σcᵢ of Methodology formula (4) holds φ at its k = 1 value
and therefore misses the engine's bisection root by about 1e-5 relative (φ moves with k through the silent-corruption window). The
Methodology now states formula (4) as the first-order check and k as the engine's root (`recommendPlan`); goldens G5a (first-order,
tolerance 2e-5) and G5b (exact identity at the engine's k, 1e-9) pin both statements.

## 5. What the pass did not change

No FIT value, mechanism parameter, lever limit, derating margin or threshold changed, so the v4.4 numbers are unchanged. The
re-tags and notes reach the reports through the records' `provenance` and `assumed` fields (BOM assumptions, Table 3 confidence
tags for overridden FIT values) and the sidecar JSON.
