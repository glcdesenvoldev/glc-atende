import { NextRequest, NextResponse } from "next/server";
import { appendAudit, hasSeenEvent, markEventSeen } from "@/lib/audit";
import { ixcApi, type IxcChamado } from "@/lib/ixc";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";

const CRITICAL_WORDS = [
  "sem internet",
  "sem sinal",
  "caiu",
  "queda",
  "los",
  "rompimento",
  "lento",
  "lentidão",
  "cancelar",
  "cancelamento",
  "boleto",
  "segunda via",
  "técnico",
  "tecnico",
];

export async function GET(request: NextRequest) {
  return runMonitor(request);
}

export async function POST(request: NextRequest) {
  return runMonitor(request);
}

async function runMonitor(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const baseline = request.nextUrl.searchParams.get("baseline") === "1";
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  const { total, items } = await ixcApi.getChamados(1, "A");
  const novos: IxcChamado[] = [];
  const ignorados: string[] = [];

  for (const chamado of items) {
    if (!chamado.id) continue;
    const seenKey = `ixc:${chamado.id}`;
    if (await hasSeenEvent(seenKey)) {
      ignorados.push(chamado.id);
      continue;
    }

    if (!dryRun) await markEventSeen(seenKey);
    if (!baseline) novos.push(chamado);
  }

  if (!baseline && !dryRun && novos.length > 0) {
    await notifyTelegram(novos, total);
  }

  await appendAudit({
    source: "ixc_monitor",
    action: baseline ? "baseline" : dryRun ? "dry_run" : "poll",
    total,
    newCount: novos.length,
    ignoredCount: ignorados.length,
    ids: novos.map((chamado) => chamado.id),
  });

  return NextResponse.json({
    ok: true,
    mode: baseline ? "baseline" : dryRun ? "dryRun" : "poll",
    total,
    newCount: novos.length,
    ignoredCount: ignorados.length,
    newIds: novos.map((chamado) => chamado.id),
  });
}

async function notifyTelegram(chamados: IxcChamado[], total: number) {
  const groupId = process.env.TELEGRAM_GROUP_ID || process.env.TELEGRAM_ALLOWED_GROUPS?.split(",")[0]?.trim();
  if (!groupId) return { ok: false, skipped: "telegram_group_not_configured" };

  const lines = chamados.slice(0, 8).map(formatChamadoMonitor);
  const extra = chamados.length > 8 ? `\n\n...e mais ${chamados.length - 8} chamado(s).` : "";
  const message = [
    "📡 Monitor IXC — novo(s) chamado(s) aberto(s)",
    "",
    `Total aberto no IXC: ${total}`,
    "",
    lines.join("\n\n"),
    extra,
    "",
    "Use /chamados para consultar a fila atual.",
  ].join("\n");

  return sendTelegramMessage(groupId, message);
}

function formatChamadoMonitor(chamado: IxcChamado) {
  const texto = `${chamado.assunto || ""} ${chamado.descricao || ""}`.toLowerCase();
  const palavras = CRITICAL_WORDS.filter((word) => texto.includes(word));
  const critical = palavras.length > 0 ? `\nPalavra crítica: ${palavras.slice(0, 3).join(", ")}` : "";
  const prioridade = chamado.prioridade || "-";

  return [
    `#${escapeHtml(chamado.id)} — ${escapeHtml(chamado.assunto || "Sem assunto")}`,
    `Cliente: ${escapeHtml(chamado.nome_cliente || chamado.id_cliente || "não informado")}`,
    `Prioridade: ${escapeHtml(prioridade)} · Aberto: ${escapeHtml(chamado.data_abertura || "-")}`,
    critical,
  ].filter(Boolean).join("\n");
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
