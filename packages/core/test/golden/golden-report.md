# HAC-D golden vectors — independent verification report

Generated 2026-10-08 by `compute_golden.py` (mpmath, 60 significant digits). 143 cases; match counts: discrepancy = 4, n/a = 15, ok = 120, rounding = 4.

`computed` is my value expressed in the survey's printed units; `survey` is the survey's printed value. Match: ok = within half a unit of the last printed digit; rounding = within one unit; discrepancy = beyond that; n/a = the survey prints no value (regression golden).


## 1. Unit conversions (Table 2-2)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `units.llama3_gpu_h_per_interruption` | gpu_h_per_event = days*24*N_gpu/events | 50677 | ≈5.07×10^4 GPU·h/次 (Table 2-2, survey_text.txt line 279) | ok |
| `units.rsc1_gpu_h_per_failure` | gpu_h_per_event = 1000*24*gpu_per_node/r_f | 29538.5 | ≈2.95×10^4 GPU·h/次 (Table 2-2, survey_text.txt line 284) | ok |
| `units.rsc2_gpu_h_per_failure` | gpu_h_per_event = 1000*24*gpu_per_node/r_f | 82051.3 | ≈8.2×10^4 GPU·h/次 (Table 2-2, survey_text.txt line 284) | ok |
| `units.coreweave_gpu_h_per_interruption` | gpu_h_per_event = gpu_days_per_event*24 | 89958 | ≈9.0×10^4 GPU·h/次 (Table 2-2, survey_text.txt line 289) | ok |
| `units.nebius_gpu_h_per_failure` | gpu_h_per_event = MTBF_h*N_gpu | 99000 | ≈9.9×10^4 GPU·h/次 (Table 2-2, survey_text.txt line 294) | ok |
| `units.delta_a100_gpu_h_per_error` | gpu_h_per_error = MTBE_h*N_gpu | 627.2 | ≈6.3×10^2 GPU·h/错误 (Table 2-2, survey_text.txt line 299) | ok |
| `units.delta_h100_gpu_h_per_error` | gpu_h_per_error = MTBE_h*N_gpu | 1155.2 | ≈1.2×10^3 GPU·h/错误 (Table 2-2, survey_text.txt line 299) | ok |
| `units.lanl_sys7_proc_h_per_failure` | proc_h_per_event = N_proc*8760/failures_per_year | 30958.6 | ≈3.1×10^4 处理器·h/次 (Table 2-2, survey_text.txt line 304) | ok |
| `units.lanl_sys7_system_mtbf_h` | MTBF_h = 8760/failures_per_year | 7.55824 | 系统 MTBF 约 7.6 h (Table 2-2, survey_text.txt line 304) | ok |
| `units.titan_node_h_per_crash` | node_h_per_event = MTBF_h*N_nodes | 271163 | ≈2.7×10^5 节点·h/次 (Table 2-2, survey_text.txt line 309) | ok |
| `units.petascale_socket_h_per_interruption` | socket_h_per_event = 8760/failures_per_socket_year | 87600 | 8.76×10^4 socket·h/次 (Table 2-2, survey_text.txt line 314) | ok |

## 2. 1/N law

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `one-over-n.rsc_rf6.50_16384gpu` | MTTF_h = 24 / ((N_gpu/gpu_per_node) * r_f/1000) | 1.8029 h | 1.8 h (survey_text.txt line 326) | ok |
| `one-over-n.rsc_rf6.50_131072gpu` | MTTF_h = 24 / ((N_gpu/gpu_per_node) * r_f/1000) | 0.2254 h | 0.23 h (survey_text.txt line 326) | ok |
| `one-over-n.coreweave_1024gpu_days` | MTTF_days = gpu_days_per_event / N_gpu | 3.6604 days | 3.66 天 (survey_text.txt line 269) | ok |
| `one-over-n.coreweave_16384gpu_days` | MTTF_days = gpu_days_per_event / N_gpu | MTTF_days = 0.228775; MTTF_h = 5.4906 | — | n/a |
| `one-over-n.epoch_1e-5_16384gpu` | M = 1/(N_gpu*lambda_gpu) | 3.052 h | 约 3 小时 (survey_text.txt line 963) | ok |
| `one-over-n.epoch_1e-5_100k_gpu` | M = 1/(N_gpu*lambda_gpu) | 30 min | 约每 30 分钟一次 (survey_text.txt line 326) | ok |
| `one-over-n.epoch_1e-5_1m_gpu` | M = 1/(N_gpu*lambda_gpu) | 3 min | 约每 3 分钟一次 (survey_text.txt line 326) | ok |
| `one-over-n.spare_96k_gpu` | M = 1/(N_gpu*lambda_gpu) | 31.25 min | 96k 卡约 30 分钟 (survey_text.txt line 326) | ok |
| `one-over-n.spare_600k_gpu` | M = 1/(N_gpu*lambda_gpu) | 5 min | 600k 卡约 5 分钟 (survey_text.txt line 326) | ok |

## 3. Worked example 1 (Table 6-5)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ex1.lambda_job` | lambda_job = events/(days*24) | 0.323302 /h | 0.323 次/h (Table 6-5, survey_text.txt line 1820) | ok |
| `ex1.mtbi` | MTBI = 1/lambda_job | 3.09308 h = 185.585 min = 11135.08 s | 3.09 h（185.6 min）; M = 11,135 s (Table 6-5, survey_text.txt line 1823 and survey_text.txt line 1832) | ok |
| `ex1.lambda_gpu` | lambda_gpu = lambda_job/N_gpu | 1/50677.0 GPU·h | 1 / 50,680 GPU·h (Table 6-5, survey_text.txt line 1826) | ok |
| `ex1.tau_yd` | tau = sqrt(2*delta*M) | 232.630 s | 232.6 s (Table 6-5, survey_text.txt line 1832) | ok |
| `ex1.daly_lowest_order` | tau = sqrt(2*delta*M) - delta | 230.200 s | 230.2 s (Table 6-5, survey_text.txt line 1833) | ok |
| `ex1.daly_three_term` | tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta, xi = sqrt(delta/(2M)) | 231.012 s | 231.0 s (Table 6-5, survey_text.txt line 1833) | ok |
| `ex1.daly_exact_lambert_w` | eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2 - 1)); tau = eta*M - delta; xi^2 = delta/(2M) | 231.012 s | 231.0 s（三项式） (Table 6-5, survey_text.txt line 1833) | ok |
| `ex1.goodput_r0` | goodput = 1 - delta/tau - (tau/2 + R)/M | 97.911 % | 97.9%（损失 2.1%）; delta/tau = 0.0104; tau/2 = 116.3 s (Table 6-5, survey_text.txt line 1835) | ok |
| `ex1.goodput_r4.45min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 95.513 % | 95.5% (Table 6-5, survey_text.txt line 1838) | ok |
| `ex1.goodput_r6.47min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 94.425 % | 94.4% (Table 6-5, survey_text.txt line 1841) | ok |
| `ex1.availability_optimal_interval` | Tc* = Ts + sqrt(2*(Tf + Tr)*Ts + Ts^2) | 237.845 s; ratio 1.0224 | 237.8 s（比 Young 式长 2%） (Table 6-5, survey_text.txt line 1844) | ok |

## 4. Worked example 2 (Table 6-6)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ex2.n16384.m` | M = 1/(N*lambda_gpu) | 185.596 min | 185.6 min (Table 6-6, survey_text.txt line 1855) | ok |
| `ex2.n16384.tau_yd` | tau = sqrt(2*delta*M) | 232.636 s | 232.6 s (Table 6-6, survey_text.txt line 1855) | ok |
| `ex2.n16384.loss_r0` | loss = delta/tau + tau/(2M) | 2.089 % | 2.1% (Table 6-6, survey_text.txt line 1855) | ok |
| `ex2.n16384.goodput_r4.45min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 95.513 % | 95.5% (Table 6-6, survey_text.txt line 1855) | ok |
| `ex2.n16384.goodput_r10min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 92.523 % | 92.5% (Table 6-6, survey_text.txt line 1855) | ok |
| `ex2.n65536.m` | M = 1/(N*lambda_gpu) | 46.399 min | 46.4 min (Table 6-6, survey_text.txt line 1862) | ok |
| `ex2.n65536.tau_yd` | tau = sqrt(2*delta*M) | 116.318 s | 116.3 s (Table 6-6, survey_text.txt line 1862) | ok |
| `ex2.n65536.loss_r0` | loss = delta/tau + tau/(2M) | 4.178 % | 4.2% (Table 6-6, survey_text.txt line 1862) | ok |
| `ex2.n65536.goodput_r4.45min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 86.231 % | 86.2% (Table 6-6, survey_text.txt line 1862) | ok |
| `ex2.n65536.goodput_r10min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 74.270 % | 74.3% (Table 6-6, survey_text.txt line 1862) | ok |
| `ex2.n131072.m` | M = 1/(N*lambda_gpu) | 23.199 min | 23.2 min (Table 6-6, survey_text.txt line 1869) | ok |
| `ex2.n131072.tau_yd` | tau = sqrt(2*delta*M) | 82.249 s | 82.2 s (Table 6-6, survey_text.txt line 1869) | ok |
| `ex2.n131072.loss_r0` | loss = delta/tau + tau/(2M) | 5.909 % | 5.9% (Table 6-6, survey_text.txt line 1869) | ok |
| `ex2.n131072.goodput_r4.45min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 74.910 % | 74.9% (Table 6-6, survey_text.txt line 1869) | ok |
| `ex2.n131072.goodput_r10min` | goodput = 1 - delta/tau - (tau/2 + R)/M | 50.987 % | 51.0% (Table 6-6, survey_text.txt line 1869) | ok |
| `ex2.n131072.r_over_m` | R/M and exp(R/M) | 0.4310; e^x = 1.5389 | R/M = 0.43、e^(R/M) = 1.54 (Table 6-6, survey_text.txt line 1873) | ok |

## 5. Worked example 3 (Table 6-7)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ex3.r_f2.3.mean_daily_failures` | mean = N*p, p = r_f/1000 | 2.3552 | 2.36 (Table 6-7, survey_text.txt line 1883) | ok |
| `ex3.r_f2.3.binomial_quantile_0.99` | k = min{k : P(Binomial(N,p) <= k) >= q} | 7 | 7 (Table 6-7, survey_text.txt line 1886) | ok |
| `ex3.r_f2.3.binomial_quantile_0.999` | k = min{k : P(Binomial(N,p) <= k) >= q} | 8 | 8 (Table 6-7, survey_text.txt line 1888) | ok |
| `ex3.r_f2.3.poisson_quantile_0.99_mttr8h` | m = N*lambda_node*MTTR, lambda_node = p/24 per h; k = min{k : P(Poisson(m) <= k) >= 0.99} | 3 (m = 0.78507) | 3 (Table 6-7, survey_text.txt line 1891) | ok |
| `ex3.r_f2.3.poisson_quantile_0.99_mttr2.2h` | m = N*lambda_node*MTTR, lambda_node = p/24 per h; k = min{k : P(Poisson(m) <= k) >= 0.99} | 2 (m = 0.21589) | 2 (Table 6-7, survey_text.txt line 1893) | ok |
| `ex3.r_f6.50.mean_daily_failures` | mean = N*p, p = r_f/1000 | 6.6560 | 6.66 (Table 6-7, survey_text.txt line 1884) | ok |
| `ex3.r_f6.50.binomial_quantile_0.99` | k = min{k : P(Binomial(N,p) <= k) >= q} | 13 | 13 (Table 6-7, survey_text.txt line 1886) | ok |
| `ex3.r_f6.50.binomial_quantile_0.999` | k = min{k : P(Binomial(N,p) <= k) >= q} | 16 | 16 (Table 6-7, survey_text.txt line 1888) | ok |
| `ex3.r_f6.50.poisson_quantile_0.99_mttr8h` | m = N*lambda_node*MTTR, lambda_node = p/24 per h; k = min{k : P(Poisson(m) <= k) >= 0.99} | 6 (m = 2.21867) | 6 (Table 6-7, survey_text.txt line 1891) | ok |
| `ex3.r_f6.50.poisson_quantile_0.99_mttr2.2h` | m = N*lambda_node*MTTR, lambda_node = p/24 per h; k = min{k : P(Poisson(m) <= k) >= 0.99} | 3 (m = 0.61013) | 3 (Table 6-7, survey_text.txt line 1893) | ok |

## 6. Worked example 4 (Table 6-8)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ex4.p0.993.k0` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 63.7899 % | 63.8% (Table 6-8, survey_text.txt line 1907) | ok |
| `ex4.p0.993.k1` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 92.3678 % | 92.4% (Table 6-8, survey_text.txt line 1909) | ok |
| `ex4.p0.993.k2` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 98.8692 % | 98.87% (Table 6-8, survey_text.txt line 1909) | ok |
| `ex4.p0.993.k3` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 99.8705 % | 99.87% (Table 6-8, survey_text.txt line 1909) | ok |
| `ex4.p0.993.k4` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 99.9879 % | 99.988% (Table 6-8, survey_text.txt line 1911) | ok |
| `ex4.p0.993.k5` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 99.9990 % | 99.999% (Table 6-8, survey_text.txt line 1911) | ok |
| `ex4.p0.99.k4` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 99.9382 % | 99.94% (Table 6-8, survey_text.txt line 1913) | ok |
| `ex4.p0.99.k5` | A = sum_{i=N..N+k} C(N+k,i) p^i (1-p)^(N+k-i) | 99.9930 % | 99.993% (Table 6-8, survey_text.txt line 1913) | ok |
| `ex4.mirrored_pair_single` | A_pair = 1 - (1-p)^2 | 99.9951 % | 99.995% (Table 6-8, survey_text.txt line 1916) | ok |
| `ex4.mirrored_pairs_64` | A = (1 - (1-p)^2)^64 | 99.6869 % | ≈99.69% (Table 6-8, survey_text.txt line 1916) | ok |

## 7. Daly 2006

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `daly.m1440min.three_term` | tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta | 116.690 min | 117 min (Daly card, survey_text.txt line 1672; Fig 6-1/6-2 captions survey_text.txt line 1605, survey_text.txt line 1607) | ok |
| `daly.m1440min.exact_lambert_w` | eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2-1)); tau = eta*M - delta | 116.690 min | 117 min (Daly card, survey_text.txt line 1672) | ok |
| `daly.m360min.three_term` | tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta | 56.713 min | 57 min (Daly card, survey_text.txt line 1672; Fig 6-1/6-2 captions survey_text.txt line 1605, survey_text.txt line 1607) | ok |
| `daly.m360min.exact_lambert_w` | eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2-1)); tau = eta*M - delta | 56.714 min | 57 min (Daly card, survey_text.txt line 1672) | ok |
| `daly.m15min.three_term` | tau = sqrt(2*delta*M)*(1 + xi/3 + xi^2/9) - delta | 9.141 min | 9.1 min (Daly card, survey_text.txt line 1672; Fig 6-1/6-2 captions survey_text.txt line 1605, survey_text.txt line 1607) | ok |
| `daly.m15min.exact_lambert_w` | eta = 2*xi^2 + 1 + W0(-exp(-2*xi^2-1)); tau = eta*M - delta | 9.167 min | 9.1 min (Daly card, survey_text.txt line 1672) | rounding |

## 8. Saxena 2024

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `saxena.casea.tc_star` | Tc* = Ts + sqrt(2*(Tf + Tr)*Ts + Ts^2) | 9.2321 min | 9.23 min (Saxena paragraph, survey_text.txt line 1608) | ok |
| `saxena.casea.young` | Tc = sqrt(2*Ts*Tf) | 7.7460 min | 7.74 min (Saxena paragraph, survey_text.txt line 1608) | rounding |
| `saxena.casea.availability_at_both_intervals` | A(Tc) = (Tf - Tf*Ts/Tc)/(Tf + Tc/2 + Tr) | 0.70396 vs 0.70270; diff 0.126 pp | 0.7040 对 0.7027（约 0.13 个百分点） (survey_text.txt line 1608) | ok |
| `saxena.caseb.tc_star` | Tc* = Ts + sqrt(2*(Tf + Tr)*Ts + Ts^2) | 1.4774 min | 1.477 min (Saxena paragraph, survey_text.txt line 1608) | ok |
| `saxena.caseb.young` | Tc = sqrt(2*Ts*Tf) | 1.4142 min | 1.414 min (Saxena paragraph, survey_text.txt line 1608) | ok |

## 9. TrainMover ETTR(N)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `trainmover.n8192` | ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF | 97.940 %; wasted 168.8 | ETTR 97.94%; wasted ≈169 GPU (survey_text.txt line 1507) | ok |
| `trainmover.n16384` | ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF | 95.880 %; wasted 675.1 | ETTR 95.88% (survey_text.txt line 1507) | ok |
| `trainmover.n32768` | ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF | 91.759 %; wasted 2700.3 | ETTR 91.76% (survey_text.txt line 1507) | ok |
| `trainmover.n65536` | ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF | 83.519 %; wasted 10801.3 | ETTR 83.52% (survey_text.txt line 1507) | ok |
| `trainmover.n131072` | ETTR = 1 - D/MTTF; wasted_gpus = N*D/MTTF | 68.214 %; wasted 41662.2 | ETTR 68.21%; wasted ≈41.7k GPU (survey_text.txt line 1507) | ok |

## 10. Lablup

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `lablup.young_interval` | T = sqrt(2*delta*M) | 44.980 min | 44.9 min (Young card, survey_text.txt line 1661) | rounding |
| `lablup.loss_at_actual_133.5min` | loss = delta/T + T/(2M) | loss 2.204 % (save 0.225 %, redo 1.980 %) | 实际 133.5 min，故障损失占主导 (Young card, survey_text.txt line 1661) | ok |

## 11. Google Ironwood k-of-n

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ironwood.p_from_k95_130` | solve P(Binomial(144,p) >= 130) = 0.95 for p | 0.93469 | p 约 0.935–0.940 (survey_text.txt line 966; card survey_text.txt line 1003) | ok |
| `ironwood.k99_at_p_star` | k99 = max{k : P(Binomial(144,p*) >= k) >= 0.99} | 127 | k99 = 127–128 (survey_text.txt line 966; card survey_text.txt line 1003) | ok |
| `ironwood.k_at_p0.935` | k_q = max{k : P(Binomial(144,p) >= k) >= q} | k95 = 130, k99 = 127 | k95 = 130, k99 = 127–128（同一 p） (survey_text.txt line 966) | ok |
| `ironwood.k_at_p0.940` | k_q = max{k : P(Binomial(144,p) >= k) >= q} | k95 = 130, k99 = 128 | k95 = 130, k99 = 127–128（同一 p） (survey_text.txt line 966) | ok |
| `ironwood.p_from_k99_125` | solve P(Binomial(144,p) >= 125) = 0.99 for p | 0.92080 (vs 0.93469 from the 95 % point) | 原文 99% 时取 125；两点在同一 p 下不完全自洽 (survey_text.txt line 966; survey_text.txt line 1784) | ok |
| `ironwood.redundancy_fractions` | frac = (n - k)/n | 9.72 % / 13.19 % | 约 10%（14/144）到 13%（19/144） (survey_text.txt line 1004) | ok |

## 12. ByteRobust binomial P99

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `byterobust.n1024.p_interval_for_p99_eq_4` | P99(Binomial(N,p)) = q  <=>  F(q-1;p) < 0.99 <= F(q;p); p_lo: F(q-1;p)=0.99, p_hi: F(q;p)=0.99 | (0.0805 %, 0.1251 %] | 约 0.08%–0.125% (Table 6-7 对照, survey_text.txt line 1898) | ok |
| `byterobust.n512.p_interval_for_p99_eq_3` | P99(Binomial(N,p)) = q  <=>  F(q-1;p) < 0.99 <= F(q;p); p_lo: F(q-1;p)=0.99, p_hi: F(q;p)=0.99 | p_lo_frac_exclusive = 0.000852955; p_hi_frac_inclusive = 0.00161134; check_quantile_at_midpoint = 3 | — | n/a |
| `byterobust.n256.p_interval_for_p99_eq_2` | P99(Binomial(N,p)) = q  <=>  F(q-1;p) < 0.99 <= F(q;p); p_lo: F(q-1;p)=0.99, p_hi: F(q;p)=0.99 | p_lo_frac_exclusive = 0.00058126; p_hi_frac_inclusive = 0.00170853; check_quantile_at_midpoint = 2 | — | n/a |
| `byterobust.n128.p_interval_for_p99_eq_2` | P99(Binomial(N,p)) = q  <=>  F(q-1;p) < 0.99 <= F(q;p); p_lo: F(q-1;p)=0.99, p_hi: F(q;p)=0.99 | p_lo_frac_exclusive = 0.00116447; p_hi_frac_inclusive = 0.00342762; check_quantile_at_midpoint = 2 | — | n/a |
| `byterobust.intersection_all_sizes` | intersection of the four p-intervals (1024->4, 512->3, 256->2, 128->2) | (0.1164 %, 0.1251 %] | 约 0.12%–0.125% (Table 6-7 对照, survey_text.txt line 1898) | ok |

## 13a. Textbook CTMC first passage

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ctmc.two_hot_units_no_repair` | birth-death recurrence, N=1, k=1, mu=0  ->  T0 = 3/(2*lambda) | 15000.0 h = 1.500000/λ | MTTF = 3/(2λ) (survey_text.txt line 968; plan §8) | ok |
| `ctmc.two_units_one_repairman` | birth-death recurrence, N=1, k=1, mu>0  ->  T0 = (3*lambda + mu)/(2*lambda^2) | 2098333.3333 h | MTTF = (3λ + μ)/(2λ²) (survey_text.txt line 1033) | ok |
| `ctmc.k0_series_reduces_to_1_over_n_lambda` | k = 0  ->  T0 = 1/(N*lambda) | 9.765625 h | T_0 = 1/(Nλ) (survey_text.txt line 1030) | ok |
| `ctmc.n1024_k4_numeric` | birth-death recurrence solved as a tridiagonal linear system (states 0..k, T_{k+1}=0) | T0_h = 435208; T0_years = 49.6472 | — | n/a |
| `ctmc.n1024_k4_steady_state_availability` | A = sum_{j<=k} C(N+k,j) u^j (1-u)^(N+k-j), u = lambda*MTTR/(1 + lambda*MTTR) | u_frac = 0.000278323; A_frac = 0.999988; unavailability_frac = 1.24909e-05 | — | n/a |
| `ctmc.ideal_cold_standby` | MTTF = 2/lambda (ideal cold standby); (1 + p_s)/lambda with switch success p_s | 20000.0 h; 19000.0 h | 理想冷备 2/λ；切换成功概率 p_s 时 (1 + p_s)/λ (survey_text.txt line 968) | ok |

## 13b. Basic RBD identities

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `rbd.parallel_1_of_2` | A = 1 - (1 - A_t)^2 | A_frac = 0.9999 | — | n/a |
| `rbd.n_plus_1_5_of_6` | A = A_m^n + n*A_m^(n-1)*(1 - A_m), n = 6 | A_frac = 0.99854; check_binomial_tail = 0.99854 | — | n/a |
| `rbd.series_unavailability` | A_job = prod (1 + lambda_i*MTTR_i)^(-n_i); 1 - A ≈ lambda_job*MTTR | A_frac = 0.723757; first_order_unavailability_frac = 0.323302 | — | n/a |

## 14. Meta Poisson blocked probability and Table 6-3

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `meta.blocked_poisson_l256_r22` | Pr(blocked) ≈ 1 - sum_{n<=R} m^n/n! e^-m, m = L*MTTR/MTBF | m = 6.144; Pr_blocked = 1.5138e-07 | — | n/a |
| `meta.blocked_binomial_exact_l256_r22` | Pr(blocked) = 1 - (1 + rho)^-L * sum_{n<=R} C(L,n) rho^n, rho = MTTR/MTBF  (= Binomial(L, rho/(1+rho)) upper tail) | rho = 0.024; Pr_blocked = 5.7051e-08; ratio_poisson_over_exact = 2.65341 | — | n/a |
| `meta.one_over_h_scaling_fixed_m` | with m = L*MTTR/MTBF held fixed, R is unchanged and R/L scales as 1/H | R = 22/22/22 | 块缩小 H 倍 … 备件比例降为 1/H (survey_text.txt line 1031) | ok |
| `meta.table6-3.block72gpu` | MTBF_block = 1/(K_trays/MTBF_tray + 1/MTBF_rack); L = 18432/gpu_per_block; R from printed spare fraction; stranded = (L-R - floor((L-R)/P)*P)/L | R = 22 (8.59 %), stranded 3.91 % | 块间备件 8.6%，stranded 3.9% (Table 6-3 rows, survey_text.txt line 1734–survey_text.txt line 1749) | ok |
| `meta.table6-3.block36gpu` | MTBF_block = 1/(K_trays/MTBF_tray + 1/MTBF_rack); L = 18432/gpu_per_block; R from printed spare fraction; stranded = (L-R - floor((L-R)/P)*P)/L | R = 24 (4.69 %), stranded 7.81 % | 块间备件 4.7%，stranded 7.8% (Table 6-3 rows, survey_text.txt line 1734–survey_text.txt line 1749) | ok |
| `meta.table6-3.block18gpu` | MTBF_block = 1/(K_trays/MTBF_tray + 1/MTBF_rack); L = 18432/gpu_per_block; R from printed spare fraction; stranded = (L-R - floor((L-R)/P)*P)/L | R = 27 (2.64 %), stranded 9.86 % | 块间备件 2.6%，stranded 9.9% (Table 6-3 rows, survey_text.txt line 1734–survey_text.txt line 1749) | ok |
| `meta.table6-3.common_target_band` | R(target) = min{R : Pr_blocked(R) <= target}; band of targets reproducing R = 22/24/27 is [max Pr(R), min Pr(R-1)) | Poisson band empty (needs ≥ 1.51e-07 and < 1.01e-07); exact-binomial band [5.71e-08, 7.27e-08) | 8.6% / 4.7% / 2.6% (Table 6-3, survey_text.txt line 1733) | ok |
| `meta.table6-3.round_target_scan` | R(target) = min{R : Pr_blocked(R) <= target} for round targets, Poisson and exact binomial | 1e-6: P 21/22/25 B 20/22/24; 5e-7: P 22/23/25 B 21/22/25; 2e-7: P 22/24/26 B 22/23/26; 1e-7: P 23/24/27 B 22/24/26; 5e-8: P 23/25/27 B 23/24/27; 2e-8: P 24/25/28 B 23/25/27; 1e-8: P 24/26/28 B 24/25/28 | 8.6% / 4.7% / 2.6%（R = 22/24/27） (Table 6-3, survey_text.txt line 1733) | discrepancy |

## 15. Benoit SC'19 replication

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `benoit.n_fail_b10` | n_fail(2b) = 1 + 4^b / C(2b,b)  (via log-gamma) | n_fail = 6.67546; sqrt_pi_b = 5.60499; ratio_to_sqrt_pi_b_over_2 = 1.68431; ratio_to_sqrt_pi_b = 1.19099 | — | n/a |
| `benoit.n_fail_b100` | n_fail(2b) = 1 + 4^b / C(2b,b)  (via log-gamma) | n_fail = 18.7467; sqrt_pi_b = 17.7245; ratio_to_sqrt_pi_b_over_2 = 1.49577; ratio_to_sqrt_pi_b = 1.05767 | — | n/a |
| `benoit.n_fail_b100000` | n_fail(2b) = 1 + 4^b / C(2b,b)  (via log-gamma) | 561.4998 | 561 (survey_text.txt line 965) | ok |

## 16. NTP amplification

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `ntp.affected_fraction_p0.001_t64` | f = 1 - (1 - p)^T | 0.06203 | 约 0.062 (survey_text.txt line 1132) | ok |
| `ntp.nvl72_block_vs_8gpu_node` | p_block = 1 - (1 - p_gpu)^72 ≈ 72 p_gpu; ratio to 8-GPU node | 0.06950 vs 0.00797; ratio 8.718 (→ 9 as p → 0) | ≈72 p_GPU，是 8 GPU 节点的 9 倍 (survey_text.txt line 1132) | ok |

## 17. Availability and AFR

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `avail.delta_h100_node` | A = MTTF/(MTTF + MTTR) | 99.252 %; 10.77 min/day | 约 99.3% (survey_text.txt line 378) | ok |
| `avail.delta_a100_node` | A = MTTF/(MTTF + MTTR) | 99.432 %; 8.18 min/day | 约 99.4% (survey_text.txt line 378) | ok |
| `avail.afr_from_mttf_1000000h` | AFR ≈ 8760/MTTF | 0.876 % | 0.88% (survey_text.txt line 110) | ok |
| `avail.afr_from_mttf_1500000h` | AFR ≈ 8760/MTTF | 0.584 % | 0.58% (survey_text.txt line 110) | ok |
| `avail.calce_downtime_a0.9932` | downtime_h_per_year = (1 - A)*8760 | 59.568 h | 59.6 h (survey_text.txt line 1135) | ok |
| `avail.calce_downtime_a0.9997` | downtime_h_per_year = (1 - A)*8760 | 2.628 h | 2.6 h (survey_text.txt line 1135) | ok |

## 18. Weibull

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `weibull.median_over_mean_k0.7` | median/mean = (ln 2)^(1/k) / Gamma(1 + 1/k) | 0.4680 (SIGMA observed 2.67/5.74 = 0.4652) | ≈0.47（SIGMA 2.67/5.74） (survey_text.txt line 742) | ok |
| `weibull.median_over_mean_k0.78` | median/mean = (ln 2)^(1/k) / Gamma(1 + 1/k) | median_over_mean = 0.541509; gamma_1_plus_1_over_k = 1.15432 | — | n/a |
| `weibull.mean_matched_scale_k0.78` | alpha = (1/lambda)/Gamma(1 + 1/k) | 86631.458 h | α = (1/λ)/Γ(1 + 1/k)（AIReSim 均值匹配） (survey_text.txt line 1057) | ok |
| `weibull.series_n1000_k0.78` | alpha_N = alpha*N^(-1/k); MTTF_from_new = alpha_N*Gamma(1 + 1/k); exponential reference 1/(N*lambda) | 14.251 h vs 100.0 h | 尺度按 N^(−1/k) 缩小，从新起算的系统 MTTF 按 N^(−1/k) 而非 1/N 下降 (survey_text.txt line 1057) | ok |

## 19. Lognormal repair

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `lognormal.lanl_repair_fit` | sigma = sqrt(2 ln(mean/median)); mu = ln(median); P_q = exp(mu + z_q sigma) | ratio 6.574; P90 649.4 min, P99 4933.0 min | 均值 355 min 是中位数 54 min 的 6.6 倍 (survey_text.txt line 318) | ok |

## 20. Prediction rates

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `prediction.rates` | lambda_unplanned = (1-R)*lambda; lambda_alarm = R*lambda/P | 0.268090 /h; 0.065369 /h | λ_unplanned = (1 − R)·λ; λ_alarm = R·λ/P (survey_text.txt line 1962) | ok |

## 21. Epoch replica model (optional)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `epoch.replica_m2_tstep10s` | F = (t_train/t_step)*(N_gpu/M)*(lambda_node*t_step)^M | 1 per 1.953e+04 trainings | M = 2: 每 533 次 训练出一次 (survey_text.txt line 1033; card survey_text.txt line 1213) | discrepancy |
| `epoch.replica_m3_tstep10s` | F = (t_train/t_step)*(N_gpu/M)*(lambda_node*t_step)^M | 1 per 6.592e+10 trainings | M = 3: 每 约 23 亿次 训练出一次 (survey_text.txt line 1033; card survey_text.txt line 1213) | discrepancy |

## Extra: Epoch first-order numbers (λ = 1/50,000)

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `epoch.fo.optimal_interval` | tau = sqrt(2*delta*M), M = 50000/N h | 3.851 min | 最优间隔约 4 min (survey_text.txt line 1129) | ok |
| `epoch.fo.checkpoint_plus_redo_loss` | loss = sqrt(2*delta/M) | 2.103 % | 约 2.1% (survey_text.txt line 1129; survey_text.txt line 1072) | ok |
| `epoch.fo.recovery_term` | recovery_loss = lambda_job*R = (N*lambda_gpu)*R | 2.785 %; total 4.889 % | 约 2.8%（合计约 5%） (survey_text.txt line 1129; survey_text.txt line 1072) | ok |

## Extra: Meta HPCA'25 ETTR planning statements

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `meta_hpca.n12000_rf6.50_w300s` | ETTR ≈ 1 - w_cp/dt - (dt/2 + u0)/M, dt = sqrt(2*w_cp*M), M = 1/(N_nodes*r_f) | M_s = 8861.54; dt_s = 2305.85; ETTR_frac = 0.705938 | — | n/a |
| `meta_hpca.n12000_rf1.0_w300s` | ETTR ≈ 1 - w_cp/dt - (dt/2 + u0)/M, dt = sqrt(2*w_cp*M), M = 1/(N_nodes*r_f) | 0.8927 | 约 0.9 (survey_text.txt line 1610) | ok |
| `meta_hpca.n12000_rf6.50_w10s` | ETTR ≈ 1 - w_cp/dt - (dt/2 + u0)/M, dt = sqrt(2*w_cp*M), M = 1/(N_nodes*r_f) | 0.9186 | 约 0.9 (survey_text.txt line 1610) | ok |

## Extra: trivially available checks

| id | formula | computed | survey | match |
|---|---|---|---|---|
| `misc.flashrecovery_no_failure_probabilities` | (1-p)^n | 0.904792 vs 0.904833 | 0.90479 对 0.90483 (survey_text.txt line 1508) | ok |
| `misc.spare_optimal_redundancy_r_star` | r* = floor(log2(N) + 0.833) | 8/10/10 | 8/10/10 (survey_text.txt line 1057) | ok |
| `misc.meta_in_block_spare_fraction` | 8/72 | 11.11 % | 块内备份 11.1% (survey_text.txt line 1748) | ok |
| `misc.meta_goodput_ratio` | 61,134 / 59,821 | 1.0219 | 1.024× (survey_text.txt line 1748) | discrepancy |
| `misc.hot_spare_fractions` | k/N | 0.391 %; 0.384 % | 8 台约占 0.4%；480 个节点（约 0.3%） (survey_text.txt line 1131) | rounding |

## Discrepancies (beyond rounding)

1. **Epoch AI memory-replica model (`epoch.replica_M2_tstep10s`, `epoch.replica_M3_tstep10s`).** The survey (line 1033, card line 1213) prints
   F = (t_train/t_step)·(N_GPU/M)·(λ_node·t_step)^M and quotes Epoch's results "M = 2 once per 533 trainings, M = 3 once per ≈2.3 billion".
   With t_train = 60 days, N_GPU = 1,000, λ_node = 8 × 1/50,000 per GPU·h and t_step = 10 s the formula gives one event per
   1.953e+04 trainings (M = 2) and per 6.592e+10 trainings (M = 3).
   F ∝ t_step for M = 2 and ∝ t_step² for M = 3, so the step time that would reproduce 533 is 366 s
   while the one reproducing 2.3 billion is 53.5 s; no single t_step works, and solving
   both quoted numbers simultaneously for (λ_node, t_step) gives λ_node ≈ 7.5e-3 /h and t_step ≈ 0.17 s, which are not Epoch's inputs.
   I believe the formula as transcribed (or the inputs Epoch actually used) differs from what produced the quoted numbers; the engine
   should be tested against the formula, not against 533 / 2.3e9. The two cases are regression goldens for the formula as printed.
2. **Meta Sparing goodput ratio (`misc.meta_goodput_ratio`).** 61,134 / 59,821 = 1.0219, printed as 1.024×. Minor; the paper's ratio was
   probably computed from unrounded goodput values. Not an engine formula.
3. **Meta Table 6-3 spare fractions (`meta.table6-3.round_target_scan`).** The printed 8.6 / 4.7 / 2.6 % (R = 22/24/27) cannot be produced by
   a single round blocked-probability threshold with the survey's reconstructed inputs, under either the Poisson approximation or the exact
   binomial (closest: Poisson 2e-7 → 22/24/26, 1e-7 → 23/24/27; binomial 1e-7 → 22/24/26, 5e-8 → 23/24/27). The printed numbers are the
   paper's outputs and are not claimed wrong; the selection criterion (or the block-MTBF / zone reconstruction) is what is unresolved.
   Details in the Table 6-3 section below.

## Rounding-level differences and inferred values (not discrepancies)

- `lablup.young_interval`: √(2·18 s·56.2 h) = 44.98 min; the survey/paper print 44.9 (truncated; 44.98 rounds to 45.0).
- `saxena.caseA.young`: √(2·30 s·3600 s) = 7.746 min; printed 7.74 (truncation in the paper).
- `daly.M15min.exact_lambert_w`: exact root 9.17 min vs Daly's Monte-Carlo optimum 9.1 min; the three-term series gives 9.14. Daly's
  117 / 57 / 9.1 min are simulation optima (≤10,000 runs), so agreement to the printed digit is all one can expect.
- `misc.hot_spare_fractions`: 480/125,000 = 0.384 %, which the survey (quoting Epoch) calls "约 0.3 %".
- `avail.delta_*`: unrounded MTTF/MTTR give 10.8 and 8.2 min/day of downtime; the survey's "9–10 min/day" is the paper's rounded statement.
- `ironwood.p_from_k95_130`: the exact root of P(X ≥ 130) = 0.95 for Binomial(144, p) is p* = 0.93469, which rounds to 0.935, the lower
  end of the survey's inferred band 0.935–0.940; at p* the 99 % point is k99 = 127 (survey 127–128). At p = 0.935 / 0.940 the 95 % point is
  k95 = 130 in both cases and k99 = 127 / 128, so the survey's band is the set of p whose k95 rounds to the blog's 130. The blog's second
  point (k99 = 125) implies p = 0.9208, confirming the survey's remark that the two blog points are not self-consistent.
- `benoit.n_fail_b100000`: 1 + 4^b/C(2b,b) = 561.4998, which rounds to 561 by 0.0002; implementations must use log-gamma (4^b overflows).

## Table 6-3 reverse engineering (optional item 14)

Block MTBF = 1/(K_trays/20,000 + 1/10,000) with K = 18 / 9 / 4.5 gives 1000 / 1818.2 / 3076.9 h; L = 256 / 512 / 1024 blocks per
18,432-GPU zone; m = L·MTTR/MTBF = 6.144 / 6.758 / 7.987. The printed spare fractions 8.6 / 4.7 / 2.6 % correspond to
R = 22 / 24 / 27 (the unique integers that round to the printed percentages), and the stranding term (L − R rounded down to a multiple
of the 2,304-GPU placement group) reproduces the printed 3.9 / 7.8 / 9.9 % exactly, so those R are certain.

The selection criterion is not reproduced, however. If R = min{R : Pr(blocked) ≤ target}, the target band that yields all three R is
empty (needs ≥ 1.51e-07 and < 1.01e-07) under the Poisson approximation (the 72-GPU block needs target ≥ 1.51e-07 while the 18-GPU block needs
target < 1.01e-07, so **no single Poisson target works**) and [5.71e-08, 7.27e-08) with the exact binomial stationary distribution.
Round targets give:
  - target 1e-6: Poisson R = 21/22/25, exact binomial R = 20/22/24
  - target 5e-7: Poisson R = 22/23/25, exact binomial R = 21/22/25
  - target 2e-7: Poisson R = 22/24/26, exact binomial R = 22/23/26
  - target 1e-7: Poisson R = 23/24/27, exact binomial R = 22/24/26
  - target 5e-8: Poisson R = 23/25/27, exact binomial R = 23/24/27
  - target 2e-8: Poisson R = 24/25/28, exact binomial R = 23/25/27
  - target 1e-8: Poisson R = 24/26/28, exact binomial R = 24/25/28
Targets reproducing 22/24/27: Poisson none, exact binomial none. My reading: the paper did not pick R from a
single blocked-probability threshold with these demo inputs (or its block MTBF / zone definition differs from the survey's reconstruction);
the fractions should be treated as the paper's printed outputs, and the engine should be validated on the formula (cases
`meta.blocked_poisson_L256_R22`, `meta.blocked_binomial_exact_L256_R22`) rather than on 8.6/4.7/2.6 %. The 1/H scaling law is exact when
m is held fixed (`meta.one_over_H_scaling_fixed_m`, R = 22 for L = 256/512/1024 → 8.6/4.3/2.1 %); with the rack term m grows
6.1 → 8.0 and R grows 22 → 27, which is why the printed fractions are not exactly 1/H. Low confidence overall; time-boxed.

## Assumptions and conventions

- Worked example 1 uses the exact M = 54·24/419 h = 11,135.08 s (survey rounds to 11,135 s); the difference is below 1e-5 relative.
- Worked example 2 uses λ_GPU = 1/50,680 per GPU·h as the survey states (example 1's unrounded value is 1/50,677).
- TrainMover N = 8K … 128K are taken as 8,192 … 131,072; the printed "≈169 wasted GPUs" is reproduced only with N = 8,192.
- Daly's τ is the compute time between checkpoints (excluding δ); the Lambert-W solution uses the principal branch W0, whose
  argument −e^(−2ξ²−1) is within 2ξ² of the branch point −1/e; implementations need a Lambert W that is accurate there
  (series about the branch point or a well-seeded Halley iteration). The three-term series is the survey's/Daly's Eq. 37 form.
- Binomial / Poisson quantiles are "smallest k with CDF ≥ q" (ByteRobust P99 convention); k-of-n availability is P(X ≥ k).
- The CTMC first-passage recurrence is solved as a tridiagonal linear system; (a)–(c) agree with the textbook closed forms to 1e-40.
- Lognormal repair parameters are method-of-moments from mean and median (DSN'06 does not print μ, σ).
- `tolerance.rel` = 1e-6 for closed forms and root-finding results (bisection to machine precision reaches this), 1e-9 for integer
  results. Tiny probabilities (~1e-7) in the Meta cases are fine in double precision via 1 − CDF (absolute error ~1e-16).
- Cases with `survey: null` / `match: "n/a"` are regression goldens: the survey prints no number, the value pins the formula.
- A scipy/numpy self-check (`selfcheck()`) recomputes the distribution tails, quantiles, Lambert W, gamma, normal quantiles and the
  CTMC solve independently of the mpmath helpers; the run aborts if any differ by more than 1e-9 relative.
