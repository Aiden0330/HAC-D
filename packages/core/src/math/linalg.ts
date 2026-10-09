/** Small dense / banded linear algebra for CTMC solvers. */

/**
 * Thomas algorithm for a tridiagonal system.
 * sub[i] multiplies x[i−1], diag[i] multiplies x[i], sup[i] multiplies x[i+1].
 * Arrays are modified in place; returns the solution vector.
 */
export function solveTridiagonal(sub: Float64Array, diag: Float64Array, sup: Float64Array, rhs: Float64Array): Float64Array {
  const n = diag.length;
  const x = new Float64Array(n);
  if (n === 0) return x;
  for (let i = 1; i < n; i++) {
    const w = sub[i] / diag[i - 1];
    diag[i] -= w * sup[i - 1];
    rhs[i] -= w * rhs[i - 1];
  }
  x[n - 1] = rhs[n - 1] / diag[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = (rhs[i] - sup[i] * x[i + 1]) / diag[i];
  return x;
}

/**
 * Solve A x = b for dense A (row-major Float64Array n×n) with partial pivoting.
 * A and b are copied; the inputs are not modified.
 */
export function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const a = new Float64Array(A);
  const x = new Float64Array(b);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let col = 0; col < n; col++) {
    // pivot
    let best = col;
    let bestVal = Math.abs(a[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * n + col]);
      if (v > bestVal) {
        bestVal = v;
        best = r;
      }
    }
    if (bestVal === 0) throw new Error('solveDense: singular matrix');
    if (best !== col) {
      for (let c = 0; c < n; c++) {
        const t = a[col * n + c];
        a[col * n + c] = a[best * n + c];
        a[best * n + c] = t;
      }
      const tb = x[col];
      x[col] = x[best];
      x[best] = tb;
    }
    const inv = 1 / a[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col] * inv;
      if (f === 0) continue;
      a[r * n + col] = 0;
      for (let c = col + 1; c < n; c++) a[r * n + c] -= f * a[col * n + c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= a[r * n + c] * x[c];
    x[r] = s / a[r * n + r];
  }
  return x;
}
