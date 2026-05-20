import { chromium } from 'playwright';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
const outDir=process.env.WITHUB_OUT_DIR||'data/withub'; await mkdir(outDir,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'pt-BR', timezoneId:'America/Sao_Paulo', storageState:`${outDir}/storage-state.json`});
const page=await context.newPage(); page.setDefaultTimeout(30000);
const urls=[
 'https://desk.withub.ai/',
 'https://desk.withub.ai/tickets',
 'https://desk.withub.ai/tickets/pending',
 'https://desk.withub.ai/attendance',
 'https://desk-beta.withub.ai/',
 'https://desk-beta.withub.ai/tickets',
 'https://app.withub.ai/desk/tickets',
 'https://app.withub.ai/desk',
 'https://app.withub.ai/tickets/desks/finalized',
 'https://app.withub.ai/attendance/tickets',
];
const result={ts:new Date().toISOString(), pages:[]};
for (const url of urls) {
  const rec={target:url,url:null,title:null,status:null,blocker:null,controls:[],counts:{}};
  try {
    const resp=await page.goto(url,{waitUntil:'domcontentloaded'});
    rec.status=resp?.status() ?? null;
    await page.waitForLoadState('networkidle').catch(()=>null);
    await page.waitForTimeout(2500);
    rec.url=page.url(); rec.title=await page.title().catch(()=> '');
    const data=await page.evaluate(()=>{
      const body=document.body.innerText||'';
      const controls=Array.from(document.querySelectorAll('a,button,[role="button"],[role="tab"],input,select')).map(el=>{
        const text=(el.textContent||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim();
        const href=el instanceof HTMLAnchorElement ? el.href : '';
        return {tag:el.tagName.toLowerCase(), text:text.slice(0,100), href};
      }).filter(x => (x.text||x.href) && /ticket|desk|aberto|pendente|fila|atendimento|chat|conversa|bot|novo|não lido|nao lido|aguard/i.test(`${x.text} ${x.href}`)).slice(0,100);
      return {controls, counts:{chars:body.length, ticket:(body.match(/ticket/gi)||[]).length, aberto:(body.match(/aberto/gi)||[]).length, atendimento:(body.match(/atendimento/gi)||[]).length, bot:(body.match(/bot/gi)||[]).length, semPermissao:(body.match(/sem permissão|sem permissao|403/gi)||[]).length}};
    });
    rec.controls=data.controls; rec.counts=data.counts;
  } catch(e) { rec.blocker=e instanceof Error?e.message:String(e); }
  result.pages.push(rec);
}
await writeFile(`${outDir}/desk-tickets-map-result.json`, JSON.stringify(result,null,2));
await chmod(`${outDir}/desk-tickets-map-result.json`,0o600).catch(()=>null);
await browser.close();
console.log(JSON.stringify(result.pages.map(p=>({target:p.target,status:p.status,url:p.url,title:p.title,blocker:p.blocker,controls:p.controls.length,counts:p.counts})),null,2));
