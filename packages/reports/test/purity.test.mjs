/** The recipes are pure: no file system, process or clock access in the package sources (katex-node.mjs reads only katex's own files). */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));

describe('purity', () => {
  for (const f of files) {
    it(f, () => {
      const s = readFileSync(new URL(f, dir), 'utf8');
      expect(s).not.toMatch(/process\.(cwd|argv|env)|Date\.now|new Date\(\)|writeFileSync/);
      const reads = s.match(/readFileSync\([^)]*/g) ?? [];
      if (f === 'katex-node.mjs') for (const r of reads) expect(r).toMatch(/readFileSync\(join\(KATEX_DIR,/);
      else expect(reads).toEqual([]);
    });
  }
});
