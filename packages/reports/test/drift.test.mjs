/** The two verbatim copies in the package must not drift from their sources in scripts/ until those scripts are retired. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASE_CSS } from '../src/base-css.mjs';

const REPO = new URL('../../../', import.meta.url);
const src = (rel) => readFileSync(new URL(rel, REPO), 'utf8');
/** the span from `export const esc` up to (not including) `export const svgOpen` */
const span = (s) => { const a = s.indexOf('export const esc = '), b = s.indexOf('export const svgOpen = '); expect(a).toBeGreaterThanOrEqual(0); return s.slice(a, b >= 0 ? b : undefined).trimEnd(); };

describe('verbatim copies', () => {
  it('BASE_CSS equals the css literal of scripts/build-ascend950-scaling.mjs', () => {
    expect(BASE_CSS).toBe(src('scripts/build-ascend950-scaling.mjs').match(/const css = `([\s\S]*?)`;\n/)[1]);
  });
  it('svg-base.mjs equals the primitives of scripts/ascend950-figures.mjs (esc … STYLE)', () => {
    expect(span(readFileSync(new URL('../src/svg-base.mjs', import.meta.url), 'utf8'))).toBe(span(src('scripts/ascend950-figures.mjs')));
  });
});
