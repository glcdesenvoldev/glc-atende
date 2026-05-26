import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendAudit } from "@/lib/audit";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const financeDir = path.join(dataDir, "financeiro");
const historyFile = path.join(financeDir, "regua-cobranca-historico.json");
const exceptionsFile = path.join(financeDir, "regua-cobranca-excecoes.json");

export type BillingCadenceStage = "D-5" | "D0" | "D+3";
export type BillingCadenceChannel = "whatsapp";
export type BillingCadenceEventStatus = "dry_run" | "sent" | "blocked" | "failed";
export type BillingCadenceExceptionStatus = "active" | "inactive";

export type BillingCadenceHistoryEvent = {
  id: string;
  idCliente: string;
  faturaId: string;
  stage: BillingCadenceStage;
  channel: BillingCadenceChannel;
  status: BillingCadenceEventStatus;
  createdAt: string;
  createdBy: string;
  reason?: string;
  providerMessageId?: string;
};

export type BillingCadenceException = {
  id: string;
  idCliente: string;
  status: BillingCadenceExceptionStatus;
  reason: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type BillingCadenceGuard = {
  canProceed: boolean;
  alreadySent: boolean;
  exceptionActive: boolean;
  reasons: string[];
  lastEvent?: BillingCadenceHistoryEvent;
  exception?: BillingCadenceException;
};

export function buildBillingCadenceCustomerMessage(input: {
  stage: BillingCadenceStage;
  faturaId: string;
  valor: string;
  dataVencimento: string;
}) {
  const header = input.stage === "D-5"
    ? "Olá! Passando para lembrar que sua fatura da GLC Internet vence em 5 dias."
    : input.stage === "D0"
      ? "Olá! Sua fatura da GLC Internet vence hoje."
      : "Olá! Identificamos uma fatura da GLC Internet vencida há 3 dias.";

  const footer = input.stage === "D+3"
    ? "Se o pagamento já foi realizado, por favor desconsidere esta mensagem. Caso precise de ajuda, fale com nosso atendimento."
    : "Se já realizou o pagamento, por favor desconsidere esta mensagem. Qualquer dúvida, estamos à disposição.";

  return [
    header,
    "",
    `Fatura: ${input.faturaId || "-"}`,
    `Valor: ${formatBillingMoney(input.valor)}`,
    `Vencimento: ${input.dataVencimento || "-"}`,
    "",
    "Para sua segurança, confira os dados antes de pagar e use apenas os canais oficiais da GLC Internet.",
    footer,
  ].join("\n");
}

function formatBillingMoney(value: string) {
  return value ? `R$ ${value}` : "-";
}

export async function getBillingCadenceGuard(input: { idCliente: string; faturaId?: string; stage?: BillingCadenceStage }): Promise<BillingCadenceGuard> {
  const [history, exceptions] = await Promise.all([readHistory(), readExceptions()]);
  const exception = exceptions.find((item) => item.idCliente === input.idCliente && item.status === "active");
  const matchingEvents = history
    .filter((event) => event.idCliente === input.idCliente && event.faturaId === input.faturaId && event.stage === input.stage && event.channel === "whatsapp")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastEvent = matchingEvents[0];
  const alreadySent = matchingEvents.some((event) => event.status === "sent" || event.status === "dry_run");
  const reasons: string[] = [];

  if (exception) reasons.push(`Cliente em exceção/opt-out: ${exception.reason || "sem motivo informado"}.`);
  if (alreadySent) reasons.push("Etapa já registrada no histórico para esta fatura. Anti-duplicidade bloqueou novo disparo.");

  return {
    canProceed: reasons.length === 0,
    alreadySent,
    exceptionActive: Boolean(exception),
    reasons,
    lastEvent,
    exception,
  };
}

export async function listBillingCadenceHistory(limit = 100) {
  const history = await readHistory();
  return history.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function listBillingCadenceExceptions() {
  const exceptions = await readExceptions();
  return exceptions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function recordBillingCadenceEvent(input: {
  idCliente: string;
  faturaId: string;
  stage: BillingCadenceStage;
  status: BillingCadenceEventStatus;
  reason?: string;
  providerMessageId?: string;
  createdBy?: string;
}) {
  const now = new Date().toISOString();
  const history = await readHistory();
  const event: BillingCadenceHistoryEvent = {
    id: randomUUID(),
    idCliente: input.idCliente,
    faturaId: input.faturaId,
    stage: input.stage,
    channel: "whatsapp",
    status: input.status,
    reason: input.reason,
    providerMessageId: input.providerMessageId,
    createdAt: now,
    createdBy: input.createdBy || "system",
  };
  history.push(event);
  await writeHistory(history.slice(-1000));
  await appendAudit({ action: "billing_cadence_event", status: event.status, id: event.id, clientId: event.idCliente, faturaId: event.faturaId });
  return event;
}

export async function upsertBillingCadenceException(input: { idCliente: string; reason: string; createdBy?: string }) {
  const now = new Date().toISOString();
  const exceptions = await readExceptions();
  const existing = exceptions.find((item) => item.idCliente === input.idCliente);

  if (existing) {
    existing.status = "active";
    existing.reason = input.reason || existing.reason || "Exceção manual";
    existing.updatedAt = now;
    await writeExceptions(exceptions);
    await appendAudit({ action: "billing_cadence_exception_upsert", status: "active", id: existing.id, clientId: existing.idCliente, faturaId: "" });
    return existing;
  }

  const exception: BillingCadenceException = {
    id: randomUUID(),
    idCliente: input.idCliente,
    status: "active",
    reason: input.reason || "Exceção manual",
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy || "dashboard",
  };
  exceptions.push(exception);
  await writeExceptions(exceptions);
  await appendAudit({ action: "billing_cadence_exception_upsert", status: "active", id: exception.id, clientId: exception.idCliente, faturaId: "" });
  return exception;
}

export async function disableBillingCadenceException(input: { idCliente: string; createdBy?: string }) {
  const exceptions = await readExceptions();
  const existing = exceptions.find((item) => item.idCliente === input.idCliente && item.status === "active");
  if (!existing) return null;
  existing.status = "inactive";
  existing.updatedAt = new Date().toISOString();
  await writeExceptions(exceptions);
  await appendAudit({ action: "billing_cadence_exception_disable", status: "inactive", id: existing.id, clientId: existing.idCliente, faturaId: "" });
  return existing;
}

async function readHistory(): Promise<BillingCadenceHistoryEvent[]> {
  try {
    const content = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(history: BillingCadenceHistoryEvent[]) {
  await mkdir(financeDir, { recursive: true });
  await writeFile(historyFile, JSON.stringify(history, null, 2), "utf8");
}

async function readExceptions(): Promise<BillingCadenceException[]> {
  try {
    const content = await readFile(exceptionsFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeExceptions(exceptions: BillingCadenceException[]) {
  await mkdir(financeDir, { recursive: true });
  await writeFile(exceptionsFile, JSON.stringify(exceptions, null, 2), "utf8");
}
