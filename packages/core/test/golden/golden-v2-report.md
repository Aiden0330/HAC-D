# HAC-D v2 golden vectors — independent verification report

Generated 2026-10-09 by `compute_golden_v2.py` from `docs/MODEL_REFERENCE.md, v2 additions §10–§17` only (no engine source read). 26 cases in `golden_v2.json`: repair = 4, kofn = 6, parallel = 1, standby = 2, subhealth = 5, straggler = 2, plane = 3, ladder = 1, waterfall = 1, cm384 = 1.

## Method

Every CTMC is assembled from the state/transition table of its section (positive rates only; states that cannot be reached from the initial state are removed), the generator Q is formed, and pi Q = 0 with sum pi = 1 is solved with mpmath at 40 significant digits (one balance equation replaced by the normalisation; the residual max_j |(pi Q)_j| is asserted below 1e-34). Failure frequency nu = sum_(i up, j down) pi_i Q_ij. Mean first passage from the initial state into the down set solves (-Q_TT) t = 1 over the transient (up) states. The expected values are the mpmath results rounded to double.

### numpy / scipy vs mpmath agreement

Every case is computed twice: once from the mpmath solutions and once from numpy's double-precision LU solutions of the very same linear systems (stationary and first-passage); the table lists the largest relative difference over the case's expected values. Separately, each stationary vector is also recomputed as the null space of Q^T with scipy (SVD).

- Over all 26 cases the double-precision recomputation agrees with the mpmath expected values to 1.6e-13 relative at worst (`kofn.group.n2k1_seta_crews_inf_psw1`, key `mttf_from_new`), about four orders of magnitude below the 1e-9 tolerance.
- Component level (30 stationary solves): numpy LU max absolute difference 1.3e-16; the max relative difference 1.2e-08 occurs on a state with pi = 2e-11 (§11 kofn n=4 k=2 crews=2 p_sw=1.0, state ('N', 4, 0), pi = 2.443e-11), where double precision has only ~8 significant digits — no expected value is that small. scipy null space: max relative component difference 3.5e-07 (SVD, same tiny-component effect).
- First passage (11 solves): numpy max relative difference 1.6e-13 (worst: §11 kofn n=2 k=1 crews=inf p_sw=1.0).

| case | max rel diff (numpy vs mpmath) | worst key |
|---|---|---|
| `repair.unit.set_a` | 1.3e-16 | pi_Dm |
| `repair.unit.set_b` | 1.4e-16 | pi_Dm |
| `repair.unit.set_c` | 8.1e-17 | pi_Da |
| `repair.unit.set_d` | 1.1e-16 | auto_downtime_share |
| `kofn.group.n2k1_seta_crews_inf_psw1` | 1.6e-13 | mttf_from_new |
| `kofn.group.n3k2_seta_crews1_psw1` | 4.4e-14 | mttf_from_new |
| `kofn.group.n4k2_setd_crews2_psw1` | 1.2e-15 | mttf_from_new |
| `kofn.group.n2k1_setb_crews_inf_switchover` | 1.1e-15 | pi_switch_failed |
| `kofn.group.n3k2_seta_crews1_switchover` | 4.4e-15 | pi_switch_failed |
| `kofn.group.n3k2_setb_crews1_reduction_to_v1` | 9.5e-15 | mttf_from_new |
| `parallel.firstorder.two_children` | 0.0e+00 | — |
| `standby.v2.n2_cold_crews_inf` | 8.5e-16 | mttf_from_new |
| `standby.v2.n3_warm_crews1` | 2.9e-15 | mttf_from_new |
| `subhealth.unit.tolerate_phi0.6` | 4.3e-16 | pi_Dm |
| `subhealth.unit.tolerate_phi0.8` | 4.3e-16 | pi_Dm |
| `subhealth.unit.isolate` | 1.1e-15 | pi_Hp |
| `subhealth.unit.p_sh_conversion` | 0.0e+00 | — |
| `subhealth.unit.reduction_to_degraded_unit` | 4.5e-17 | A_tolerant |
| `straggler.n1000` | 0.0e+00 | — |
| `straggler.n16384` | 0.0e+00 | — |
| `plane.p7_f0.3` | 0.0e+00 | — |
| `plane.p2_f0.5` | 0.0e+00 | — |
| `plane.p4_f0.2` | 0.0e+00 | — |
| `ladder.mindcluster_like` | 0.0e+00 | — |
| `waterfall.small_tree` | 7.6e-17 | gain |
| `cm384.counts` | 0.0e+00 | — |

## §10 Dual-path repair unit (`repair.unit.*`)

Built literally from the §10 table (three states, five rates). For c = 0 the state D_a has no inflow and is dropped by the reachability pass (pi_Da = 0 exactly); for c = s = 1 the same happens to D_m. Outputs: A = pi_U, E_R = c*T_a + (1 - c*s)*T_m, nu = up->down flux (= lambda*pi_U), auto_downtime_share = pi_Da/(pi_Da + pi_Dm), human_fraction = 1 - c*s. Asserted for every set: pi_U = 1/(1 + lambda*E_R) (see the identity table below), nu = lambda*pi_U, and pi_Da/(pi_Da + pi_Dm) = c*T_a/E_R.

| set | lambda | repair | A | E_R | nu | pi_Da | pi_Dm | auto share | human |
|---|---|---|---|---|---|---|---|---|---|
| A | 0.001 | {'c': 0.9, 's': 0.95, 'T_a': 0.1, 'T_m': 6.0} | 0.999040920716113 | 0.96 | 0.000999040920716113 | 8.99136828644501e-05 | 0.000869165601023018 | 0.09375 | 0.145 |
| B | 0.0002 | {'c': 0.0, 's': None, 'T_a': None, 'T_m': 24.0} | 0.995222929936306 | 24 | 0.000199044585987261 | 0 | 0.00477707006369427 | 0 | 1 |
| C | 0.005 | {'c': 1.0, 's': 1.0, 'T_a': 0.05, 'T_m': 8.0} | 0.999750062484379 | 0.05 | 0.00499875031242189 | 0.000249937515621095 | 0 | 1 | 0 |
| D | 0.01 | {'c': 0.6, 's': 0.5, 'T_a': 0.5, 'T_m': 48.0} | 0.746825989544436 | 33.9 | 0.00746825989544436 | 0.00224047796863331 | 0.250933532486931 | 0.00884955752212389 | 0.7 |

## §11 k-of-n group with dual repair and switchover (`kofn.group.*`)

States N(a, m) for all a, m >= 0 with a + m <= n (w = n - a - m working; up iff w >= k). When p_sw < 1, a switch-failed state S(a, m) (down) is created for every (a, m) with w - 1 >= k. Rates exactly as the §11 table: survivable failures (w - 1 >= k) split into w*lambda*c*p_sw -> (a+1, m), w*lambda*(1-c)*p_sw -> (a, m+1), w*lambda*(1-p_sw) -> S(a, m); non-survivable failures (w - 1 < k) w*lambda*c -> (a+1, m), w*lambda*(1-c) -> (a, m+1) (no switchover); automatic recoveries a*s/T_a -> (a-1, m) and a*(1-s)/T_a -> (a-1, m+1) (not crew-limited); manual repairs min(m, r)/T_m -> (a, m-1); S(a, m) -> (a, m+1) at 1/T_sf. Unreachable states (a > 0 when c = 0) are pruned. Outputs as in the formula field; MTTF from new = mean first passage from (0, 0) into the down set (S states included).

Cross-checks: (i) with unlimited crews and p_sw = 1 the n units are independent, so A must equal the binomial sum_(j<=n-k) C(n,j) u^j (1-u)^(n-j) with u = 1 - 1/(1 + lambda*E_R) (case 1 and the §17 G1 chains); (ii) case 6 reproduces the v1 birth-death chain (see the reduction table). Columns U_sw / sw freq / pi_S are zero for the p_sw = 1 cases by construction; the capacity columns of the switchover cases are informational only.

| case | states | A | nu | mttf_from_new | cap prop | cap frac | U_sw | sw freq | pi_S |
|---|---|---|---|---|---|---|---|---|---|
| n2k1_seta_crews_inf_psw1 | 6 | 0.999999080166927 | 1.91631890162937e-06 | 524683.427024776 | 0.999040920716113 | 0.999999080166927 | 0 | 0.0019961655225306 | 0 |
| n3k2_seta_crews1_psw1 | 10 | 0.999994974616817 | 5.74342997546353e-06 | 176010.195588847 | 0.999039409958964 | 0.999997485123904 | 0 | 0.00299136977888726 | 0 |
| n4k2_setd_crews2_psw1 | 15 | 0.918391990527916 | 0.00415859300272434 | 337.410246549955 | 0.729667665429006 | 0.953326923736929 | 0 | 0.0243294149502556 | 0 |
| n2k1_setb_crews_inf_switchover | 4 | 0.999897950193356 | 4.15171573614357e-05 | 24175.572519084 | 0.995223308429377 | 0.999977181409694 | 2.97117061269817e-06 | 0.00035654047352378 | 7.92312163386177e-05 |
| n3k2_seta_crews1_switchover | 11 | 0.999844084809607 | 0.000156677525371396 | 6451.89105278013 | 0.998788305206894 | 0.999996756230758 | 4.73205435685251e-05 | 0.0028392326141115 | 0.000149433295479553 |
| n3k2_setb_crews1_reduction_to_v1 | 4 | 0.999863087012717 | 5.67745601458325e-06 | 177777.777777778 | 0.995177293315348 | 0.999931216484892 | 0 | 0.000591401668185755 | 0 |

## §12 Parallel with switchover, first order (`parallel.firstorder.two_children`)

Each child is a two-state unit: A_i = 1/(1 + lambda_i T_i), U_i = 1 - A_i, nu_i = lambda_i A_i. U_perfect = U_1 U_2; the two penalties are sum nu_i (1 - p_sw) T_sf and sum nu_i p_sw t_sw/3600 (t_sw = 20 s -> 1/180 h).

| lambda | T | A_i | U_i | nu_i |
|---|---|---|---|---|
| 1e-3 | 5 | 0.995024875621891 | 0.00497512437810945 | 0.00099502487562189 |
| 4e-4 | 12 | 0.995222929936306 | 0.00477707006369427 | 0.000398089171974522 |

U_perfect = 2.37665177298222e-05, penalty_switch_failure = 0.000125380264283677, penalty_micro_outage = 7.50733681204734e-06, U_approx = 0.000156654118825547.

## §13 Standby with switchover (`standby.v2.*`)

Built from the chain description given with the task (the spec text of §13 only names the two v2 changes): states j = failed units 0..n, up iff j <= n-1; switch-down states SW_j for j = 0..n-1; from j < n: standby failures (n-1-j) f lambda -> j+1, active failure lambda p_sw -> j+1 and lambda (1-p_sw) -> SW_j; repairs j -> j-1 at min(j, crews) mu; SW_j -> j+1 at 1/T_sf. The literal reading keeps SW_(n-1) (an active failure with no standby left can still 'fail to switch' and then waits T_sf before the repair of the last unit starts). The alternative reading (no SW_(n-1)) is tabulated for diagnosis; the MTTF is the same under both readings because both exits from j = n-1 are down.

| case | states | A | nu | U_sw | mttf_from_new | A (no SW_(n-1)) | nu (no SW_(n-1)) |
|---|---|---|---|---|---|---|---|
| n2_cold_crews_inf | 5 | 0.999937566087292 | 5.47229513779115e-05 | 2.6255961519705e-06 | 18359.0909090909 | 0.999937814812512 | 5.47229649897394e-05 |
| n3_warm_crews1 | 7 | 0.999200507430728 | 0.00019989957498368 | 0 | 4998.71776200396 | 0.999200533842261 | 0.000199899580267559 |

## §14 Sub-health unit (`subhealth.unit.*`)

Six states U, H, H', I, D_a, D_m with the rates of the §14 table; the isolate-only rows (H -> I, H -> H', H' -> *, I -> *) are added only for policy isolate, and the reachability pass removes H', I under tolerate and D_a under c = 0. Measures are read off pi: A_strict = pi_U, A_tolerant = pi_U + pi_H + pi_H', A_perf = pi_U + phi (pi_H + pi_H'), A_threshold = pi_U + [phi >= phi_min](pi_H + pi_H'). nu_threshold is the probability flux out of the threshold up-set ({U} when phi < phi_min, {U, H, H'} otherwise) into its complement, as the spec defines the failure frequency; under the strict reading this flux includes the U -> H entries. nu_iso = pi_H p_d/T_d; p_H_given_not_down = (pi_H + pi_H')/(pi_U + pi_H + pi_H'). p_sh -> lambda_sh conversion: lambda_sh = p_sh/((1 - p_sh) D).

| case | pi_U | pi_H | pi_H' | pi_I | pi_Da | pi_Dm | A_perf | A_threshold | nu_threshold | nu_iso | p_H|not down |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tolerate_phi0.6 | 0.986154547311845 | 0.00982225644732913 | 0 | 0 | 0 | 0.00402319624082601 | 0.992047901180242 | 0.986154547311845 | 0.00591692728387107 | 0 | 0.00986193293885602 |
| tolerate_phi0.8 | 0.986154547311845 | 0.00982225644732913 | 0 | 0 | 0 | 0.00402319624082601 | 0.994012352469708 | 0.995976803759174 | 0.0010057990602065 | 0 | 0.00986193293885602 |
| isolate | 0.996081647144507 | 0.000242923043396866 | 0.000967820890027353 | 0.000437261478114358 | 8.9865282151022e-05 | 0.00218048216180295 | 0.996808093504562 | 0.996081647144507 | 0.00597648988286704 | 0.00437261478114358 | 0.0012140310547397 |
| reduction_to_degraded_unit | 0.993041274424453 | 0.00297466183052757 | 0 | 0 | 0 | 0.00398406374501992 | 0.994528605339716 | 0.993041274424453 | 0.00297912382327336 | 0 | 0.00298656047784968 |

## §14 Straggler law (`straggler.*`)

P(job slowed) = 1 - (1 - p_H)^N, E[phi_job] = 1 - P(slowed)(1 - phi), phi = 0.6.

| N | p_H | p_slowed | phi_job |
|---|---|---|---|
| 1000 | 0.001 | 0.632304575229036 | 0.747078169908386 |
| 16384 | 0.0002 | 0.96226350907775 | 0.6150945963689 |

## §15 Fabric plane loss (`plane.*`)

step_time_factor = 1 + f_comm/(P - 1), phi_plane = its reciprocal (CloudMatrix384: P = 7, f = 0.3 -> 0.952).

| P | f_comm | step_time_factor | phi_plane |
|---|---|---|---|
| 7 | 0.3 | 1.05 | 0.952380952380952 |
| 2 | 0.5 | 1.5 | 0.666666666666667 |
| 4 | 0.2 | 1.06666666666667 | 0.9375 |

## §16 Recovery ladder (`ladder.mindcluster_like`)

P_1 = 1, P_i = prod_(j<i)(1 - s_j); E[T] = sum P_i t_i; share_i = P_i t_i / E[T]; p_manual = P at the first manual rung; auto_mean_s / manual_mean_s = the unconditional contributions of the auto / manual rungs to E[T].

| rung | kind | s | t (s) | P_i | P_i t_i | share |
|---|---|---|---|---|---|---|
| 1 | auto | 0.2 | 20 | 1 | 20 | 0.0366246703779666 |
| 2 | auto | 0.3 | 120 | 0.8 | 96 | 0.17579841781424 |
| 3 | auto | 0.8 | 300 | 0.56 | 168 | 0.307647231174919 |
| 4 | auto | 0.9 | 900 | 0.112 | 100.8 | 0.184588338704952 |
| 5 | manual | 1.0 | 14400 | 0.0112 | 161.28 | 0.295341341927923 |

E[T] = 546.08 s, p_manual = 0.0112, auto_mean_s = 384.8, manual_mean_s = 161.28.

## §17 Waterfall (`waterfall.small_tree`) — every intermediate

Tree: series[G1 = kofn(3, 2, X), B, G2 = parallel(C1, C2)]. X: lambda = 1e-3, repair c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, sub-health lambda_sh = 2e-3, D = 1, phi = 0.5, m = 1, tolerate, phi_min = 0.7. B: lambda = 5e-5, T_m = 24. C1 = C2: lambda = 2e-4, T_m = 8, G2 switchover p_sw = 0.95, T_sf = 2, t_sw = 0. G1: crews unlimited, no switchover (assumptions, see ambiguities).

Step 0 (original): every leaf becomes a two-state unit with lambda_o = lambda + lambda_sh and E[R_o] = (lambda T_m + lambda_sh D)/(lambda + lambda_sh); kofn -> 3 copies of X_o in series, parallel -> C1_o and C2_o in series.
Step 1 (+ redundancy): structure restored; X's §14 chain with c = 0 (manual only), measured strict -> (A, nu) -> lambda_eq = nu/A, MTTR_eq = (1 - A)/nu; G1 = §11 chain(3, 2, lambda_eq, c = 0, T_m = MTTR_eq, crews = inf, p_sw = 1) (= v1 birth-death, = binomial); G2 = §12 first order with the configured switchover; B unchanged.
Step 2 (+ automatic recovery): X's §14 chain with the configured dual repair, measured strict -> lambda_eq (= lambda + lambda_sh exactly, since under the strict measure every exit from U is a failure); G1 = §11 chain(3, 2, lambda_eq, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, crews = inf, p_sw = 1) as instructed ('lambda_eq from its own §14 chain and the configured dual repair parameters'). The alternative reading that keeps the equivalent two-state unit (c = 0, T_m = MTTR_eq) is tabulated as [alt].
Step 3 (+ sub-health policy): X measured by the threshold rule; phi = 0.5 < phi_min = 0.7 so the up-set is {U} and step 3 = step 2. Switchover penalty = A(step 3, p_sw = 1, t_sw = 0) - A(step 3); gain = A_step3 - A_step0. Performability at step 3 is also listed.

**step 0 (original)**

| quantity | value |
|---|---|
| lambda_o_X | 0.003 |
| E_R_o_X | 2.6666666666666665 |
| A_Xo | 0.9920634920634921 |
| A_G1 (3 copies in series) | 0.9763789407591373 |
| A_B | 0.9988014382740711 |
| A_C (each) | 0.9984025559105432 |
| A_G2 (series of C1, C2) | 0.9968076636487052 |
| A_system | 0.972095496178499 |

**step 1 (+ redundancy)**

| quantity | value |
|---|---|
| X unit chain | §14, c = 0, T_m = 6, measure strict |
| A_X (strict) | 0.9920536600932788 |
| nu_X | 0.0029761609802798363 |
| lambda_eq_X | 0.003 |
| MTTR_eq_X | 2.66999666999667 |
| G1 chain | §11 n=3 k=2, lambda = lambda_eq, c = 0, T_m = MTTR_eq, crews = inf, p_sw = 1 |
| A_G1 | 0.9998115705786872 |
| A_G1 [alt: c = 0, T_m = 6 configured] | 0.9990731255479119 |
| A_B | 0.9988014382740711 |
| U_G2 (first order, p_sw = 0.95) | 4.248792985536241e-05 |
| A_G2 | 0.9999575120701446 |
| A_system | 0.9985708056879823 |
| A_system [alt] | 0.9978332770665534 |

**step 2 (+ automatic recovery)**

| quantity | value |
|---|---|
| X unit chain | §14, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, measure strict |
| A_X (strict) | 0.9970488151912549 |
| nu_X | 0.0029911464455737646 |
| lambda_eq_X | 0.003 |
| MTTR_eq_X | 0.9866400266400266 |
| E_R configured (c*T_a+(1-c*s)*T_m) | 0.96 |
| G1 chain | §11 n=3 k=2, lambda = lambda_eq, c = 0.9, s = 0.95, T_a = 0.1, T_m = 6, crews = inf, p_sw = 1 |
| A_G1 | 0.9999753068757553 |
| A_G1 [alt: two-state (lambda_eq, MTTR_eq), c = 0] | 0.9999739229313135 |
| A_B | 0.9988014382740711 |
| A_G2 | 0.9999575120701446 |
| A_system | 0.9987343387885135 |
| A_system [alt] | 0.998732956561545 |

**step 3 (+ sub-health policy) = compensated**

| quantity | value |
|---|---|
| X unit chain | §14 as step 2, measure threshold (phi = 0.5 < phi_min = 0.7 -> same as strict) |
| A_X (threshold) | 0.9970488151912549 |
| nu_X | 0.0029911464455737646 |
| lambda_eq_X | 0.003 |
| MTTR_eq_X | 0.9866400266400266 |
| A_G1 | 0.9999753068757553 |
| A_B | 0.9988014382740711 |
| A_G2 (p_sw = 0.95) | 0.9999575120701446 |
| A_G2 (p_sw = 1, t_sw = 0) | 0.999997448172381 |
| A_system | 0.9987343387885135 |
| A_system (p_sw = 1, t_sw = 0) | 0.9987742260399011 |
| switchover_penalty | 3.9887251387622205e-05 |
| gain = A_step3 - A_step0 | 0.026638842610014462 |
| A_X (performability measure) | 0.9980448679536837 |
| lambda_eq_X (perf) | 0.001000998003992016 |
| MTTR_eq_X (perf) | 1.9570089730807578 |
| A_G1 (perf) | 0.9999972367650123 |
| A_system (performability at step 3) | 0.9987562414628057 |


## CloudMatrix384 counts (`cm384.counts`)

npus = 384, l1_chips = 336, l2_chips = 112, l1_l2_links = 5376, links_per_subplane = 768 = l2_ports_per_subplane = 768, transceiver_ends = 10752.

## Identity and reduction checks

| check | abs diff | rel diff |
|---|---|---|
| §10 set A: pi_U = 1/(1 + lambda*E[R]) | 0.0e+00 | 0.0e+00 |
| §10 set A: nu (flux) = lambda*pi_U | 0.0e+00 | 0.0e+00 |
| §10 set A: pi_Da/(pi_Da+pi_Dm) = c*T_a/E[R] | 4.3e-42 | 4.6e-41 |
| §10 set B: pi_U = 1/(1 + lambda*E[R]) | 1.1e-41 | 1.2e-41 |
| §10 set B: nu (flux) = lambda*pi_U | 0.0e+00 | 0.0e+00 |
| §10 set B: pi_Da/(pi_Da+pi_Dm) = c*T_a/E[R] | 0.0e+00 | 0.0e+00 |
| §10 set C: pi_U = 1/(1 + lambda*E[R]) | 1.1e-41 | 1.1e-41 |
| §10 set C: nu (flux) = lambda*pi_U | 0.0e+00 | 0.0e+00 |
| §10 set C: pi_Da/(pi_Da+pi_Dm) = c*T_a/E[R] | 0.0e+00 | 0.0e+00 |
| §10 set D: pi_U = 1/(1 + lambda*E[R]) | 1.1e-41 | 1.5e-41 |
| §10 set D: nu (flux) = lambda*pi_U | 0.0e+00 | 0.0e+00 |
| §10 set D: pi_Da/(pi_Da+pi_Dm) = c*T_a/E[R] | 0.0e+00 | 0.0e+00 |
| §11 n2k1_seta_crews_inf_psw1: A = binomial product form (crews=inf, p_sw=1), u = 1-1/(1+lambda*E_R) | 0.0e+00 | 0.0e+00 |
| §11 reduction n3k2_setb_crews1_reduction_to_v1: A (§11, c=0, p_sw=1) vs v1 birth-death | 0.0e+00 | 0.0e+00 |
| §11 reduction n3k2_setb_crews1_reduction_to_v1: nu | 0.0e+00 | 0.0e+00 |
| §11 reduction n3k2_setb_crews1_reduction_to_v1: mttf_from_new | 0.0e+00 | 0.0e+00 |
| §11 reduction n3k2_setb_crews1_reduction_to_v1: nu = pi_(w=k)*k*lambda | 8.8e-47 | 1.5e-41 |
| §14 reduction (m=1, c=0, tolerate): A_tolerant vs three-state chain | 0.0e+00 | 0.0e+00 |
| §14 reduction (m=1, c=0, tolerate): A_perf vs three-state chain | 0.0e+00 | 0.0e+00 |
| §16 ladder: sum of shares = 1 | 0.0e+00 | 0.0e+00 |
| §16 ladder: auto_mean_s + manual_mean_s = E_T_s | 0.0e+00 | 0.0e+00 |
| §17 G1 chain (lambda_eq=0.003, c=0.0, T_m=2.67): product-form binomial | 1.1e-41 | 1.1e-41 |
| §17 G1 chain (lambda_eq=0.003, c=0.0, T_m=6): product-form binomial | 0.0e+00 | 0.0e+00 |
| §17 G1 chain (lambda_eq=0.003, c=0.9, T_m=6): product-form binomial | 1.1e-41 | 1.1e-41 |
| §17 G1 chain (lambda_eq=0.003, c=0.0, T_m=0.98664): product-form binomial | 0.0e+00 | 0.0e+00 |
| §17 G1 chain (lambda_eq=0.003, c=0.9, T_m=6): product-form binomial | 1.1e-41 | 1.1e-41 |
| §17 G1 chain (lambda_eq=0.001001, c=0.9, T_m=6): product-form binomial | 1.1e-41 | 1.1e-41 |
| §17 step 3 = step 2 (phi < phi_min: threshold measure is strict) | 0.0e+00 | 0.0e+00 |
| CM384: links_per_subplane = l2_ports_per_subplane | 0.0e+00 | 0.0e+00 |

Largest relative difference over all checks: 4.6e-41 (40-digit arithmetic; anything below 1e-30 is roundoff). The two reduction cases (`kofn.group.n3k2_setb_crews1_reduction_to_v1`, `subhealth.unit.reduction_to_degraded_unit`) carry the classic chain's values in their notes (and, for k-of-n, as `*_classic` expected keys).

## Ambiguities in the specification and the reading used

1. **§11 capacity of switch-failed states.** The spec defines w = n - a - m for (a, m) and says capacity `proportional` = w/n, `fractional` = min(1, w/k), but does not say what w is in S(a, m), where one more unit has failed and nothing has been repaired. I let S(a, m) inherit w = n - a - m (literal reading); the physically stricter choices would be w - 1 or 0 (group down). No expected value depends on this: the capacity keys are only requested for the p_sw = 1 cases, which have no S states (the switchover cases list their capacity under this reading in the notes, for information).
2. **§11 behaviour inside S(a, m).** The table lists a single exit S(a, m) -> (a, m+1) at 1/T_sf. I followed it literally: while the switch failure is being recovered, the ongoing automatic/manual repairs of the other units and further failures are frozen. The failed unit then enters manual repair regardless of c.
3. **§13 SW_(n-1).** The chain description given with the task defines SW_j for j = 0..n-1, i.e. an active failure with no standby left (j = n-1) can still 'fail to switch' and waits T_sf before the last repair starts; the spec's own U_sw sums only j <= n-2 ('a switch happens only while a standby exists'). I used the literal reading (SW_(n-1) present); the alternative values are in the notes of each standby case and in the §13 table (MTTF is identical; A and nu differ).
4. **§14 failure frequency under the strict/threshold measure.** 'Flux from the up set (threshold rule) into the down set' makes every U -> H entry a failure when phi < phi_min. Used as written; nu_threshold for phi >= phi_min counts only transitions into I/D_a/D_m.
5. **§16 manual_mean_s.** Taken as the unconditional contribution sum_(manual rungs) P_i t_i (161.28 s), so that auto_mean_s + manual_mean_s = E[T]; the conditional mean given a person is needed would be 14400 s.
6. **§17 G1 at steps 2-3.** The task says to use the unit's lambda_eq (= nu/A from X's §14 chain) together with the *configured* dual repair (c, s, T_a, T_m) in the §11 chain, while step 1 uses the equivalent two-state unit (c = 0, T_m = MTTR_eq). Under the strict measure lambda_eq = lambda + lambda_sh exactly, but the configured E_R = 0.96 h differs from the unit's MTTR_eq = 0.98664 h (sub-health episodes last D = 1 h, not a dual repair), so the two readings give different A_step2/A_step3 (about 1.4e-6 relative, i.e. at the tolerance); both are in the waterfall table and the case notes. Primary = configured repair (as instructed).
7. **§17 G1 crews.** Not configured for kofn(3, 2, X); I used unlimited repair (the v1 k-of-n default, §2 table). G1 has no switchover (p_sw = 1, t_sw = 0); only G2 does.
8. **§17 MTBF/MTTR ratios between steps 0 and 3** (mentioned in §17) are not requested and not computed; only A per step, the switchover penalty and the availability gain are.
9. **Legacy repair in the §11/§14 chains.** With c = 0 the states with a > 0 (resp. D_a) are unreachable; s and T_a are then irrelevant and are written as null in the JSON inputs. Structurally zero expected values (pi_Da for c = 0, pi_Dm for c = s = 1, U_sw for t_sw = 0) carry an additional `tolerance.abs = 1e-12` because a relative test cannot be applied to 0.

## JSON conventions

`inputs` are hours / per hour except keys ending in `_s` (seconds); `crews: null` = unlimited; a legacy manual-only repair has `c = 0` and `s = T_a = null`. `tolerance.rel` = 1e-9 for CTMC and closed-form quantities, 1e-6 for the first-order §12 formula and the §17 waterfall that contains it; `tolerance.abs` appears only on cases with structurally zero entries. `expected.reach` and `expected.share` of the ladder case are arrays in rung order. `*_classic` keys of the k-of-n reduction case are the v1 one-dimensional chain's values (they must equal the §11 values).
