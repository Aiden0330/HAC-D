/**
 * v6.3 the KaTeX CSS the report pages embed, assembled in the browser: katex.min.css and the eight fonts of the installed katex
 * package come through the bundler (?raw / ?url), the fonts are fetched once and registered with the report kit (setKatexCss) —
 * what katex-node.mjs does from the file system under Node. Called by the worker before the first page is rendered.
 */
import { KATEX_FONTS, katexCssFrom, setKatexCss } from '@hac-d/reports/browser';
import minCss from 'katex/dist/katex.min.css?raw';
import fMain from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?url';
import fMath from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?url';
import fSize1 from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?url';
import fSize2 from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?url';
import fSize3 from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?url';
import fSize4 from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?url';
import fCal from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url';
import fAms from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?url';

const URLS: Record<string, string> = {
  'KaTeX_Main-Regular': fMain, 'KaTeX_Math-Italic': fMath, 'KaTeX_Size1-Regular': fSize1, 'KaTeX_Size2-Regular': fSize2,
  'KaTeX_Size3-Regular': fSize3, 'KaTeX_Size4-Regular': fSize4, 'KaTeX_Caligraphic-Regular': fCal, 'KaTeX_AMS-Regular': fAms,
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let ready: Promise<void> | null = null;
/** register the KaTeX CSS once (a failed fetch is retried on the next call) */
export function ensureKatexCss(): Promise<void> {
  ready ??= (async () => {
    const fonts = await Promise.all(KATEX_FONTS.map(async ([family, style, file]) => {
      const url = URLS[file];
      if (!url) throw new Error(`no bundled KaTeX font for ${file}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`KaTeX font ${file}: HTTP ${res.status}`);
      return { family, style, base64: toBase64(await res.arrayBuffer()) };
    }));
    setKatexCss(katexCssFrom(fonts, minCss));
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
