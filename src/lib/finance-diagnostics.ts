import { appendAudit } from "@/lib/audit";
import { ixcApi, type IxcCliente, type IxcContrato, type IxcFatura } from "@/lib/ixc";

export type FinanceDiagnosticClient = {
  idCliente: string;
  nome: string;
  contratoId: string;
  statusContrato: string;
  statusInternet: string;
  totalFaturasAbertas: number;
  totalFaturasVencidas: number;
  valorAberto: number;
  faturaMaisAntiga?: {
    id: string;
    vencimento: string;
    valor: string;
  };
};

export type FinanceDiagnosticResult = {
  ok: boolean;
  generatedAt: string;
  limit: number;
  sourceFilter?: string;
  totalContratosAvaliados: number;
  totalClientesAvaliados: number;
  unavailable?: boolean;
  inadimplentesCriticos: FinanceDiagnosticClient[];
  semBoletoAberto: FinanceDiagnosticClient[];
};

export async function buildFinanceDiagnostic(options: { limit?: number; minOverdue?: number; auditSource?: string } = {}): Promise<FinanceDiagnosticResult> {
  const limit = Math.min(Math.max(options.limit || Number(process.env.FINANCE_DIAGNOSTIC_LIMIT || "40"), 1), 200);
  const minOverdue = Math.min(Math.max(options.minOverdue || Number(process.env.FINANCE_OVERDUE_ALERT_COUNT || "3"), 1), 12);
  const contratosResult = await ixcApi.getContratosAtivosFinanceiro(limit);
  const uniqueContracts = dedupeContractsByClient(contratosResult.items).slice(0, limit);
  const clients: FinanceDiagnosticClient[] = [];

  for (const contrato of uniqueContracts) {
    if (!contrato.id_cliente) continue;
    const [cliente, faturasResult] = await Promise.all([
      ixcApi.getCliente(contrato.id_cliente).catch(() => null),
      ixcApi.getFaturasCliente(contrato.id_cliente).catch(() => ({ total: 0, items: [] as IxcFatura[], unavailable: true })),
    ]);

    clients.push(toDiagnosticClient(contrato, cliente, faturasResult.items || []));
  }

  const inadimplentesCriticos = clients
    .filter((client) => client.totalFaturasVencidas >= minOverdue)
    .sort((a, b) => b.totalFaturasVencidas - a.totalFaturasVencidas || b.valorAberto - a.valorAberto);
  const semBoletoAberto = clients
    .filter((client) => client.totalFaturasAbertas === 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const result: FinanceDiagnosticResult = {
    ok: !contratosResult.unavailable,
    generatedAt: new Date().toISOString(),
    limit,
    sourceFilter: contratosResult.sourceFilter,
    totalContratosAvaliados: uniqueContracts.length,
    totalClientesAvaliados: clients.length,
    unavailable: contratosResult.unavailable,
    inadimplentesCriticos,
    semBoletoAberto,
  };

  await appendAudit({
    action: "finance_ixc_diagnostic",
    status: result.ok ? "success" : "partial",
    source: options.auditSource || "system",
    totalClientes: result.totalClientesAvaliados,
    inadimplentesCriticos: result.inadimplentesCriticos.length,
    semBoletoAberto: result.semBoletoAberto.length,
  }).catch(() => undefined);

  return result;
}

function dedupeContractsByClient(contratos: IxcContrato[]) {
  const seen = new Set<string>();
  const result: IxcContrato[] = [];
  for (const contrato of contratos) {
    if (!contrato.id_cliente || seen.has(contrato.id_cliente)) continue;
    seen.add(contrato.id_cliente);
    result.push(contrato);
  }
  return result;
}

function toDiagnosticClient(contrato: IxcContrato, cliente: IxcCliente | null, faturas: IxcFatura[]): FinanceDiagnosticClient {
  const vencidas = faturas.filter((fatura) => isOverdue(fatura.data_vencimento || ""));
  const faturaMaisAntiga = [...faturas].sort(compareFaturaDueDate)[0];
  return {
    idCliente: contrato.id_cliente,
    nome: cliente?.razao || cliente?.fantasia || `Cliente ${contrato.id_cliente}`,
    contratoId: contrato.id || "",
    statusContrato: contrato.status || "",
    statusInternet: contrato.status_internet || "",
    totalFaturasAbertas: faturas.length,
    totalFaturasVencidas: vencidas.length,
    valorAberto: faturas.reduce((sum, fatura) => sum + parseMoney(fatura.valor_aberto || fatura.valor), 0),
    faturaMaisAntiga: faturaMaisAntiga ? {
      id: faturaMaisAntiga.id,
      vencimento: faturaMaisAntiga.data_vencimento || "",
      valor: faturaMaisAntiga.valor_aberto || faturaMaisAntiga.valor || "",
    } : undefined,
  };
}

function compareFaturaDueDate(a: IxcFatura, b: IxcFatura) {
  return (parseDate(a.data_vencimento || "")?.getTime() || Number.MAX_SAFE_INTEGER) - (parseDate(b.data_vencimento || "")?.getTime() || Number.MAX_SAFE_INTEGER);
}

function isOverdue(value: string, now = new Date()) {
  const due = parseDate(value);
  if (!due) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}

function parseDate(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMoney(value?: string) {
  if (!value) return 0;
  const normalized = String(value).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
