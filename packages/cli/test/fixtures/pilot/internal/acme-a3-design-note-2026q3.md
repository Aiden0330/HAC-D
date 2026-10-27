# ACME A3 server cluster — design note 2026Q3 / ACME A3 服务器集群——2026Q3 设计说明

Document id: ACME-DN-2026Q3-A3. Synthetic pilot data for the HAC-D ingest pilot: every value in this note is invented and it
contains no internal data. 本文为 HAC-D 导入试点的合成数据，所有数值均为编造，不含任何内部数据。

Chip family: 910C. The cluster is built from 8-NPU servers with RoCE between servers; the HAC-D template is a3-ub384.

## 1 Baseline / 基线

The design starts from the cloudmatrix384 preset; the geometry below overrides it. 设计以 cloudmatrix384 预设为基线，几何按下文覆盖。

## 2 Server / 服务器

Each server carries 8 NPUs and 4 Kunpeng CPUs. Each server has 7 on-board UB L1 switch chips. Each NPU exposes 2 RDMA ports.
Each server has 1 VPC NIC. 每台服务器 8 颗 NPU、4 颗鲲鹏 CPU，板载 7 片 UB L1 交换芯片。

## 3 Cabinet and pod / 机柜与 pod

A cabinet holds 3 servers (the Q3 power budget limits a cabinet to three servers). The pod is a single compute cabinet:
1 compute cabinet and 0 communication cabinets. There is no L2 UB tier: 0 L2 chips per sub-plane, and the L1 chips have 0 uplinks
into L2. 每柜 3 台服务器；pod 即 1 个计算柜、0 个互联柜；无 L2 层。

## 4 Scale-up domain / 纵向扩展域

The scale-up (UB) domain is one server: the UB domain has 8 NPUs. 纵向扩展域为单台服务器。

## 5 Scale-out network / 横向扩展网络

Scale-out uses 2 RoCE ports per NPU at 200G, spread over 2 planes of 128-port switches, non-blocking with oversubscription 1,
and 2 transceivers per link. 横向扩展：每 NPU 2 个 200G RoCE 口，两个平面，128 口交换机，无收敛，每链路 2 只光模块。

## 6 Reliability instances / 可靠性实例

For the reliability model the SuperPoD layer is one server (nodes). The SuperPoD layer has 8 NPUs. A cabinet layer has 24 NPUs.
A node layer has 8 NPUs. 可靠性模型中超节点层即一台服务器。

## 7 Scale / 规模

The Q3 plan is a 100,000-NPU cluster. Q3 规划规模为 10 万卡。
