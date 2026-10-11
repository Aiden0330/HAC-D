// Render docs/USER_MANUAL.html with Playwright at 1280 and 375 px, light and dark; report overflow and save screenshots to shots/manual-*.png.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
mkdirSync('shots', { recursive: true });
const url = pathToFileURL(resolve('docs/USER_MANUAL.html')).href;
const browser = await chromium.launch();
for (const [tag, w, h] of [['desktop', 1280, 900], ['mobile', 375, 812]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const imgs = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length);
    await page.screenshot({ path: `shots/manual-${tag}-${theme}.png`, fullPage: tag === 'mobile' ? false : false });
    await page.screenshot({ path: `shots/manual-${tag}-${theme}-full.png`, fullPage: true });
    console.log(`manual ${tag} ${theme}: ${overflow ? 'HORIZONTAL OVERFLOW' : 'ok'}; broken images ${imgs}; errors ${errors.length}`);
    await ctx.close();
  }
}
await browser.close();
