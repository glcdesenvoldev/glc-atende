import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendAudit } from "@/lib/audit";
import type { IxcFatura } from "@/lib/ixc";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const financeDir = path.join(dataDir, "financeiro");
const approvalsFile = path.join(financeDir, "aprovacoes-envio.json");

export type ApprovalStatus = "pending" | "approved" | "rejected" | "manual_sent";
export type ApprovalTipo = "boleto_pix";

export type FinanceApproval = {
  id: string;
  status: ApprovalStatus;
  tipo: ApprovalTipo;
  idCliente: string;
  faturaId: string;
  valor: string;
  dataVencimento: string;
  hasLinhaDigitavel: boolean;
  hasPix: boolean;
  hasLink: boolean;
  linhaDigitavel?: string;
  pixCopiaCola?: string;
  link?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  decidedBy?: string;
  note?: string;
  safetyMessage: string;
};

export async function listFinanceApprovals() {
  const approvals = await readApprovals();
  return approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function createFinanceApproval(input: { idCliente: string; fatura: IxcFatura; createdBy?: string }) {
  const now = new Date().toISOString();
  const approvals = await readApprovals();
  const existing = approvals.find(
    (approval) => approval.status === "pending" && approval.idCliente === input.idCliente && approval.faturaId === input.fatura.id
  );

  if (existing) return { created: false, approval: existing };

  const linhaDigitavel = input.fatura.linha_digitavel || input.fatura.boleto || "";
  const pixCopiaCola = input.fatura.pix_copia_cola || input.fatura.pix || "";
  const approval: FinanceApproval = {
    id: randomUUID(),
    status: "pending",
    tipo: "boleto_pix",
    idCliente: input.idCliente,
    faturaId: input.fatura.id,
    valor: input.fatura.valor_aberto || input.fatura.valor || "",
    dataVencimento: input.fatura.data_vencimento || "",
    hasLinhaDigitavel: Boolean(linhaDigitavel),
    hasPix: Boolean(pixCopiaCola),
    hasLink: Boolean(input.fatura.link || input.fatura.gateway_link),
    linhaDigitavel: linhaDigitavel || undefined,
    pixCopiaCola: pixCopiaCola || undefined,
    link: input.fatura.link || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy || "dashboard",
    safetyMessage: "Solicitação interna criada. Envio externo ao cliente continua bloqueado até etapa específica com aprovação humana.",
  };

  approvals.push(approval);
  await writeApprovals(approvals);
  await appendAudit({ action: "finance_approval_create", status: "pending", id: approval.id, clientId: approval.idCliente, faturaId: approval.faturaId });
  return { created: true, approval };
}

export async function decideFinanceApproval(input: { id: string; action: "approve" | "reject"; note?: string; decidedBy?: string }) {
  const approvals = await readApprovals();
  const approval = approvals.find((item) => item.id === input.id);
  if (!approval) return null;

  approval.status = input.action === "approve" ? "approved" : "rejected";
  approval.updatedAt = new Date().toISOString();
  approval.decidedBy = input.decidedBy || "dashboard";
  approval.note = input.note || "";

  await writeApprovals(approvals);
  await appendAudit({ action: "finance_approval_decide", status: approval.status, id: approval.id, clientId: approval.idCliente, faturaId: approval.faturaId });
  return approval;
}


export async function markFinanceApprovalManualSent(input: { id: string; note?: string; decidedBy?: string }) {
  const approvals = await readApprovals();
  const approval = approvals.find((item) => item.id === input.id);
  if (!approval) return null;
  if (approval.status !== "approved" && approval.status !== "manual_sent") return { blocked: true as const, approval };

  approval.status = "manual_sent";
  approval.updatedAt = new Date().toISOString();
  approval.decidedBy = input.decidedBy || approval.decidedBy || "dashboard";
  approval.note = input.note || approval.note || "Marcado como enviado manualmente.";
  approval.safetyMessage = "Envio manual registrado. Nenhuma mensagem foi enviada automaticamente pelo sistema.";

  await writeApprovals(approvals);
  await appendAudit({ action: "finance_approval_manual_sent", status: approval.status, id: approval.id, clientId: approval.idCliente, faturaId: approval.faturaId });
  return { blocked: false as const, approval };
}

async function readApprovals(): Promise<FinanceApproval[]> {
  try {
    const content = await readFile(approvalsFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeApprovals(approvals: FinanceApproval[]) {
  await mkdir(financeDir, { recursive: true });
  await writeFile(approvalsFile, JSON.stringify(approvals, null, 2), "utf8");
}
