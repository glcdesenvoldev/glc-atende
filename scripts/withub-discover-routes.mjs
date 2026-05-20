import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const outDir = process.env.WITHUB_OUT_DIR || 'data/withub';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', storageState: `${outDir}/storage-state.json` });
const page = await context.newPage();
const result = { ts: new Date().toISOString(), url: '', title: '', links: [], texts: [] };
await page.goto('https://app.withub.ai/backoffice', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(()=>null);
await page.waitForTimeout(2500);
result.url = page.url(); result.title = await page.title().catch(()=> '');
result.links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({text:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,80), href:a.href})).filter((x,i,a)=>x.href && a.findIndex(y=>y.href===x.href&&y.text===x.text)===i));
result.texts = await page.evaluate(() => {
 const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
 const out=[];
 while(walker.nextNode()){
  const t=(walker.currentNode.textContent||'').replace(/\s+/g,' ').trim();
  if(t && t.length<=40 && /desk|ticket|bot|beta|mapa|viabilidade|atendimento|conversa|fila|aberto|auditoria|chat/i.test(t)) out.push(t);
 }
 return Array.from(new Set(out)).slice(0,200);
});
await writeFile(`${outDir}/routes-map-result.json`, JSON.stringify(result,null,2));
await browser.close();
console.log(JSON.stringify({url:result.url,title:result.title,links:result.links.length,texts:result.texts}, null, 2));
