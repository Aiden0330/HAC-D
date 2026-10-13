/**
 * Reproduce the reference engine's version-1 closed form (集群可用度建模分析报告.html, 第一版模型说明.md) with HAC-D's
 * exact renewal goodput and operational availability. Needs the untracked drop ai-cluster-reliability-main/ (its
 * 数值验证结果.json holds the published per-scale values). Usage: node --import tsx scripts/ref-compare-v1.ts
 */
import { readFileSync } from 'node:fs';
import { renewalGoodput, operationalAvailability } from '@hac-d/core';

const file = new URL('../ai-cluster-reliability-main/数值验证结果.json', import.meta.url);
const v1 = JSON.parse(readFileSync(file, 'utf8')) as { keyScales: Array<{ n: number; baselineGlobal: { tor: number; uptime: number } }> };
// V1 defaults (集群可用度建模分析报告.html:219): detect 10 s, recover 900 s, interval 7200 s, save 10 s,
// sub-health 2 % of the hard rate, 24 h, 5 % loss, 0 % detected; 3333.33 FIT per card (10k cards → 30 h)
const tauS = 7200, deltaS = 10, restartS = 10 + 900;
let worst = 0;
console.log('cards     V1 TOR      HAC-D renewal×S   V1 A        HAC-D A_op');
for (const row of v1.keyScales) {
  const mtbiS = (30 * 10000 / row.n) * 3600;
  const slowFactor = Math.exp(-(1 / mtbiS) * 0.02 * 24 * 3600 * 0.05);
  const tor = renewalGoodput(tauS, deltaS, mtbiS, restartS) * slowFactor;
  const aOp = operationalAvailability(mtbiS, restartS);
  worst = Math.max(worst, Math.abs(tor - row.baselineGlobal.tor), Math.abs(aOp - row.baselineGlobal.uptime));
  console.log(String(row.n).padStart(7), (100 * row.baselineGlobal.tor).toFixed(4).padStart(9), '%', (100 * tor).toFixed(4).padStart(12), '%', (100 * row.baselineGlobal.uptime).toFixed(4).padStart(10), '%', (100 * aOp).toFixed(4).padStart(10), '%');
}
console.log(`max |difference| ${worst.toExponential(2)} (V1 TOR = A·τ/L·z/(e^z−1)·S equals HAC-D's exact renewal λτ/[(e^{λL}−1)(1+λR)]·S)`);
