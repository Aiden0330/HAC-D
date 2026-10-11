// Build the self-contained user manuals (en and zh): inline the images of docs/manual/img{,-zh} into the sources.
// Regenerate images: `npm run shots` / `node scripts/screenshots.mjs shots-zh zh`, then `uv run --with pillow python scripts/manual-images.py <shots dir> <img dir>`.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const builds = [
  { src: 'USER_MANUAL.src.html', img: 'img', out: 'USER_MANUAL.html' },
  { src: 'USER_MANUAL.zh.src.html', img: 'img-zh', out: 'USER_MANUAL.zh.html' },
];
for (const b of builds) {
  const srcPath = join(here, '..', 'docs', 'manual', b.src);
  const outPath = join(here, '..', 'docs', b.out);
  let html = readFileSync(srcPath, 'utf8');
  let n = 0;
  html = html.replace(/src="img(?:-zh)?\/([a-z0-9-]+\.(jpg|png))"/g, (_m, file, ext) => {
    const b64 = readFileSync(join(here, '..', 'docs', 'manual', b.img, file)).toString('base64');
    n++;
    return `src="data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${b64}"`;
  });
  writeFileSync(outPath, html);
  console.log(`wrote ${outPath} (${(statSync(outPath).size / 1024).toFixed(0)} kB, ${n} images inlined)`);
}
