---
worksheet: fault-rates
version: hacd-worksheet-1
id: acme-fit-2026q3
basis: per-unit
source: acme-fit-2026q3.csv × acme-koujing-mapping-2026q3.csv (data owner's worksheet; synthetic values with deliberate errors for the operator validation)
---

# Fault-rate worksheet — ACME 2026Q3 (deliberate errors: an unknown class and an empty source)

## rates — business-impact FIT per unit-hour by catalog class

| class      | unit    | fit  | source                                           | confidence | derivation                                                                     | note |
| ---------- | ------- | ---- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------ | ---- |
| DDR-hard   | node    | 560  | acme-fit-2026q3.csv tbl_mem row 2; mapping row 6 | derived    | 35 FIT × 32 per node × 0.5 = 560 FIT per node-hour                             |      |
| HBM-hard   | npu     | 384  | acme-fit-2026q3.csv tbl_npu row 7; mapping row 4 | derived    | 80 FIT × 8 per NPU × 0.6 = 384 FIT per NPU-hour                                |      |
| POWER-hard | cabinet | 6000 |                                                  | derived    | 10⁹ / 600,000 h = 1,667 FIT × 6 per cabinet × 0.6 = 6,000 FIT per cabinet-hour |      |
