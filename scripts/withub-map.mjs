import { chromium } from 'playwright';
import { mkdir, writeFile, chmod } from 'node:fs/promises';

const url = process.env.WITHUB_URL || 'https://app.withub.ai/';
const user = process.env.WITHUB_USER;
const pass = process.env.WITHUB_PASSWORD;

if (!user || !pass) throw new Error('WITHUB_USER/WITHUB_PASSWORD ausentes');

const outDir = process.env.WITHUB_OUT_DIR || 'data/withub';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();
page.setDefaultTimeout(30000);

const result = {
  ts: new Date().toISOString(),
  startUrl: url,
  steps: [],
  finalUrl: '',
  title: '',
  navCandidates: [],
  blocker: null,
};

function step(name, data = {}) { result.steps.push({ name, ...data }); }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  step('opened', { url: page.url(), title: await page.title().catch(() => '') });

  const username = page.locator('input[name="username"], input#username, input[type="email"], input[type="text"]').first();
  const password = page.locator('input[name="password"], input#password, input[type="password"]').first();

  await username.waitFor({ state: 'visible' });
  await username.fill(user);
  await password.fill(pass);
  step('credentials_filled');

  const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar"), button:has-text("Sign in"), button:has-text("Login")').first();
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => null),
    submit.click(),
  ]);
  await page.waitForTimeout(3000);
  step('submitted', { url: page.url(), title: await page.title().catch(() => '') });

  if (page.url().includes('account.withub.ai')) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
    await page.waitForTimeout(3000);
    step('reopened_app_after_auth', { url: page.url(), title: await page.title().catch(() => '') });
  }

  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
  if (/captcha|2fa|two-factor|código|codigo|verification|verificação/i.test(bodyText)) {
    result.blocker = 'Possível captcha/2FA/verificação manual após login';
  }

  // Salva sessão para reaproveitar cookies/tokens sem relogar toda vez.
  await context.storageState({ path: `${outDir}/storage-state.json` });
  await chmod(`${outDir}/storage-state.json`, 0o600).catch(() => null);

  // Coleta apenas possíveis itens de navegação, evitando dump de conversas.
  const candidates = await page.evaluate(() => {
    const keywords = /desk|bot|ticket|aberto|atendimento|conversa|inbox|fila|beta|mapa|viabilidade|chat/i;
    const els = Array.from(document.querySelectorAll('a,button,[role="button"],[role="link"]'));
    const seen = new Set();
    return els.map((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const href = el instanceof HTMLAnchorElement ? el.href : '';
      const aria = el.getAttribute('aria-label') || '';
      const label = text || aria;
      return { label: label.slice(0, 80), href };
    }).filter((item) => {
      if (!item.label || item.label.length > 80) return false;
      if (!keywords.test(item.label + ' ' + item.href)) return false;
      const key = item.label + item.href;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 80);
  });
  result.navCandidates = candidates;

  // Tenta entrar no Desk se aparecer claramente.
  const desk = page.getByText(/\bdesk\b|atendimento|atendimentos/i).first();
  if (await desk.count().catch(() => 0)) {
    await desk.click().catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
    await page.waitForTimeout(1500);
    step('desk_clicked_if_available', { url: page.url(), title: await page.title().catch(() => '') });
  }

  result.finalUrl = page.url();
  result.title = await page.title().catch(() => '');
} catch (err) {
  result.blocker = err instanceof Error ? err.message : String(err);
} finally {
  await writeFile(`${outDir}/map-result.json`, JSON.stringify(result, null, 2));
  await chmod(`${outDir}/map-result.json`, 0o600).catch(() => null);
  await browser.close();
}

console.log(JSON.stringify({ ok: !result.blocker, blocker: result.blocker, finalUrl: result.finalUrl, title: result.title, navCount: result.navCandidates.length }, null, 2));
