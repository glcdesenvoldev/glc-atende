/**
 * Webhook Evolution — ponte de entrada do WhatsApp para o GLC Atende.
 *
 * Mantem o MVP seguro: recebe eventos, registra auditoria sanitizada e avisa
 * Gilson no Telegram. Nao responde clientes automaticamente.
 */
import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeForAudit, sanitizeTextLgpd } from "@/lib/lgpd";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";
import { saveWhatsAppChamado } from "@/lib/whatsapp-chamados";

type EvolutionMessage = {
  key?: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
  };
  pushName?: string;
  messageType?: string;
  message?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const secretError = validateSharedSecret(req, "EVOLUTION_WEBHOOK_SECRET");
  if (secretError) return secretError;

  try {
    const body = await req.json();
    const payload = asRecord(body) || {};
    const event = String(payload.event || payload.type || "unknown");
    const instance = String(payload.instance || payload.instanceName || "unknown");
    const data = asRecord(payload.data);
    const message = normalizeMessage(data);

    await auditEvolution({
      action: "evolution_webhook",
      event,
      instance,
      fromMe: message.fromMe,
      remoteJid: maskRemoteJid(message.remoteJid),
      pushName: sanitizeTextLgpd(message.pushName || ""),
      messageType: message.messageType,
      text: sanitizeTextLgpd(truncate(message.text || "", 500)),
      messageId: message.messageId,
    });

    if (shouldNotify(event, message)) {
      await saveWhatsAppChamado({
        messageId: message.messageId,
        remoteJid: message.remoteJid,
        pushName: message.pushName,
        messageType: message.messageType,
        text: message.text,
      });
      await notifyTelegram(event, instance, message);
    }

    return NextResponse.json({ ok: true, event, notified: shouldNotify(event, message) });
  } catch (error) {
    console.error("evolution_webhook_failed", error);
    await auditEvolution({ action: "evolution_webhook", status: "error" });
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "webhook ativo",
    sistema: "GLC Atende",
    origem: "Evolution API",
  });
}

function normalizeMessage(data: Record<string, unknown> | null) {
  const message = data as EvolutionMessage | null;
  const content = asRecord(message?.message);

  return {
    remoteJid: String(message?.key?.remoteJid || ""),
    fromMe: Boolean(message?.key?.fromMe),
    messageId: message?.key?.id ? String(message.key.id) : undefined,
    pushName: message?.pushName ? String(message.pushName) : "",
    messageType: message?.messageType ? String(message.messageType) : "",
    text: extractText(content),
  };
}

function extractText(message: Record<string, unknown> | null) {
  if (!message) return "";

  const conversation = message.conversation;
  if (typeof conversation === "string") return conversation;

  const extendedText = asRecord(message.extendedTextMessage);
  if (typeof extendedText?.text === "string") return extendedText.text;

  const image = asRecord(message.imageMessage);
  if (typeof image?.caption === "string") return image.caption;

  const video = asRecord(message.videoMessage);
  if (typeof video?.caption === "string") return video.caption;

  const document = asRecord(message.documentMessage);
  if (typeof document?.caption === "string") return document.caption;

  return "";
}

function shouldNotify(event: string, message: ReturnType<typeof normalizeMessage>) {
  if (message.fromMe) return false;
  if (message.remoteJid.endsWith("@g.us") && process.env.EVOLUTION_NOTIFY_GROUPS !== "1") return false;
  return event === "messages.upsert" || event === "MESSAGES_UPSERT";
}

async function notifyTelegram(event: string, instance: string, message: ReturnType<typeof normalizeMessage>) {
  const targets = parseCsv(process.env.TELEGRAM_EVOLUTION_NOTIFY_CHAT_IDS || process.env.TELEGRAM_GILSON_ID);
  if (targets.length === 0) return;

  const phone = formatRemoteJid(message.remoteJid);
  const text = [
    "📩 Nova mensagem no WhatsApp GLC",
    "",
    `Instância: <code>${escapeHtml(instance)}</code>`,
    `Contato: ${escapeHtml(sanitizeTextLgpd(message.pushName || "Sem nome"))}`,
    `Número: <code>${escapeHtml(phone)}</code>`,
    `Tipo: ${escapeHtml(message.messageType || event)}`,
    message.text ? "" : undefined,
    message.text ? escapeHtml(sanitizeTextLgpd(truncate(message.text, 900))) : undefined,
  ].filter(Boolean).join("\n");

  for (const target of targets) {
    await sendTelegramMessage(target, text);
  }
}

async function auditEvolution(event: Record<string, unknown>) {
  const logPath = process.env.AUDIT_LOG_PATH || "/app/data/audit/telegram-audit.jsonl";
  const payload = sanitizeForAudit({
    ts: new Date().toISOString(),
    channel: "evolution_webhook",
    ...event,
  });

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("evolution_webhook_audit_log_failed", error);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseCsv(value?: string) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function formatRemoteJid(remoteJid: string) {
  return remoteJid.replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, "");
}

function maskRemoteJid(remoteJid: string) {
  const clean = formatRemoteJid(remoteJid);
  if (clean.length <= 4) return "***";
  return `***${clean.slice(-4)}`;
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
