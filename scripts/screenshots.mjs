// Screenshot the v5.2 pages (eight pages; Projects first; the merged tabs of Projects and Review) at 1280x900 and 375x812 in light and dark against the dev server (npm run dev), upload a fixture on the Import page.
// Usage: node scripts/screenshots.mjs [outDir] [en|zh]   (needs: npm i -D playwright && npx playwright install chromium)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
const lang = process.argv[3] ?? 'en';
const L = lang === 'zh'
  ? { nav: { Projects: '项目', Topology: '拓扑与硬件', Mechanisms: '机制库', Allocation: '分配', Library: '故障库', Review: '评审', Editor: '方案编辑器', Inference: '推理与备件' }, tabs: { list: '列表', new: '新建', import: '导入', compare: '对比', checklist: '评审清单', simulation: '仿真校核', sensitivity: '敏感性', picture: '拓扑图', hardware: '硬件', reliability: '可靠性', chain: '静默错误与恢复链', strategies: '策略' }, open: '打开', attribute: '归因', run: '运行', ledger: '运行账本仿真', importBtn: '导入为方案', details: '详情', steps: '步骤' }
  : { nav: { Projects: 'Projects', Topology: 'Topology & hardware', Mechanisms: 'Mechanism library', Allocation: 'Allocation', Library: 'Fault library', Review: 'Review', Editor: 'Scenario editor', Inference: 'Inference & spares' }, tabs: { list: 'List', new: 'New', import: 'Import', compare: 'Compare', checklist: 'Checklist', simulation: 'Simulation', sensitivity: 'Sensitivity', picture: 'Picture', hardware: 'Hardware', reliability: 'Reliability', chain: 'Silent corruption & chain', strategies: 'Strategies' }, open: 'Open', attribute: 'Attribute', run: 'Run', ledger: 'Run ledger simulation', importBtn: 'Import as scenario', details: 'Details', steps: 'Steps' };
mkdirSync(out, { recursive: true });
// [file name, nav page, tab (label key of L.tabs) or null, extra action]
const shots = [
  ['projects', 'Projects', 'list', null],
  ['topology', 'Topology', 'hardware', null], ['topology-picture', 'Topology', 'picture', null], ['reliability', 'Topology', 'reliability', null],
  ['mechanisms', 'Mechanisms', null, 'attribute'], ['chain', 'Mechanisms', 'chain', null],
  ['allocation', 'Allocation', null, 'strategies'], ['library', 'Library', null, null],
  ['review', 'Review', 'checklist', null], ['simulate', 'Review', 'simulation', 'ledger'], ['sensitivity', 'Review', 'sensitivity', null],
  ['editor', 'Editor', null, 'details'], ['inference', 'Inference', null, null],
  ['compare', 'Projects', 'compare', null], ['import', 'Projects', 'import', 'import'],
];
const browser = await chromium.launch();
for (const [w, h, tag] of [[1280, 900, 'desktop'], [375, 812, 'mobile']]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.evaluate(([t, lg]) => { localStorage.removeItem('hacd-scenarios-v1'); localStorage.removeItem('hacd-projects-v1'); localStorage.setItem('hacd-theme', t); localStorage.setItem('hacd-lang', lg); localStorage.setItem('hacd-ui-mode', 'full'); document.documentElement.setAttribute('data-theme', t); }, [theme, lang]);
    await page.reload({ waitUntil: 'networkidle' });
    // full-page captures: the sticky chrome and the sticky input pane would be painted in the middle of the page
    await page.addStyleTag({ content: '.chrome { position: static !important; } .pane-in { position: static !important; max-height: none !important; overflow: visible !important; }' });
    await page.waitForTimeout(500);
    // the A3 / CloudMatrix384 template at the largest built-in scale (500,000 NPUs) shows every unit type and an allocation that needs all three kinds of moves
    // (the app opens on the Projects page; the first project is the A3 template)
    await page.locator('nav.nav button', { hasText: L.nav.Topology }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '500k', exact: true }).click();
    await page.waitForTimeout(500);
    for (const [file, name, tab, action] of shots) {
      await page.locator('nav.nav button', { hasText: L.nav[name] }).first().click();
      await page.waitForTimeout(700);
      if (tab) { await page.getByRole('tab', { name: L.tabs[tab], exact: true }).first().click(); await page.waitForTimeout(600); }
      if (action === 'attribute') { await page.getByRole('button', { name: L.attribute, exact: true }).click(); await page.waitForTimeout(3000); }
      if (action === 'strategies') {
        await page.locator('.field', { has: page.locator('label', { hasText: lang === 'zh' ? /^目标$/ : /^Target$/ }) }).locator('input').first().fill('0.985');
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: L.run, exact: true }).click();
        await page.waitForFunction((s) => document.body.innerText.includes(s), L.steps, { timeout: 180000 });
        await page.waitForTimeout(500);
      }
      if (action === 'ledger') {
        const run = page.getByRole('button', { name: L.ledger, exact: true });
        await run.click();
        // wait for the run to finish (the button is disabled while it runs) instead of a fixed pause
        await page.waitForFunction((name) => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === name); return !!b && !b.disabled; }, L.ledger, { timeout: 180000 });
        await page.waitForTimeout(500);
      }
      if (action === 'import') {
        // the Import tab has two file inputs since v5.2 (project JSON first, the workbook last)
        await page.locator('main input[type=file]').last().setInputFiles(new URL('../packages/importers/test/fixtures/hierarchy_levels_zh.xlsx', import.meta.url).pathname);
        await page.waitForTimeout(800);
        const btn = page.getByRole('button', { name: L.importBtn });
        if (await btn.count()) await btn.click();
        await page.waitForTimeout(500);
      }
      if (action === 'details') {
        const details = page.getByRole('button', { name: L.details }).first();
        if (await details.count()) await details.click();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `${out}/${file}-${tag}-${theme}.png`, fullPage: true });
      const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log(`${file} ${tag} ${theme}: ${hs ? 'HORIZONTAL OVERFLOW' : 'ok'}${errors.length ? ' errors: ' + errors.join(' | ') : ''}`);
      errors.length = 0;
      if (action === 'import') {
        // back to the A3 project (the import activated the imported one): Projects page → Open
        await page.locator('nav.nav button', { hasText: L.nav.Projects }).first().click();
        await page.getByRole('tab', { name: L.tabs.list, exact: true }).first().click().catch(() => {});
        await page.waitForTimeout(300);
        await page.locator('tr[data-project="topology-a3-ub384"] button', { hasText: L.open }).click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    await ctx.close();
  }
}
await browser.close();
