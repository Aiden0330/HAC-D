/**
 * Node side of the KaTeX embedding: the fonts and katex.min.css read from the installed katex package (located from this file,
 * never from the working directory) and registered with the kit (setKatexCss). Imported by the Node entry index.mjs; a browser
 * build (@hac-d/reports/browser) fetches the same files through its bundler and registers them itself.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { KATEX_FONTS, katexCssFrom, setKatexCss } from './kit.mjs';

const KATEX_DIR = dirname(createRequire(import.meta.url).resolve('katex/package.json'));
export const KATEX_CSS = katexCssFrom(
  KATEX_FONTS.map(([family, style, file]) => ({ family, style, base64: readFileSync(join(KATEX_DIR, 'dist', 'fonts', `${file}.woff2`)).toString('base64') })),
  readFileSync(join(KATEX_DIR, 'dist', 'katex.min.css'), 'utf8'),
);
setKatexCss(KATEX_CSS);
