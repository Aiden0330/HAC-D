import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REPO, cases, firstDiff } from './reproduce.mjs';

describe('the recipes regenerate the six v4.4 reports byte-for-byte', () => {
  for (const [file, render] of cases()) {
    it(file, () => {
      const d = firstDiff(render(), readFileSync(REPO + file, 'utf8'));
      if (d) console.error(`${file}: ${d}`);
      expect(d).toBeNull();
    });
  }
});
