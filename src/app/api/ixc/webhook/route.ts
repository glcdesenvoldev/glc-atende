/**
 * Webhook IXC — recebe notificações de novos chamados.
 * URL recomendada: https://atende.glcinternet.com.br/api/ixc/webhook?secret=SEU_SEGREDO
 * Quando possível, preferir header: x-glc-webhook-secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { appendAudit, hasSeenEvent, markEventSeen } from "@/lib/audit";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";

type WebhookChamado = {
  id?: string | number;
  ticket_id?: string | number;
  assunto?: string;
  subject?: string;
  nome_cliente?: string;
  customer?: string;
  prioridade?: string;
  priority?: string;
};

async function notificarWhatsApp(mensagem: string) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const evolutionInstance = process.env.EVOLUTION_INSTANCE || "glc";
  const telefoneGilson = process.env.TELEFONE_GILSON;

  if (!evolutionUrl || !evolutionKey || !telefoneGilson) return { ok: false, skipped: "evolution_not_configured" };

  const res = await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": evolutionKey },
    body: JSON.stringify({ number: telefoneGilson, text: mensagem }),
  });

  return { ok: res.ok, status: res.status };
}

async function notificarTelegram(mensagem: string) {
  const groupId = process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_ALLOWED_GROUPS?.split(",")[0]?.trim();
  if (!groupId) return { ok: false, skipped: "telegram_group_not_configured" };
  return sendTelegramMessage(groupId, mensagem);
}

export async function POST(req: NextRequest) {
  const secretError = validateSharedSecret(req, "IXC_WEBHOOK_SECRET");
  if (secretError) return secretError;

  try {
    const body = await req.json();
    const chamado = (body.chamado || body.oss || body) as WebhookChamado;
    const assunto = chamado.assunto || chamado.subject || "Novo chamado";
    const cliente = chamado.nome_cliente || chamado.customer || "Cliente";
    const prioridade = chamado.prioridade || chamado.priority || "M";
    const id = String(chamado.id || chamado.ticket_id || "sem-id");

    if (await hasSeenEvent(id)) {
      await appendAudit({ source: "ixc_webhook", action: "duplicate_ignored", chamadoId: id });
      return NextResponse.json({ ok: true, duplicate: true, received: id });
    }

    const prioLabel: Record<string, string> = { A: "🔴 URGENTE", M: "🟡 Médio", B: "🟢 Baixo" };
    const emoji = prioLabel[prioridade] || "📋";
    const msg = [
      `${emoji} Novo chamado GLC Internet`,
      "",
      `📋 #${id} — ${assunto}`,
      `👤 Cliente: ${cliente}`,
      `Prioridade: ${prioridade}`,
      "",
      "Use /chamados no grupo interno para consultar a fila.",
    ].join("\n");

    const telegramResult = await notificarTelegram(msg);
    const whatsappResult = process.env.IXC_WEBHOOK_NOTIFY_WHATSAPP === "true"
      ? await notificarWhatsApp(msg)
      : { ok: false, skipped: "whatsapp_disabled" };

    await markEventSeen(id);
    await appendAudit({
      source: "ixc_webhook",
      action: "new_ticket_notified",
      chamadoId: id,
      prioridade,
      telegramOk: Boolean((telegramResult as { ok?: boolean })?.ok),
      whatsappOk: Boolean((whatsappResult as { ok?: boolean })?.ok),
    });

    return NextResponse.json({ ok: true, received: id });
  } catch (err) {
    await appendAudit({ source: "ixc_webhook", action: "error", error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ ok: true }); // sempre 200 para o IXC não entrar em retry agressivo
  }
}

export async function GET() {
  return NextResponse.json({
    status: "webhook ativo",
    sistema: "GLC Atende",
    secretConfigured: Boolean(process.env.IXC_WEBHOOK_SECRET),
  });
}
