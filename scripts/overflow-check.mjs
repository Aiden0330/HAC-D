// Report the innermost elements wider than a 375 px viewport on each page (dev server at :5173).
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
// v5.9: the full navigation (minimal mode hides the Scenario editor and Inference pages) in the English UI, as scripts/screenshots.mjs does
await page.evaluate(() => { localStorage.removeItem('hacd-scenarios-v1'); localStorage.removeItem('hacd-projects-v1'); localStorage.setItem('hacd-ui-mode', 'full'); localStorage.setItem('hacd-lang', 'en'); });
await page.reload({ waitUntil: 'networkidle' });
// v5.9: the eight pages of the v5.2 navigation (English UI); Projects is the landing page
for (const name of ['Projects', 'Topology & hardware', 'Allocation', 'Mechanism library', 'Fault library', 'Review', 'Scenario editor', 'Inference & spares']) {
  await page.locator('nav.nav button', { hasText: name }).first().click();
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = (el) => el.getBoundingClientRect().width > vw + 1;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!wide(el)) continue;
      if ([...el.children].some(wide)) continue; // report innermost culprits only
      const sc = el.closest('[style*="overflow"], .table-wrap, .nav, .rbd');
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '';
      out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} w=${Math.round(el.getBoundingClientRect().width)}${sc ? ' [in scroller ' + (sc.className || sc.tagName) + ']' : ''}`);
      if (out.length > 10) break;
    }
    return { scrollW: document.documentElement.scrollWidth, vw, out };
  });
  console.log(name, JSON.stringify(info));
}
await browser.close();
