// Run the reference audited engine (ai-cluster-reliability-main, catalogs/review-2026-10-09) at several scales and stages.
// Usage: node scripts/ref-run.cjs [trials]
const path = require('node:path');
const dir = path.join(__dirname, '..', 'ai-cluster-reliability-main', 'catalogs', 'review-2026-10-09');
const E = require(path.join(dir, 'engine.cjs'));
const trials = Number(process.argv[2] ?? 400);
function stats(xs) { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)); return { mean: m, se: sd / Math.sqrt(n) }; }
const t0 = Date.now();
for (const cards of [100000, 200000, 500000]) {
  for (const stage of [0, 1, 2]) {
    const A = [], U = [], down = [], roll = [], slow = [], term = [], save = [];
    for (let i = 0; i < trials; i++) {
      const r = E.simulate(cards, stage, (20261009 + Math.imul(i + 1, 2654435761) + cards) >>> 0);
      A.push(r.operationalAvailability); U.push(r.usefulThroughput);
      down.push(r.ledger.downtime / 720); roll.push(r.ledger.rollback / 720); slow.push(r.ledger.slowdown / 720); term.push(r.ledger.terminalInvalid / 720); save.push(r.ledger.save / 720);
    }
    const a = stats(A), u = stats(U);
    console.log(JSON.stringify({ cards, stage, trials, operational: +a.mean.toFixed(5), operational_se: +a.se.toFixed(5), useful: +u.mean.toFixed(5), useful_se: +u.se.toFixed(5), downtime: +stats(down).mean.toFixed(5), save: +stats(save).mean.toFixed(5), rollback: +stats(roll).mean.toFixed(5), slowdown: +stats(slow).mean.toFixed(5), terminalInvalid: +stats(term).mean.toFixed(5) }));
  }
}
console.log('elapsed s', ((Date.now() - t0) / 1000).toFixed(1));
