import { chromium } from 'playwright';
import { mkdir, writeFile, chmod } from 'node:fs/promises';

const outDir = process.env.WITHUB_OUT_DIR || 'data/withub';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', storageState: `${outDir}/storage-state.json` });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const result = { ts: new Date().toISOString(), pages: [], blocker: null };
async function collect(name) {
  const data = await page.evaluate(() => {
    const keywords = /aberto|abertos|pendente|novo|ticket|bot|status|fila|atendente|data|filtro|protocolo|cliente|telefone/i;
    const controls = Array.from(document.querySelectorAll('a,button,input,select,[role="button"],[role="tab"],[aria-label]')).map((el) => {
      const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
      const tag = el.tagName.toLowerCase();
      const href = el instanceof HTMLAnchorElement ? el.href : '';
      const type = el.getAttribute('type') || '';
      return { tag, type, text: text.slice(0, 80), href };
    }).filter((x) => (x.text || x.href) && keywords.test(`${x.text} ${x.href}`)).slice(0, 120);
    const body = document.body.innerText || '';
    const counts = {
      aberto: (body.match(/aberto/gi) || []).length,
      ticket: (body.match(/ticket/gi) || []).length,
      bot: (body.match(/bot/gi) || []).length,
    };
    return { controls, counts };
  });
  result.pages.push({ name, url: page.url(), title: await page.title().catch(() => ''), ...data });
}
try {
  await page.goto('https://app.withub.ai/backoffice/audit-ticket', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => null);
  await page.waitForTimeout(2500);
  await collect('audit-ticket');

  // Tenta abrir filtro/status Abertos sem fazer ação operacional.
  const abertas = page.getByText(/abertos|aberto|pendente/i).first();
  if (await abertas.count().catch(() => 0)) {
    await abertas.click().catch(() => null);
    await page.waitForTimeout(1500);
    await collect('after_open_filter_click');
  }
} catch (err) {
  result.blocker = err instanceof Error ? err.message : String(err);
} finally {
  await writeFile(`${outDir}/tickets-map-result.json`, JSON.stringify(result, null, 2));
  await chmod(`${outDir}/tickets-map-result.json`, 0o600).catch(() => null);
  await browser.close();
}
console.log(JSON.stringify({ ok: !result.blocker, blocker: result.blocker, pages: result.pages.map(p => ({name:p.name,url:p.url,title:p.title,controls:p.controls.length,counts:p.counts})) }, null, 2));
