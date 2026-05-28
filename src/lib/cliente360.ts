import { getAcsDeviceForCliente, type AcsDeviceSummary } from "@/lib/acs";
import { ixcApi, type IxcCliente, type IxcContrato, type IxcFatura } from "@/lib/ixc";

export type Cliente360Status = "ok" | "not_found" | "multiple" | "partial";

export type Cliente360Payload = {
  status: Cliente360Status;
  query: string;
  clientesEncontrados?: IxcCliente[];
  cliente?: IxcCliente;
  contratos?: IxcContrato[];
  faturas?: IxcFatura[];
  acs?: AcsDeviceSummary;
  diagnostico?: string[];
  proximasAcoes?: string[];
  unavailable?: {
    cliente?: boolean;
    contratos?: boolean;
    faturas?: boolean;
    rede?: boolean;
    acs?: boolean;
  };
};

export async function getCliente360(query: string): Promise<Cliente360Payload> {
  const clean = query.trim();
  const clientes = await ixcApi.buscarClientes(clean).catch(() => ({ total: 0, items: [] as IxcCliente[] }));

  if (!clientes.items.length) {
    return {
      status: "not_found",
      query: clean,
      diagnostico: ["Cliente não localizado no IXC com o termo informado."],
      proximasAcoes: ["Tentar CPF/CNPJ, telefone com DDD, ID do cliente ou parte mais específica do nome."],
    };
  }

  if (clientes.items.length > 1) {
    return {
      status: "multiple",
      query: clean,
      clientesEncontrados: clientes.items.slice(0, 5),
      diagnostico: ["Mais de um cliente encontrado. A Ficha 360 exige cliente único para evitar diagnóstico errado."],
      proximasAcoes: ["Refinar a busca com ID, CPF/CNPJ ou telefone."],
    };
  }

  const cliente = clientes.items[0];
  const [contratosResult, faturasResult] = await Promise.all([
    ixcApi.getContratosCliente(cliente.id).catch(() => ({ total: 0, items: [] as IxcContrato[], unavailable: true })),
    ixcApi.getFaturasCliente(cliente.id).catch(() => ({ total: 0, items: [] as IxcFatura[], unavailable: true })),
  ]);

  const contratos = contratosResult.items || [];
  const faturas = faturasResult.items || [];
  const acs = await getAcsDeviceForCliente(cliente, contratos);
  const unavailable = {
    contratos: "unavailable" in contratosResult && Boolean(contratosResult.unavailable),
    faturas: "unavailable" in faturasResult && Boolean(faturasResult.unavailable),
    rede: true,
    acs: !acs.found,
  };

  return {
    status: unavailable.contratos || unavailable.faturas ? "partial" : "ok",
    query: clean,
    cliente,
    contratos,
    faturas,
    acs,
    diagnostico: buildDiagnostico(cliente, contratos, faturas, unavailable, acs),
    proximasAcoes: buildProximasAcoes(contratos, faturas, unavailable, acs),
    unavailable,
  };
}

function buildDiagnostico(cliente: IxcCliente, contratos: IxcContrato[], faturas: IxcFatura[], unavailable: Cliente360Payload["unavailable"], acs?: AcsDeviceSummary) {
  const lines: string[] = [];
  const clienteStatus = normalizeClienteStatus(cliente);
  const ativos = contratos.filter(isContratoAtivo360);
  const bloqueados = contratos.filter(isContratoInternetBloqueada);
  const faturasAtrasadas = faturas.filter((fatura) => isFaturaVencida(fatura));

  if (faturasAtrasadas.length > 0 || bloqueados.length > 0 || clienteStatus === "bloqueado") {
    const oldest = getOldestFatura(faturasAtrasadas);
    const since = oldest?.data_vencimento ? ` desde ${oldest.data_vencimento}` : "";
    lines.push(`Cliente com indício de bloqueio/pendência financeira${since}.`);
  } else if (faturas.length > 0) {
    lines.push(`Cliente possui ${faturas.length} fatura(s) aberta(s), mas sem atraso identificado nesta consulta.`);
  } else {
    lines.push("Sem fatura aberta localizada no IXC nesta consulta.");
  }

  if (ativos.length > 0) lines.push(`${ativos.length} contrato(s) ativo(s) localizado(s).`);
  if (contratos.length === 0 && !unavailable?.contratos) lines.push("Nenhum contrato localizado para este cliente no IXC.");
  if (unavailable?.contratos) lines.push("Contratos indisponíveis no IXC no momento.");
  if (unavailable?.faturas) lines.push("Financeiro indisponível no IXC no momento.");
  if (acs?.found) {
    lines.push(`ACS encontrou CPE${acs.model ? ` modelo ${acs.model}` : ""}${acs.online === false ? " offline" : acs.online === true ? " online" : ""}.`);
  } else if (acs?.enabled) {
    lines.push(acs.message || acs.error || "ACS habilitado, mas CPE ainda não localizado para este cliente.");
  } else {
    lines.push("Dados de rede/ACS ainda não integrados: IP, concentrador, sessão PPPoE, sinal e Wi-Fi aparecem como pendentes.");
  }

  return lines;
}

function buildProximasAcoes(contratos: IxcContrato[], faturas: IxcFatura[], unavailable: Cliente360Payload["unavailable"], acs?: AcsDeviceSummary) {
  const actions: string[] = [];
  const bloqueados = contratos.filter(isContratoInternetBloqueada);
  const faturasAtrasadas = faturas.filter((fatura) => isFaturaVencida(fatura));

  if (unavailable?.faturas || unavailable?.contratos) {
    actions.push("Se o cliente estiver aguardando, conferir manualmente no IXC antes de concluir atendimento.");
  }

  if (faturasAtrasadas.length > 0 || bloqueados.length > 0) {
    actions.push("Priorizar orientação financeira/fatura segura antes de abrir chamado técnico.");
  } else if (faturas.length > 0) {
    actions.push("Se a fatura ainda não venceu e a internet está ativa, seguir com diagnóstico técnico normalmente.");
  } else {
    actions.push("Se reclamação for técnica, seguir para diagnóstico de rede/ACS quando a integração for ligada.");
  }

  if (acs?.found) {
    actions.push("Usar dados do ACS apenas para diagnóstico. Alteração de Wi-Fi continua bloqueada até etapa de escrita segura.");
  }
  actions.push("Não alterar Wi-Fi, ACS ou concentrador sem confirmação explícita do cliente e trilha de auditoria.");
  return actions;
}

export function normalizeClienteStatus(cliente: IxcCliente) {
  const blocked = String(cliente.bloqueado || "").trim().toUpperCase();
  if (["S", "SIM", "B", "BLOQUEADO", "BLOQUEADA"].includes(blocked)) return "bloqueado";
  const status = String(cliente.status || cliente.status_cliente || cliente.ativo || "").trim().toUpperCase();
  if (["A", "ATIVO", "ACTIVE", "S", "SIM", "1", "TRUE"].includes(status)) return "ativo";
  if (["I", "INATIVO", "INACTIVE", "D", "DESATIVADO", "DESATIVADA", "N", "NAO", "NÃO", "0", "FALSE"].includes(status)) return "desativado";
  if (["B", "BLOQUEADO", "BLOQUEADA", "SUSPENSO", "SUSPENSA"].includes(status)) return "bloqueado";
  if (["C", "CANCELADO", "CANCELADA"].includes(status)) return "cancelado";
  return status ? status.toLowerCase() : "não informado";
}

export function isContratoAtivo360(contrato: IxcContrato) {
  const status = String(contrato.status || "").trim().toUpperCase();
  const internet = String(contrato.status_internet || "").trim().toUpperCase();
  return ["A", "ATIVO", "ATIVA"].includes(status) || ["A", "ATIVO", "ATIVA", "AA"].includes(internet);
}

export function isContratoInternetBloqueada(contrato: IxcContrato) {
  const internet = String(contrato.status_internet || "").trim().toUpperCase();
  // No IXC, bloqueio_automatico = Sim costuma indicar que o contrato PODE ser bloqueado automaticamente,
  // não que o cliente esteja bloqueado agora. O bloqueio real deve vir do status_internet/status do cliente
  // ou de fatura vencida.
  return ["CM", "BLOQUEADO", "BLOQUEADA", "B", "SUSPENSO", "SUSPENSA"].includes(internet);
}

export function isFaturaVencida(fatura: IxcFatura, now = new Date()) {
  const due = parseDate(fatura.data_vencimento || "");
  if (!due) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}

export function getOldestFatura(faturas: IxcFatura[]) {
  return [...faturas].sort((a, b) => {
    const left = parseDate(a.data_vencimento || "")?.getTime() || Number.MAX_SAFE_INTEGER;
    const right = parseDate(b.data_vencimento || "")?.getTime() || Number.MAX_SAFE_INTEGER;
    return left - right;
  })[0];
}

export function parseDate(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
