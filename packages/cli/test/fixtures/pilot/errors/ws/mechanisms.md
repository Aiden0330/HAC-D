---
worksheet: mechanisms
version: hacd-worksheet-1
id: acme-mech-2026q3
base: remap-latest-2026-10
source: "acme-mechanisms-2026q3.md: ACME-FM-2026Q3 field report. Only the parameters that differ from the HAC-D default set are listed."
remap:
  repo: https://github.com/lzq0927/remap
  commit: f53ab7e
  note: "remap/remap-latest HEAD f53ab7e (2026-10-16, “feat: add bounded availability planning and decision comparisons”); packages/contracts/src/audit-extensions.ts unchanged since eaacb0578a30027c480046de6b91e6f434dfa15e (2026-10-15); reconciled field by field 2026-10-21"
---

# Mechanism set delta — example over the default set

## parameters — target parameters (merged over the library defaults)

| mechanism | parameter | value | source | confidence | note |
| --------- | --------- | ----- | ------ | ---------- | ---- |
| D-HARD | detectSeconds | 20 | ACME-FM-2026Q3 table 4 (median detection time of hard faults) | measured |  |
| R-REPLAY | success | 0.92 | ACME-FM-2026Q3 table 6 (step-replay success rate, Q3) | measured |  |

## verdicts — which list each mechanism is in (reference / candidate / goodput / pruned / capability)

| mechanism | verdict | reason zh | reason en |
| --------- | ------- | --------- | --------- |

## provenance — entries by field path not placed in a row above

| path                            | source              | confidence | note                 |
| ------------------------------- | ------------------- | ---------- | -------------------- |
## notes

Worksheet profile hacd-worksheet-1. The parser is strict: fixed table headers, one value per cell, `\|` for a literal pipe; a blank value cell means "not stated". Closed vocabularies:

- confidence: measured, paper-reported, vendor, derived, assumed, scan-level
- verdict: reference, candidate, goodput, pruned, capability
- layer: cluster, scaleout, superpod, cabinet, node, npu
- stage: detection, rung, automatic, manual, checkpoint, sdc, rate, local, none
- mechanism kind: detect, recover, checkpoint, physical
- mechanism ids: D-HARD, D-SLOW, D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, R-CKPT, R-MANUAL, C-FAST, H-PROTECT, H-RELIABILITY, P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, D-SDC-DMR, H-LEMON, H-SWEEP, R-LINK-LOCAL, R-FABRIC-DEGRADE, I-CONTAIN, H-CONTROL-CONTINUITY, R-WARM-PROCESS, R-RUNTIME-SNAPSHOT, C-ASYNC, C-LOSSLESS, D-RECOVERY-CLASSIFY, D-SDC-FP8, D-SDC-FP4, D-ABFT, D-NET-SDC, H-SDC-SCREEN, R-HCCL-ELASTIC, R-CANN-GRAPH
- a delta lists only what changes; parameter keys must be ones the mechanism reads (hacd ingest validate checks)
