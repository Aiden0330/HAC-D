/**
 * Parameters of the latest ReMAP's 16 extensions (remap/remap-latest, commit eaacb0578a30027c480046de6b91e6f434dfa15e of 2026-10-15) mapped to
 * HAC-D's mechanism parameters: ReMAP's explicit `extensionScenario()` (eligible share 100 % of the candidate events, FP8 / FP4 50 % of the
 * CORE silent risk each, success 95 %, failure attempt 0 s, overhead 0, ABFT 0.1 %) with the per-mechanism targets of its parameter sets.
 * Eligibility x success is folded into the parameters by expectation where the transform is deterministic (startup stages at 95 %
 * eligibility, async blocking 4 x 5 % + 1 x 95 % = 1.15 s, manual probability 95 % x 0.1 % + 5 % x 1 %). Shared by
 * scripts/remap-latest-allocation-98p5.ts and scripts/agree-allocation-98p5.ts.
 */
/** ReMAP-latest extensionScenario(): eligible 1 (FP8/FP4 0.5), success 0.95, failure 0, overhead 0 (ABFT 0.001) + parameterSets, mapped to HAC-D's parameters */
export const REMAP_LATEST_PARAMS: Record<string, Record<string, number>> = {
  'R-LINK-LOCAL': { successSeconds: 2, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'R-FABRIC-DEGRADE': { switchSeconds: 2, exposedCommunicationFraction: 0.3, remainingBandwidthRatio: 0.75, repairSeconds: 1800, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'H-CONTROL-CONTINUITY': { pauseSeconds: 1, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'R-WARM-PROCESS': { startupTargetSeconds: 20, eligibleShare: 0.95 },
  'R-RUNTIME-SNAPSHOT': { startupTargetSeconds: 15, eligibleShare: 0.95 },
  'R-CANN-GRAPH': { graphTargetSeconds: 7.5, eligibleShare: 0.95 },
  'C-ASYNC': { blockingTargetSeconds: 4 * 0.05 + 1 * 0.95, durableLagSeconds: 10 },
  'C-LOSSLESS': { compressionRatio: 2, decompressSeconds: 10, share: 0.95 },
  'D-RECOVERY-CLASSIFY': { manualProbabilityTarget: 0.001, eligibleShare: 1, success: 0.95 },
  'D-SDC-FP8': { detectionTarget: 0.95, detectSeconds: 1, riskShare: 0.5 * 0.95 },
  'D-SDC-FP4': { detectionTarget: 0.95, detectSeconds: 1, riskShare: 0.5 * 0.95 },
  'D-ABFT': { upstreamDetection: 0.95, conditionalMissDetection: 0.9 * 0.95, overhead: 0.001 },
  'D-NET-SDC': { detectionTarget: 0.95 * 0.95, detectSeconds: 1 },
  'H-SDC-SCREEN': { occurrenceReduction: 0.25, eligibleShare: 0.95 },
  'R-HCCL-ELASTIC': { communicationBeforeSeconds: 60, communicationTargetSeconds: 15, share: 0.95 },
};
