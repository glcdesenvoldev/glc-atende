#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    if (!process.env[key]) process.env[key] = rest.join('=');
  }
}

function brParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

function brDateKey(date = new Date()) {
  const p = brParts(date);
  return `${p.y}-${p.m}-${p.d}`;
}

function eventBrDateKey(event) {
  return brDateKey(new Date(event.ts));
}

function readEvents(logPath, targetDate) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter((event) => event.ts && eventBrDateKey(event) === targetDate);
}

function countBy(events, keyFn) {
  const map = new Map();
  for (const event of events) {
    const key = keyFn(event) || 'não informado';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function summarize(events, targetDate) {
  const total = events.length;
  const byUser = countBy(events, (e) => `${e.firstName || e.username || e.userId} (${e.userId})`);
  const byAction = countBy(events, (e) => e.action);
  const denied = events.filter((e) => ['denied', 'blocked'].includes(e.status) || String(e.action || '').includes('denied'));
  const notFound = events.filter((e) => e.status === 'not_found');
  const lookups = events.filter((e) => String(e.action || '').startsWith('cliente'));
  const faturas = events.filter((e) => String(e.action || '').startsWith('faturas'));
  const outside = events.filter((e) => e.reason === 'outside_business_hours');

  const lines = [];
  lines.push(`📋 Resumo GLC Atende — ${targetDate}`);
  lines.push('');
  lines.push(`Total de eventos: ${total}`);
  lines.push(`Consultas de cliente: ${lookups.length}`);
  lines.push(`Consultas de faturas: ${faturas.length}`);
  lines.push(`Não encontrados: ${notFound.length}`);
  lines.push(`Bloqueios/negados: ${denied.length}`);
  if (outside.length) lines.push(`Fora do horário: ${outside.length}`);
  lines.push('');

  if (byUser.length) {
    lines.push('👤 Por usuário:');
    for (const [user, count] of byUser.slice(0, 8)) lines.push(`- ${user}: ${count}`);
    lines.push('');
  }

  if (byAction.length) {
    lines.push('⚙️ Por ação:');
    for (const [action, count] of byAction.slice(0, 8)) lines.push(`- ${action}: ${count}`);
    lines.push('');
  }

  if (denied.length) {
    lines.push('⚠️ Atenção: houve eventos bloqueados/negados. Revisar auditoria se necessário.');
  } else {
    lines.push('✅ Nenhum bloqueio crítico registrado.');
  }

  lines.push('');
  lines.push('LGPD: resumo sem dados completos de clientes; detalhes ficam no log interno de auditoria.');
  return lines.join('\n');
}

function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  process.chdir(path.resolve(__dirname, '..'));
  loadEnv('.env');
  const dateArg = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const targetDate = dateArg || brDateKey();
  const logPath = process.env.AUDIT_LOG_PATH_HOST || './data/audit/telegram-audit.jsonl';
  const events = readEvents(logPath, targetDate);
  const text = summarize(events, targetDate);

  if (process.argv.includes('--print')) {
    console.log(text);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_AUDIT_SUMMARY_CHAT_ID || process.env.TELEGRAM_PRIVATE_USERS?.split(',')[0];
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_AUDIT_SUMMARY_CHAT_ID ausente');
  const res = await sendTelegram(token, chatId, text);
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Telegram HTTP ${res.statusCode}: ${res.data}`);
  console.log(`Resumo enviado para ${chatId} (${events.length} eventos).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
