---
worksheet: topology
version: hacd-worksheet-1
id: acme-a3-2026q3
name: 
  zh: ACME A3 服务器集群 2026Q3
  en: ACME A3 server cluster 2026Q3
short: 
  zh: ACME A3 服务器集群 2026Q3
  en: ACME A3 server cluster 2026Q3
family: "910C"
template: a3-ub384
scenarioId: acme-a3-2026q3
---

# Topology worksheet (draft from evidence cards) — acme-a3-2026q3

## geometry — SuperPoD geometry (base = preset; rows override it)

| field           | value          | source                              | confidence | note                                  |
| --------------- | -------------- | ----------------------------------- | ---------- | ------------------------------------- |
| base            | cloudmatrix384 | acme-a3-design-note-2026q3.md L1-39 | vendor     | starts from the cloudmatrix384 preset |
| npusPerNode     | 8              | acme-a3-design-note-2026q3.md L1-39 | vendor     | Each server carries 8 NPUs            |
| cpusPerNode     | 4              | acme-a3-design-note-2026q3.md L1-39 | vendor     | and 4 Kunpeng CPUs                    |
| l1PerNode       | 7              | acme-a3-design-note-2026q3.md L1-39 | vendor     | has 7 on-board UB L1 switch chips     |
| nodesPerRack    | 3              | acme-a3-design-note-2026q3.md L1-39 | vendor     | A cabinet holds 3 servers             |
| computeRacks    | 1              | acme-a3-design-note-2026q3.md L1-39 | vendor     | 1 compute cabinet and                 |
| commRacks       | 0              | acme-a3-design-note-2026q3.md L1-39 | vendor     | and 0 communication cabinets          |
| l2PerSubPlane   | 0              | acme-a3-design-note-2026q3.md L1-39 | vendor     | 0 L2 chips per sub-plane              |
| linksPerL1      | 0              | acme-a3-design-note-2026q3.md L1-39 | vendor     | L1 chips have 0 uplinks               |
| rdmaPortsPerNpu | 2              | acme-a3-design-note-2026q3.md L1-39 | vendor     | Each NPU exposes 2 RDMA ports         |
| vpcNicsPerNode  | 1              | acme-a3-design-note-2026q3.md L1-39 | vendor     | Each server has 1 VPC NIC             |
| domainNpus      | 8              | acme-a3-design-note-2026q3.md L1-39 | vendor     | the UB domain has 8 NPUs              |

## scale-out — main scale-out design

| field               | value | source                              | confidence | note                      |
| ------------------- | ----- | ----------------------------------- | ---------- | ------------------------- |
| portsPerNpu         | 2     | acme-a3-design-note-2026q3.md L1-39 | vendor     | uses 2 RoCE ports per NPU |
| planes              | 2     | acme-a3-design-note-2026q3.md L1-39 | vendor     | over 2 planes             |
| radix               | 128   | acme-a3-design-note-2026q3.md L1-39 | vendor     | of 128-port switches      |
| oversubscription    | 1     | acme-a3-design-note-2026q3.md L1-39 | vendor     | oversubscription 1        |
| transceiversPerLink | 2     | acme-a3-design-note-2026q3.md L1-39 | vendor     | 2 transceivers per link   |

## layers — instance rule of the layers

| layer    | unit  | npus |
| -------- | ----- | ---- |
| superpod | nodes | 8    |
| cabinet  |       | 24   |
| node     |       | 8    |

## counts — user hardware counts by BOM row

| row | count | npus   | tiers | source                | confidence | note |
| --- | ----- | ------ | ----- | --------------------- | ---------- | ---- |
| foo | 10    | 100000 |       | ACME inventory 2026Q3 | measured   |      |

## provenance — entries by field path not placed in a row above

| path                 | source                              | confidence | note                                 |
| -------------------- | ----------------------------------- | ---------- | ------------------------------------ |
| layers.superpod.npus | acme-a3-design-note-2026q3.md L1-39 | vendor     | The SuperPoD layer has 8 NPUs        |
| layers.cabinet.npus  | acme-a3-design-note-2026q3.md L1-39 | vendor     | A cabinet layer has 24 NPUs          |
| layers.node.npus     | acme-a3-design-note-2026q3.md L1-39 | vendor     | A node layer has 8 NPUs              |
| layers.superpod.unit | acme-a3-design-note-2026q3.md L1-39 | vendor     | SuperPoD layer is one server (nodes) |
