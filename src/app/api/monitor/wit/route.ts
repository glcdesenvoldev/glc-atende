import { NextRequest, NextResponse } from "next/server";
import { appendAudit, hasSeenEvent, markEventSeen } from "@/lib/audit";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  getWitAuthFromEnv,
  getWitAuthFromHeaders,
  getWitAuthFromStorageState,
  getWitDefaults,
  getWitPendingTickets,
  getWitQueueMetrics,
  type WitTicketSummary,
} from "@/lib/wit";

type WitAlertReason = "new_ticket" | "queue_time" | "attendance_time" | "active_volume";
type WitAlertSeverity = "info" | "warning" | "critical";

type WitAlert = {
  reason: WitAlertReason;
  severity: WitAlertSeverity;
  message: string;
  ticket?: WitTicketSummary;
  key: string;
};

type WitMonitorRules = {
  alertNewTickets: boolean;
  queueAlertMs: number;
  attendanceAlertMs: number;
  activeTicketsAlertCount: number;
  repeatAlertMs: number;
};

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
  const rules = getRules(request);
  const auth = getWitAuthFromHeaders(request.headers) || getWitAuthFromEnv() || await getWitAuthFromStorageState();

  if (!auth) {
    await appendAudit({ source: "wit_monitor", action: "config_missing", status: "skipped" });
    return NextResponse.json({
      ok: false,
      configured: false,
      message: "WIT_ACCESS_TOKEN/WIT_ACCOUNT_ID ausentes. Use sessão segura ou configure credenciais temporárias.",
      defaults: getWitDefaults(),
      rules: serializeRules(rules),
    }, { status: 503 });
  }

  const result = await getWitPendingTickets(auth);
  const metrics = await getWitQueueMetrics(auth).catch((error) => ({ ok: false, error: String(error) }));
  const candidates = buildAlertCandidates(result.tickets, rules);

  const alerts: WitAlert[] = [];
  for (const alert of candidates) {
    if (await hasSeenEvent(alert.key)) continue;
    alerts.push(alert);
    if (!dryRun) await markEventSeen(alert.key);
  }

  if (!dryRun && notify && alerts.length > 0) {
    await notifyTelegram(alerts, rules);
  }

  await appendAudit({
    source: "wit_monitor",
    action: dryRun ? "dry_run" : "poll",
    status: result.ok ? "success" : "error",
    httpStatus: result.status,
    ticketCount: result.size,
    alertCount: alerts.length,
    alertReasons: alerts.map((alert) => alert.reason).slice(0, 20),
    ticketIds: alerts.map((alert) => alert.ticket?.id).filter(Boolean).slice(0, 20),
  });

  return NextResponse.json({
    ok: result.ok,
    dryRun,
    notify,
    configured: true,
    status: result.status,
    ticketCount: result.size,
    alertCount: alerts.length,
    rules: serializeRules(rules),
    alerts: alerts.map(serializeAlert),
    tickets: result.tickets,
    metrics,
    error: result.error,
  });
}

function buildAlertCandidates(tickets: WitTicketSummary[], rules: WitMonitorRules) {
  const now = Date.now();
  const repeatBucket = Math.floor(now / Math.max(rules.repeatAlertMs, 60_000));
  const alerts: WitAlert[] = [];

  if (rules.activeTicketsAlertCount > 0 && tickets.length >= rules.activeTicketsAlertCount) {
    alerts.push({
      reason: "active_volume",
      severity: tickets.length >= rules.activeTicketsAlertCount * 2 ? "critical" : "warning",
      message: `${tickets.length} ticket(s)/conversa(s) ativos no WIT`,
      key: `wit:volume:${rules.activeTicketsAlertCount}:${repeatBucket}`,
    });
  }

  for (const ticket of tickets) {
    if (ticket.id === "sem-id") continue;

    const ticketAlerts: WitAlert[] = [];
    if (rules.queueAlertMs > 0 && ticket.queueTimeMs != null && ticket.queueTimeMs >= rules.queueAlertMs) {
      ticketAlerts.push({
        reason: "queue_time",
        severity: ticket.queueTimeMs >= rules.queueAlertMs * 2 ? "critical" : "warning",
        message: `Cliente parado em fila há ${formatDuration(ticket.queueTimeMs)}`,
        ticket,
        key: `wit:queue:${ticket.id}:${repeatBucket}`,
      });
    }

    if (rules.attendanceAlertMs > 0 && ticket.attendanceTimeMs != null && ticket.attendanceTimeMs >= rules.attendanceAlertMs) {
      ticketAlerts.push({
        reason: "attendance_time",
        severity: ticket.attendanceTimeMs >= rules.attendanceAlertMs * 2 ? "critical" : "warning",
        message: `Atendimento sem evolução aparente há ${formatDuration(ticket.attendanceTimeMs)}`,
        ticket,
        key: `wit:attendance:${ticket.id}:${repeatBucket}`,
      });
    }

    if (ticketAlerts.length > 0) {
      alerts.push(...ticketAlerts);
      continue;
    }

    if (rules.alertNewTickets) {
      alerts.push({
        reason: "new_ticket",
        severity: "info",
        message: "Nova conversa/ticket visível no WIT",
        ticket,
        key: `wit:new:${ticket.id}`,
      });
    }
  }

  return alerts;
}

async function notifyTelegram(alerts: WitAlert[], rules: WitMonitorRules) {
  const targets = parseCsv(process.env.TELEGRAM_WIT_NOTIFY_CHAT_IDS || process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_ALLOWED_GROUPS);
  if (targets.length === 0) return { ok: false, skipped: "telegram_target_missing" };

  const sortedAlerts = [...alerts].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const lines = sortedAlerts.slice(0, 10).map(formatAlert);
  const extra = sortedAlerts.length > 10 ? `\n\n...e mais ${sortedAlerts.length - 10} alerta(s).` : "";
  const message = [
    "⚠️ Monitor WIT/Mundiale — atenção operacional",
    "",
    lines.join("\n\n"),
    extra,
    "",
    `Realerta mínimo: ${formatDuration(rules.repeatAlertMs)}`,
    "Ação sugerida: abrir aba Atendimento no WIT e verificar fila/bot.",
    "LGPD: alerta sem conteúdo de mensagem do cliente.",
  ].join("\n");

  for (const target of targets) await sendTelegramMessage(target, message);
  return { ok: true, targets: targets.length };
}

function formatAlert(alert: WitAlert) {
  const icon = alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟡" : "ℹ️";
  const ticket = alert.ticket;

  return [
    `${icon} ${escapeHtml(alert.message)}`,
    `Motivo: ${escapeHtml(reasonLabel(alert.reason))}`,
    ticket ? formatTicketAlert(ticket) : undefined,
  ].filter(Boolean).join("\n");
}

function formatTicketAlert(ticket: WitTicketSummary) {
  return [
    `Ticket: ${escapeHtml(ticket.id)}`,
    ticket.status ? `Status: ${escapeHtml(ticket.status)}` : undefined,
    ticket.queue ? `Fila: ${escapeHtml(ticket.queue)}` : undefined,
    ticket.channel ? `Canal: ${escapeHtml(ticket.channel)}` : undefined,
    ticket.contactMasked ? `Contato: ${escapeHtml(ticket.contactMasked)}` : undefined,
    ticket.attendant ? `Atendente: ${escapeHtml(ticket.attendant)}` : undefined,
    ticket.attendanceTimeMs != null ? `Tempo em atendimento: ${escapeHtml(formatDuration(ticket.attendanceTimeMs))}` : undefined,
    ticket.queueTimeMs != null ? `Tempo em fila: ${escapeHtml(formatDuration(ticket.queueTimeMs))}` : undefined,
    ticket.updatedAt ? `Referência de tempo: ${escapeHtml(ticket.updatedAt)}` : undefined,
  ].filter(Boolean).join("\n");
}

function getRules(request: NextRequest): WitMonitorRules {
  return {
    alertNewTickets: readBoolean(request, "alertNew", "WIT_ALERT_NEW_TICKETS", true),
    queueAlertMs: readMinutes(request, "queueMin", "WIT_QUEUE_ALERT_MINUTES", 10),
    attendanceAlertMs: readMinutes(request, "attendanceMin", "WIT_ATTENDANCE_ALERT_MINUTES", 15),
    activeTicketsAlertCount: readInteger(request, "activeCount", "WIT_ACTIVE_TICKETS_ALERT_COUNT", 5),
    repeatAlertMs: readMinutes(request, "repeatMin", "WIT_REPEAT_ALERT_MINUTES", 30),
  };
}

function readMinutes(request: NextRequest, param: string, envKey: string, fallback: number) {
  return Math.max(0, readNumber(request, param, envKey, fallback)) * 60_000;
}

function readInteger(request: NextRequest, param: string, envKey: string, fallback: number) {
  return Math.max(0, Math.floor(readNumber(request, param, envKey, fallback)));
}

function readNumber(request: NextRequest, param: string, envKey: string, fallback: number) {
  const raw = request.nextUrl.searchParams.get(param) || process.env[envKey];
  const value = raw == null ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readBoolean(request: NextRequest, param: string, envKey: string, fallback: boolean) {
  const raw = request.nextUrl.searchParams.get(param) || process.env[envKey];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "sim", "on"].includes(String(raw).toLowerCase());
}

function serializeRules(rules: WitMonitorRules) {
  return {
    alertNewTickets: rules.alertNewTickets,
    queueAlertMinutes: Math.round(rules.queueAlertMs / 60_000),
    attendanceAlertMinutes: Math.round(rules.attendanceAlertMs / 60_000),
    activeTicketsAlertCount: rules.activeTicketsAlertCount,
    repeatAlertMinutes: Math.round(rules.repeatAlertMs / 60_000),
  };
}

function serializeAlert(alert: WitAlert) {
  return {
    reason: alert.reason,
    severity: alert.severity,
    message: alert.message,
    ticketId: alert.ticket?.id,
    ticket: alert.ticket,
  };
}

function reasonLabel(reason: WitAlertReason) {
  const labels: Record<WitAlertReason, string> = {
    new_ticket: "nova conversa/ticket",
    queue_time: "tempo em fila acima do limite",
    attendance_time: "tempo em atendimento acima do limite",
    active_volume: "volume de tickets ativos acima do limite",
  };
  return labels[reason];
}

function severityRank(severity: WitAlertSeverity) {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
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
