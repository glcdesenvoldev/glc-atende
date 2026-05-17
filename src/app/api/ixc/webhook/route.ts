/**
 * Webhook IXC — recebe notificações de novos chamados.
 * Configurar no IXC: Parâmetros → Notificações → URL: https://atende.glcinternet.com.br/api/ixc/webhook
 *
 * Modo seguro: notifica passivamente no Telegram/WhatsApp, sem alterar chamado no IXC.
 */
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname } from "path";
import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";

type WebhookChamado = {
  id: string;
  idCliente?: string;
  assunto: string;
  prioridade: string;
  status?: string;
  nomeCliente?: string;
};

// Notifica Gilson via WhatsApp quando chega chamado novo, se Evolution estiver configurado.
async function notificarWhatsApp(mensagem: string) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const evolutionInstance = process.env.EVOLUTION_INSTANCE || "glc";
  const telefoneGilson = process.env.TELEFONE_GILSON;

  if (!evolutionUrl || !evolutionKey || !telefoneGilson) {
    console.log("[WhatsApp] desativado/sem credenciais");
    return;
  }

  await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": evolutionKey || "" },
    body: JSON.stringify({ number: telefoneGilson, text: mensagem }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const chamado = normalizeChamado(body);
    const dryRun = req.headers.get("x-glc-dry-run") === "1" || body?.dryRun === true;

    // LGPD: não registrar payload bruto do IXC, pois pode conter dados pessoais.
    console.log("[IXC Webhook] chamado recebido", { id: chamado.id, prioridade: chamado.prioridade, dryRun });

    const isDuplicate = chamado.id !== "?" && await wasAlreadyNotified(chamado.id);
    if (isDuplicate && !dryRun) {
      await auditWebhook({ action: "ixc_chamado_webhook", status: "duplicate", chamadoId: chamado.id, prioridade: chamado.prioridade });
      return NextResponse.json({ ok: true, received: chamado.id, duplicate: true });
    }

    const telegramMessage = formatTelegramChamado(chamado);
    const whatsappMessage = formatWhatsAppChamado(chamado);

    if (!dryRun) {
      await notifyTelegram(telegramMessage, chamado.id);
      await notificarWhatsApp(whatsappMessage);
      if (chamado.id !== "?") await markAsNotified(chamado.id);
    }

    await auditWebhook({
      action: "ixc_chamado_webhook",
      status: dryRun ? "dry_run" : "notified",
      chamadoId: chamado.id,
      clientId: chamado.idCliente,
      prioridade: chamado.prioridade,
    });

    return NextResponse.json({ ok: true, received: chamado.id, dryRun, duplicate: false });
  } catch (err) {
    console.error("[IXC Webhook]", err);
    await auditWebhook({ action: "ixc_chamado_webhook", status: "error" });
    return NextResponse.json({ ok: true }); // sempre 200 para o IXC não ficar reenviando em loop
  }
}

// Verificação GET
export async function GET() {
  return NextResponse.json({ status: "webhook ativo", sistema: "GLC Atende", telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) });
}

function normalizeChamado(body: any): WebhookChamado {
  const chamado = body?.chamado || body?.oss || body?.ticket || body?.data || body || {};
  const id = String(chamado.id || chamado.id_chamado || chamado.id_oss || chamado.ticket_id || chamado.protocolo || "?");
  const idCliente = chamado.id_cliente || chamado.cliente_id || chamado.idCliente;

  return {
    id,
    idCliente: idCliente ? String(idCliente) : undefined,
    assunto: String(chamado.assunto || chamado.subject || chamado.titulo || chamado.descricao_assunto || "Novo chamado"),
    prioridade: String(chamado.prioridade || chamado.priority || chamado.prioridade_oss || "M"),
    status: chamado.status ? String(chamado.status) : undefined,
    nomeCliente: chamado.nome_cliente || chamado.customer || chamado.razao || chamado.cliente || undefined,
  };
}

function priorityLabel(prioridade: string) {
  const normalized = prioridade.toUpperCase();
  const labels: Record<string, string> = {
    A: "🔴 Alta/Urgente",
    M: "🟡 Média",
    B: "🟢 Baixa",
  };
  return labels[normalized] || `📋 ${prioridade || "Não informada"}`;
}

function statusLabel(status?: string) {
  const normalized = String(status || "").toUpperCase();
  const labels: Record<string, string> = {
    A: "Aberto",
    ABERTO: "Aberto",
    P: "Pendente",
    AG: "Aguardando",
    F: "Fechado",
    C: "Cancelado",
  };
  return labels[normalized] || status || "Não informado";
}

function formatTelegramChamado(chamado: WebhookChamado) {
  return [
    "🚨 Novo chamado no IXC",
    "",
    `Chamado: #${chamado.id}`,
    chamado.idCliente ? `Cliente ID: ${chamado.idCliente}` : undefined,
    `Assunto: ${truncateLine(chamado.assunto, 140)}`,
    `Prioridade: ${priorityLabel(chamado.prioridade)}`,
    `Status: ${statusLabel(chamado.status)}`,
    "",
    `Ação sugerida: use /chamado ${chamado.id} para detalhes${chamado.idCliente ? ` ou /c ${chamado.idCliente} para consultar o cliente` : ""}.`,
  ].filter(Boolean).join("\n");
}

function formatWhatsAppChamado(chamado: WebhookChamado) {
  return [
    "🚨 Novo chamado no IXC",
    `Chamado: #${chamado.id}`,
    chamado.idCliente ? `Cliente ID: ${chamado.idCliente}` : undefined,
    `Assunto: ${truncateLine(chamado.assunto, 140)}`,
    `Prioridade: ${priorityLabel(chamado.prioridade)}`,
  ].filter(Boolean).join("\n");
}

async function notifyTelegram(message: string, chamadoId: string) {
  const targets = parseCsv(process.env.TELEGRAM_CHAMADOS_NOTIFY_CHAT_IDS || process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_ALLOWED_GROUPS);
  if (targets.length === 0) {
    console.log("[Telegram] sem TELEGRAM_CHAMADOS_NOTIFY_CHAT_IDS/TELEGRAM_GROUP_ID configurado", { chamadoId });
    return;
  }

  for (const target of targets) {
    await sendTelegramMessage(target, message);
  }
}

async function wasAlreadyNotified(chamadoId: string) {
  try {
    const file = notifiedPath();
    const content = await readFile(file, "utf8");
    return content.split(/\r?\n/).includes(chamadoId);
  } catch {
    return false;
  }
}

async function markAsNotified(chamadoId: string) {
  const file = notifiedPath();
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${chamadoId}\n`, "utf8");
}

function notifiedPath() {
  return process.env.IXC_CHAMADOS_NOTIFIED_PATH || "/app/data/audit/ixc-chamados-notified.txt";
}

async function auditWebhook(event: Record<string, unknown>) {
  const logPath = process.env.AUDIT_LOG_PATH || "/app/data/audit/telegram-audit.jsonl";
  const payload = {
    ts: new Date().toISOString(),
    channel: "ixc_webhook",
    ...event,
  };

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("ixc_webhook_audit_log_failed", error);
  }
}

function parseCsv(value?: string) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function truncateLine(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
