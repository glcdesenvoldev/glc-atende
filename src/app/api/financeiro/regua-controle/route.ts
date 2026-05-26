import { NextRequest, NextResponse } from "next/server";
import { buildBillingCadenceCustomerMessage, disableBillingCadenceException, getBillingCadenceGuard, listBillingCadenceExceptions, listBillingCadenceHistory, recordBillingCadenceEvent, upsertBillingCadenceException, type BillingCadenceStage } from "@/lib/billing-cadence";
import { getBillingCadenceEvolutionConfig, maskWhatsAppNumber, normalizeBrazilWhatsAppNumber, sendEvolutionText } from "@/lib/evolution";
import { ixcApi, type IxcFatura } from "@/lib/ixc";

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") || "100");
  const [history, exceptions] = await Promise.all([
    listBillingCadenceHistory(Number.isFinite(limit) ? limit : 100),
    listBillingCadenceExceptions(),
  ]);
  const evolution = getBillingCadenceEvolutionConfig();
  return NextResponse.json({
    ok: true,
    history,
    exceptions,
    dispatch: {
      whatsappEnabled: evolution.enabled,
      evolutionConfigured: Boolean(evolution.url && evolution.apiKey && evolution.instance),
      instanceConfigured: Boolean(evolution.instance),
      safety: evolution.enabled
        ? "Envio WhatsApp da régua liberado por configuração. Ainda revalida IXC, telefone, anti-duplicidade e opt-out antes de enviar."
        : "Envio WhatsApp da régua bloqueado por configuração. Configure BILLING_CADENCE_WHATSAPP_ENABLED=1 somente após aprovação do número definitivo.",
    },
    safety: "Controle interno. Não envia WhatsApp e não altera IXC sem liberação explícita por configuração.",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "add_exception") {
    const idCliente = normalizeId(body.idCliente);
    if (!idCliente) return NextResponse.json({ ok: false, error: "idCliente obrigatório." }, { status: 400 });
    const exception = await upsertBillingCadenceException({ idCliente, reason: String(body.reason || "Exceção manual"), createdBy: "dashboard" });
    return NextResponse.json({ ok: true, exception });
  }

  if (action === "remove_exception") {
    const idCliente = normalizeId(body.idCliente);
    if (!idCliente) return NextResponse.json({ ok: false, error: "idCliente obrigatório." }, { status: 400 });
    const exception = await disableBillingCadenceException({ idCliente, createdBy: "dashboard" });
    return NextResponse.json({ ok: true, exception });
  }

  if (action === "record_dry_run") {
    const idCliente = normalizeId(body.idCliente);
    const faturaId = normalizeText(body.faturaId);
    const stage = normalizeStage(body.stage);
    if (!idCliente || !faturaId || !stage) return NextResponse.json({ ok: false, error: "idCliente, faturaId e stage são obrigatórios." }, { status: 400 });
    const event = await recordBillingCadenceEvent({ idCliente, faturaId, stage, status: "dry_run", reason: String(body.reason || "Registro dry-run manual"), createdBy: "dashboard" });
    return NextResponse.json({ ok: true, event });
  }

  if (action === "send_whatsapp") {
    const idCliente = normalizeId(body.idCliente);
    const faturaId = normalizeText(body.faturaId);
    const stage = normalizeStage(body.stage);
    if (!idCliente || !faturaId || !stage) return NextResponse.json({ ok: false, error: "idCliente, faturaId e stage são obrigatórios." }, { status: 400 });
    const result = await dispatchBillingCadenceWhatsApp({ idCliente, faturaId, stage });
    const status = result.ok || result.blocked ? 200 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ ok: false, error: "Ação inválida." }, { status: 400 });
}

async function dispatchBillingCadenceWhatsApp(input: { idCliente: string; faturaId: string; stage: BillingCadenceStage }) {
  const evolution = getBillingCadenceEvolutionConfig();

  const candidate = await buildDispatchCandidate(input);
  if (!candidate.ok) {
    await recordBillingCadenceEvent({ idCliente: input.idCliente, faturaId: input.faturaId, stage: input.stage, status: "blocked", reason: candidate.reason, createdBy: "dashboard" });
    return { ok: false, blocked: true, reason: candidate.reason, safety: "Bloqueado antes do envio. Nenhum WhatsApp foi enviado." };
  }

  if (!evolution.enabled) {
    return {
      ok: false,
      blocked: true,
      reason: "Envio WhatsApp da régua está bloqueado por configuração até aprovação do número definitivo.",
      maskedPhone: maskWhatsAppNumber(candidate.phone),
      messagePreview: candidate.message,
      safety: "Nenhum WhatsApp foi enviado. Para liberar futuramente: configurar BILLING_CADENCE_WHATSAPP_ENABLED=1 após aprovação explícita.",
    };
  }

  const sent = await sendEvolutionText({ number: candidate.phone, text: candidate.message });
  if (!sent.ok) {
    await recordBillingCadenceEvent({ idCliente: input.idCliente, faturaId: input.faturaId, stage: input.stage, status: "failed", reason: sent.reason, createdBy: "dashboard" });
    return { ok: false, blocked: false, reason: sent.reason, safety: "Tentativa falhou. Evento registrado sem dados sensíveis." };
  }

  const event = await recordBillingCadenceEvent({
    idCliente: input.idCliente,
    faturaId: input.faturaId,
    stage: input.stage,
    status: "sent",
    reason: "Mensagem da régua enviada via Evolution API",
    providerMessageId: sent.messageId,
    createdBy: "dashboard",
  });

  return { ok: true, event, maskedPhone: maskWhatsAppNumber(candidate.phone), safety: "WhatsApp enviado via Evolution API e registrado na auditoria da régua." };
}

async function buildDispatchCandidate(input: { idCliente: string; faturaId: string; stage: BillingCadenceStage }): Promise<
  | { ok: true; phone: string; message: string }
  | { ok: false; reason: string }
> {
  const [cliente, safeFatura] = await Promise.all([
    ixcApi.getCliente(input.idCliente),
    ixcApi.getFaturaSeguraCliente(input.idCliente),
  ]);

  if (!cliente) return { ok: false, reason: "Cliente não localizado no IXC." };
  if (!safeFatura.ok) return { ok: false, reason: safeFaturaReason(safeFatura.reason, safeFatura.total) };
  if (safeFatura.fatura.id !== input.faturaId) return { ok: false, reason: "Fatura informada não é a fatura única segura atual do cliente." };

  const due = parseDueDate(safeFatura.fatura.data_vencimento || "");
  const stage = due ? stageForDiff(diffFromToday(due)) : null;
  if (!stage || stage !== input.stage) return { ok: false, reason: "Fatura não está mais na etapa informada da régua. Refaça o preview antes de enviar." };

  const guard = await getBillingCadenceGuard({ idCliente: input.idCliente, faturaId: input.faturaId, stage: input.stage });
  if (!guard.canProceed) return { ok: false, reason: guard.reasons.join(" ") };

  const phone = normalizeBrazilWhatsAppNumber(cliente.telefone_celular || cliente.fone_celular || cliente.fone || "");
  if (!phone) return { ok: false, reason: "Cliente sem telefone WhatsApp válido no IXC." };

  if (!hasPaymentMethod(safeFatura.fatura)) return { ok: false, reason: "Fatura sem PIX, linha digitável ou link disponível." };

  return {
    ok: true,
    phone,
    message: buildBillingCadenceCustomerMessage({
      stage: input.stage,
      faturaId: safeFatura.fatura.id,
      valor: safeFatura.fatura.valor_aberto || safeFatura.fatura.valor || "",
      dataVencimento: safeFatura.fatura.data_vencimento || "",
    }),
  };
}

function hasPaymentMethod(fatura: IxcFatura) {
  return Boolean(fatura.pix_copia_cola || fatura.pix || fatura.linha_digitavel || fatura.boleto || fatura.link || fatura.gateway_link);
}

function safeFaturaReason(reason: "unavailable" | "none" | "multiple", total: number) {
  if (reason === "unavailable") return "IXC indisponível. Envio bloqueado.";
  if (reason === "none") return "Cliente sem fatura aberta. Envio bloqueado.";
  return `Cliente possui ${total} faturas abertas. Envio bloqueado para conferência humana.`;
}

function normalizeId(value: unknown) {
  const clean = String(value || "").trim();
  return /^\d+$/.test(clean) ? clean : "";
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeStage(value: unknown): BillingCadenceStage | null {
  const clean = String(value || "").trim();
  if (clean === "D-5" || clean === "D0" || clean === "D+3") return clean;
  return null;
}

function parseDueDate(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffFromToday(due: Date) {
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - startToday.getTime()) / 86400000);
}

function stageForDiff(diffDays: number): BillingCadenceStage | null {
  if (diffDays === 5) return "D-5";
  if (diffDays === 0) return "D0";
  if (diffDays === -3) return "D+3";
  return null;
}
