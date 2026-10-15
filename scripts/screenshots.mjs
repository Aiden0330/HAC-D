// Screenshot every page at 1280x900 and 375x812 in light and dark against the dev server (npm run dev), upload a fixture on the Import page.
// Usage: node scripts/screenshots.mjs [outDir]   (needs: npm i -D playwright && npx playwright install chromium)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
const lang = process.argv[3] ?? 'en';
const L = lang === 'zh'
  ? { pages: { Scenario: '方案', Training: '训练作业', Mechanisms: '机制', Audit: '审核与报告', Allocation: '可用性分配', Simulate: '蒙特卡洛', Report: '设计评审', Import: '导入', Compare: '方案对比' }, attribute: '归因', plan: '规划', audit: '生成审核', study: '运行研究', ledger: '运行账本仿真', importBtn: '导入为方案', details: '详情' }
  : { pages: { Scenario: 'Scenario', Training: 'Training', Mechanisms: 'Mechanisms', Audit: 'Audit & study', Allocation: 'Allocation', Simulate: 'Simulate', Report: 'Report', Import: 'Import', Compare: 'Compare' }, attribute: 'Attribute', plan: 'Plan', audit: 'Run audit', study: 'Run study', ledger: 'Run ledger simulation', importBtn: 'Import as scenario', details: 'Details' };
mkdirSync(out, { recursive: true });
const pages = ['Scenario', 'Training', 'Mechanisms', 'Allocation', 'Audit', 'Simulate', 'Report', 'Import', 'Compare'];
const browser = await chromium.launch();
for (const [w, h, tag] of [[1280, 900, 'desktop'], [375, 812, 'mobile']]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.evaluate(([t, lg]) => { localStorage.removeItem('hacd-scenarios-v1'); localStorage.setItem('hacd-theme', t); localStorage.setItem('hacd-lang', lg); localStorage.setItem('hacd-ui-mode', 'full'); document.documentElement.setAttribute('data-theme', t); }, [theme, lang]);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // the three-class reference example shows the silent-corruption, chain and ledger cards
    await page.selectOption('#scenario-select', 'ref-three-classes-100k').catch(() => {});
    await page.waitForTimeout(400);
    for (const name of pages) {
      await page.getByRole('navigation').getByRole('button', { name: L.pages[name], exact: true }).click();
      await page.waitForTimeout(700);
      if (name === 'Mechanisms') {
        await page.getByRole('button', { name: L.attribute, exact: true }).click();
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: L.plan, exact: true }).click();
        await page.waitForTimeout(6000);
      }
      if (name === 'Audit') {
        await page.getByRole('button', { name: L.audit, exact: true }).click();
        await page.waitForTimeout(2500);
        if (tag === 'desktop' && theme === 'light') {
          await page.getByRole('button', { name: L.study, exact: true }).click();
          await page.waitForTimeout(60000);
        }
      }
      if (name === 'Simulate') {
        await page.getByRole('button', { name: L.ledger, exact: true }).click();
        await page.waitForTimeout(4000);
      }
      if (name === 'Import') {
        // real upload of a fixture workbook, then import it as a scenario
        await page.locator('main input[type=file]').setInputFiles(new URL('../packages/importers/test/fixtures/hierarchy_levels_zh.xlsx', import.meta.url).pathname);
        await page.waitForTimeout(800);
        const btn = page.getByRole('button', { name: L.importBtn });
        if (await btn.count()) await btn.click();
        await page.waitForTimeout(500);
        const imported = await page.evaluate(() => document.querySelector('#scenario-select')?.value);
        console.log(`  imported scenario id: ${imported}`);
      }
      if (name === 'Scenario') {
        // open the first component's details row
        const details = page.getByRole('button', { name: L.details }).first();
        if (await details.count()) await details.click();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `${out}/${name.toLowerCase()}-${tag}-${theme}.png`, fullPage: true });
      const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log(`${name} ${tag} ${theme}: ${hs ? 'HORIZONTAL OVERFLOW' : 'ok'}${errors.length ? ' errors: ' + errors.join(' | ') : ''}`);
      errors.length = 0;
    }
    await ctx.close();
  }
}
await browser.close();
