import { NextRequest, NextResponse } from "next/server";
import { appendAudit, hasSeenEvent, markEventSeen } from "@/lib/audit";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  getWitAuthFromEnv,
  getWitAuthFromHeaders,
  getWitDefaults,
  getWitPendingTickets,
  getWitQueueMetrics,
  type WitTicketSummary,
} from "@/lib/wit";

export async function GET(request: NextRequest) {
  return runWitMonitor(request);
}

export async function POST(request: NextRequest) {
  return runWitMonitor(request);
}

async function runWitMonitor(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "0";
  const notify = request.nextUrl.searchParams.get("notify") === "1";
  const auth = getWitAuthFromHeaders(request.headers) || getWitAuthFromEnv();

  if (!auth) {
    await appendAudit({ source: "wit_monitor", action: "config_missing", status: "skipped" });
    return NextResponse.json({
      ok: false,
      configured: false,
      message: "WIT_ACCESS_TOKEN/WIT_ACCOUNT_ID ausentes. Use sessão segura ou configure credenciais temporárias.",
      defaults: getWitDefaults(),
    }, { status: 503 });
  }

  const result = await getWitPendingTickets(auth);
  const metrics = await getWitQueueMetrics(auth).catch((error) => ({ ok: false, error: String(error) }));

  const newTickets: WitTicketSummary[] = [];
  for (const ticket of result.tickets) {
    const key = `wit:${ticket.id}`;
    if (ticket.id === "sem-id" || await hasSeenEvent(key)) continue;
    newTickets.push(ticket);
    if (!dryRun) await markEventSeen(key);
  }

  if (!dryRun && notify && newTickets.length > 0) {
    await notifyTelegram(newTickets);
  }

  await appendAudit({
    source: "wit_monitor",
    action: dryRun ? "dry_run" : "poll",
    status: result.ok ? "success" : "error",
    httpStatus: result.status,
    ticketCount: result.size,
    newCount: newTickets.length,
    ticketIds: newTickets.map((ticket) => ticket.id).slice(0, 20),
  });

  return NextResponse.json({
    ok: result.ok,
    dryRun,
    notify,
    status: result.status,
    ticketCount: result.size,
    newCount: newTickets.length,
    tickets: result.tickets,
    metrics,
    error: result.error,
  });
}

async function notifyTelegram(tickets: WitTicketSummary[]) {
  const targets = parseCsv(process.env.TELEGRAM_WIT_NOTIFY_CHAT_IDS || process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_ALLOWED_GROUPS);
  if (targets.length === 0) return { ok: false, skipped: "telegram_target_missing" };

  const lines = tickets.slice(0, 8).map(formatTicketAlert);
  const extra = tickets.length > 8 ? `\n\n...e mais ${tickets.length - 8} conversa(s).` : "";
  const message = [
    "💬 Monitor WIT/Mundiale — nova(s) conversa(s)/ticket(s)",
    "",
    lines.join("\n\n"),
    extra,
    "",
    "Ação sugerida: abrir aba Atendimento no WIT e verificar fila/bot.",
  ].join("\n");

  for (const target of targets) await sendTelegramMessage(target, message);
  return { ok: true, targets: targets.length };
}

function formatTicketAlert(ticket: WitTicketSummary) {
  return [
    `Ticket: ${escapeHtml(ticket.id)}`,
    ticket.status ? `Status: ${escapeHtml(ticket.status)}` : undefined,
    ticket.queue ? `Fila: ${escapeHtml(ticket.queue)}` : undefined,
    ticket.channel ? `Canal: ${escapeHtml(ticket.channel)}` : undefined,
    ticket.contactMasked ? `Contato: ${escapeHtml(ticket.contactMasked)}` : undefined,
    ticket.attendanceTimeMs != null ? `Tempo em atendimento: ${escapeHtml(formatDuration(ticket.attendanceTimeMs))}` : undefined,
    ticket.queueTimeMs != null ? `Tempo em fila: ${escapeHtml(formatDuration(ticket.queueTimeMs))}` : undefined,
    ticket.updatedAt ? `Primeira resposta: ${escapeHtml(ticket.updatedAt)}` : undefined,
  ].filter(Boolean).join("\n");
}

function parseCsv(value?: string) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value: string | number) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hhmmss = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
}
