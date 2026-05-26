import { NextRequest, NextResponse } from "next/server";
import { ixcApi, type IxcFatura } from "@/lib/ixc";
import { buildBillingCadenceCustomerMessage, getBillingCadenceGuard, type BillingCadenceGuard } from "@/lib/billing-cadence";

const MAX_CLIENTES = 20;

type CadenceStage = "D-5" | "D0" | "D+3";
type PreviewStatus = "ready" | "blocked";

type PreviewItem = {
  idCliente: string;
  faturaId?: string;
  valor?: string;
  dataVencimento?: string;
  diasRelativos?: number;
  etapa?: CadenceStage;
  status: PreviewStatus;
  motivo: string;
  hasPix?: boolean;
  hasLinhaDigitavel?: boolean;
  hasLink?: boolean;
  messagePreview?: string;
  guard?: { canProceed: boolean; alreadySent: boolean; exceptionActive: boolean; reasons: string[] };
};

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids") || request.nextUrl.searchParams.get("idCliente") || "";
  const ids = normalizeIds(idsParam);

  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "Informe pelo menos um ID de cliente." }, { status: 400 });
  }

  if (ids.length > MAX_CLIENTES) {
    return NextResponse.json({ ok: false, error: `Limite de ${MAX_CLIENTES} clientes por preview.` }, { status: 400 });
  }

  const items: PreviewItem[] = [];
  for (const idCliente of ids) {
    const result = await ixcApi.getFaturasCliente(idCliente);

    if (result.unavailable) {
      items.push(blocked(idCliente, "IXC indisponível ou sem resposta. Régua bloqueada para este cliente."));
      continue;
    }

    if (result.items.length === 0) {
      items.push(blocked(idCliente, "Nenhuma fatura aberta localizada. Nada entra na régua."));
      continue;
    }

    if (result.items.length > 1) {
      const candidates = await Promise.all(result.items.map((fatura) => toPreviewCandidate(idCliente, fatura, "Cliente possui múltiplas faturas abertas. Envio automático bloqueado; precisa conferência humana.")));
      items.push(...candidates);
      continue;
    }

    items.push(await toPreviewCandidate(idCliente, result.items[0]));
  }

  return NextResponse.json({
    ok: true,
    dryRun: true,
    safety: "Preview interno. Não envia WhatsApp, não baixa pagamento e não altera IXC.",
    totalClientes: ids.length,
    resumo: buildResumo(items),
    items,
  });
}

function normalizeIds(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => /^\d+$/.test(item))
  ));
}

async function toPreviewCandidate(idCliente: string, fatura: IxcFatura, forcedBlockReason?: string): Promise<PreviewItem> {
  const due = parseDueDate(fatura.data_vencimento || "");
  const diffDays = due ? diffFromToday(due) : null;
  const etapa = diffDays === null ? null : stageForDiff(diffDays);
  const linhaDigitavel = fatura.linha_digitavel || fatura.boleto || "";
  const pix = fatura.pix_copia_cola || fatura.pix || "";
  const link = fatura.link || fatura.gateway_link || "";

  const guard = etapa ? await getBillingCadenceGuard({ idCliente, faturaId: fatura.id, stage: etapa }) : null;

  if (forcedBlockReason) {
    return baseItem(idCliente, fatura, diffDays, etapa, "blocked", forcedBlockReason, pix, linhaDigitavel, link, guard);
  }

  if (!due || diffDays === null) {
    return baseItem(idCliente, fatura, diffDays, etapa, "blocked", "Vencimento inválido ou ausente. Régua bloqueada.", pix, linhaDigitavel, link, guard);
  }

  if (!etapa) {
    return baseItem(idCliente, fatura, diffDays, etapa, "blocked", "Fatura aberta, mas fora das etapas D-5, D0 ou D+3.", pix, linhaDigitavel, link, guard);
  }

  if (!pix && !linhaDigitavel && !link) {
    return baseItem(idCliente, fatura, diffDays, etapa, "blocked", "Fatura na etapa da régua, mas sem PIX, linha digitável ou link disponível.", pix, linhaDigitavel, link, guard);
  }

  if (guard && !guard.canProceed) {
    return baseItem(idCliente, fatura, diffDays, etapa, "blocked", guard.reasons.join(" "), pix, linhaDigitavel, link, guard);
  }

  return baseItem(idCliente, fatura, diffDays, etapa, "ready", "Elegível para preview da régua. Envio automático ainda bloqueado por política.", pix, linhaDigitavel, link, guard);
}

function baseItem(
  idCliente: string,
  fatura: IxcFatura,
  diffDays: number | null,
  etapa: CadenceStage | null,
  status: PreviewStatus,
  motivo: string,
  pix: string,
  linhaDigitavel: string,
  link: string,
  guard?: BillingCadenceGuard | null
): PreviewItem {
  return {
    idCliente,
    faturaId: fatura.id,
    valor: fatura.valor_aberto || fatura.valor || "",
    dataVencimento: fatura.data_vencimento || "",
    diasRelativos: diffDays ?? undefined,
    etapa: etapa ?? undefined,
    status,
    motivo,
    hasPix: Boolean(pix),
    hasLinhaDigitavel: Boolean(linhaDigitavel),
    hasLink: Boolean(link),
    messagePreview: etapa && status === "ready" ? buildCadenceMessagePreview(etapa, { id: fatura.id, valor: fatura.valor_aberto || fatura.valor || "", dataVencimento: fatura.data_vencimento || "" }) : undefined,
    guard: guard ? { canProceed: guard.canProceed, alreadySent: guard.alreadySent, exceptionActive: guard.exceptionActive, reasons: guard.reasons } : undefined,
  };
}

function buildCadenceMessagePreview(etapa: CadenceStage, fatura: { id: string; valor: string; dataVencimento: string }) {
  return buildBillingCadenceCustomerMessage({ stage: etapa, faturaId: fatura.id, valor: fatura.valor, dataVencimento: fatura.dataVencimento });
}

function blocked(idCliente: string, motivo: string): PreviewItem {
  return { idCliente, status: "blocked", motivo };
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

function stageForDiff(diffDays: number): CadenceStage | null {
  if (diffDays === 5) return "D-5";
  if (diffDays === 0) return "D0";
  if (diffDays === -3) return "D+3";
  return null;
}

function buildResumo(items: PreviewItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ready") acc.ready += 1;
      else acc.blocked += 1;
      if (item.etapa) acc.etapas[item.etapa] += 1;
      return acc;
    },
    { total: 0, ready: 0, blocked: 0, etapas: { "D-5": 0, D0: 0, "D+3": 0 } as Record<CadenceStage, number> }
  );
}
