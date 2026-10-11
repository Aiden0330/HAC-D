// Build the self-contained user manual: inline the images of docs/manual/img into docs/manual/USER_MANUAL.src.html → docs/USER_MANUAL.html.
// Regenerate the images first with `npm run shots` and `uv run --with pillow python scripts/manual-images.py shots docs/manual/img`.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, '..', 'docs', 'manual', 'USER_MANUAL.src.html');
const outPath = join(here, '..', 'docs', 'USER_MANUAL.html');
let html = readFileSync(srcPath, 'utf8');
let n = 0;
html = html.replace(/src="img\/([a-z0-9-]+\.(jpg|png))"/g, (_m, file, ext) => {
  const p = join(here, '..', 'docs', 'manual', 'img', file);
  const b64 = readFileSync(p).toString('base64');
  n++;
  return `src="data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${b64}"`;
});
writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(statSync(outPath).size / 1024).toFixed(0)} kB, ${n} images inlined)`);
