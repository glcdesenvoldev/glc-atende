import { chromium } from 'playwright';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
const outDir=process.env.WITHUB_OUT_DIR||'data/withub'; await mkdir(outDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'pt-BR', timezoneId:'America/Sao_Paulo', storageState:`${outDir}/storage-state.json`});
const page=await context.newPage(); page.setDefaultTimeout(30000);
const urls=['https://app.withub.ai/attendance','https://app.withub.ai/attendance/0','https://app.withub.ai/tickets/pending','https://app.withub.ai/tickets/'];
const result={ts:new Date().toISOString(), pages:[]};
for (const url of urls) {
  const rec={target:url, url:null, title:null, blocker:null, nav:[], counts:{}};
  try {
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForLoadState('networkidle').catch(()=>null);
    await page.waitForTimeout(2500);
    rec.url=page.url(); rec.title=await page.title().catch(()=> '');
    const data=await page.evaluate(()=>{
      const body=document.body.innerText||'';
      const nav=Array.from(document.querySelectorAll('a,button,[role="button"],[role="tab"],input,select')).map(el=>{
        const text=(el.textContent||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim();
        const href=el instanceof HTMLAnchorElement ? el.href : '';
        return {tag:el.tagName.toLowerCase(), text:text.slice(0,80), href};
      }).filter(x => (x.text||x.href) && /desk|ticket|bot|aberto|pendente|fila|atendimento|chat|conversa|finalizado|novo|não lido|nao lido/i.test(`${x.text} ${x.href}`)).slice(0,80);
      return {nav, counts:{chars:body.length, ticket:(body.match(/ticket/gi)||[]).length, aberto:(body.match(/aberto/gi)||[]).length, atendimento:(body.match(/atendimento/gi)||[]).length, bot:(body.match(/bot/gi)||[]).length}};
    });
    rec.nav=data.nav; rec.counts=data.counts;
  } catch(e) { rec.blocker=e instanceof Error?e.message:String(e); }
  result.pages.push(rec);
}
await writeFile(`${outDir}/attendance-map-result.json`, JSON.stringify(result,null,2));
await chmod(`${outDir}/attendance-map-result.json`,0o600).catch(()=>null);
await browser.close();
console.log(JSON.stringify(result.pages.map(p=>({target:p.target,url:p.url,title:p.title,blocker:p.blocker,nav:p.nav.length,counts:p.counts})),null,2));
