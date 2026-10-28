Project workflow: record a3server, npus 100000, id acme-a3-2026q3-pw, name "ACME A3 server cluster 2026Q3 (project workflow)".
Set: topology.superpod.nodesPerRack=3; topology.scaleOut.planes=2; topology.scaleOut.radix=128; targets.operational=0.985
FIT: COOL-hard=2880; CORE-hard=450; CORE-sdc=36; CPU-hard=320; DDR-hard=560; FABRIC-hard=59.99999999999999; FABRIC-hard@roce=66.66666666666667; MEMT-hard=384; MGMT-hard=400; MODULE-hard=180; NIC-hard=59.99999999999999; OPT-hard@roce=120; POWER-hard=6000; SSD-hard=1378.1485427248
Mechanisms: apply R-REPLAY:success=0.92
Report: scales 100000; trials 400; permutations 300

Sources (synthetic pilot data, every value invented; packages/cli/test/fixtures/pilot/internal, shipped as examples/pilot):
- geometry: acme-a3-design-note-2026q3.md L1-39 (vendor) — 3 servers per cabinet instead of the public a3server record's 4; 2 RoCE planes of 128-port switches instead of 1 plane of 64-port switches; the rest as the public record.
- FIT per unit-hour: the normalized override acme-fit-2026q3.json of the worksheet pilot (acme-fit-2026q3.csv through the reviewed 口径 mapping acme-koujing-mapping-2026q3.csv); OPT-hard@roce 120 is the deliberately implausible value (×25.2 the library), kept with the owner's note.
- mechanisms: acme-mechanisms-2026q3.md — R-REPLAY success 0.92 (measured, ACME-FM-2026Q3 table 6). D-HARD detectSeconds 20 (table 4) is a candidate parameter of the mechanism set; the project workflow cannot change a candidate's parameter (limit noted in the pilot report), so the worksheet pilot's set delta is the record of it.
