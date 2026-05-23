import { isCnpj, isCpf } from "@/lib/lgpd";

/**
 * IXC Soft API Client
 *
 * Tenta API direta primeiro. Em produção, nunca retorna dados mockados:
 * se o IXC falhar, a UI/API deve mostrar indisponibilidade ou lista vazia.
 */

const IXC_BASE = process.env.IXC_URL || "https://ixc.glcinternet.com.br/webservice/v1";
const IXC_TOKEN = process.env.IXC_TOKEN;

type IxcListResponse<T> = {
  page?: string;
  total?: string | number;
  registros?: Record<string, T> | T[];
};

function getAuthHeader() {
  if (!IXC_TOKEN) return null;
  const b64 = Buffer.from(IXC_TOKEN).toString("base64");
  return `Basic ${b64}`;
}

function normalizeRegistros<T>(registros: IxcListResponse<T>["registros"]): T[] {
  if (!registros) return [];
  return Array.isArray(registros) ? registros : Object.values(registros);
}

async function ixcRequest<T>(endpoint: string, body?: object): Promise<T | null> {
  const timeoutMs = Number(process.env.IXC_TIMEOUT_MS || "12000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const auth = getAuthHeader();
    if (!auth) return null;

    const res = await fetch(`${IXC_BASE}/${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "ixcsoft": "listar",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


async function ixcRequestRaw(endpoint: string, body?: object): Promise<string | null> {
  const timeoutMs = Number(process.env.IXC_TIMEOUT_MS || "12000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const auth = getAuthHeader();
    if (!auth) return null;

    const res = await fetch(`${IXC_BASE}/${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "ixcsoft": "listar",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface IxcChamado {
  id: string;
  assunto: string;
  descricao: string;
  status: string;
  prioridade: string;
  id_cliente: string;
  nome_cliente: string;
  data_abertura: string;
  data_update: string;
  mensagens?: IxcMensagem[];
}

export interface IxcMensagem {
  id: string;
  mensagem: string;
  usuario: string;
  data: string;
  tipo: "cliente" | "suporte";
}

export interface IxcCliente {
  id: string;
  razao: string;
  fantasia?: string;
  fone?: string;
  telefone_celular?: string;
  fone_celular: string;
  email: string;
  status: string;
  endereco: string;
  numero?: string;
  bairro?: string;
  cidade: string;
}

export interface IxcContrato {
  id: string;
  id_cliente: string;
  contrato?: string;
  id_vd_contrato?: string;
  plano?: string;
  id_produto?: string;
  produto?: string;
  velocidade?: string;
  status?: string;
  status_internet?: string;
  bloqueio_automatico?: string;
  endereco?: string;
  endereco_padrao_cliente?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  cep?: string;
  data_ativacao?: string;
  data_cancelamento?: string;
  obs?: string;
}

export interface IxcFatura {
  id: string;
  id_cliente: string;
  cliente?: string;
  valor?: string;
  valor_aberto?: string;
  valor_recebido?: string;
  data_vencimento?: string;
  data_emissao?: string;
  status?: string;
  status_cobranca?: string;
  linha_digitavel?: string;
  boleto?: string;
  link?: string;
  gateway_link?: string;
  pix?: string;
  pix_copia_cola?: string;
  pix_txid?: string;
  codigo_barras?: string;
}

export interface IxcBoletoDados {
  id_receber?: string;
  numero_documento?: string;
  data_vencimento?: string;
  valor_boleto?: string;
  linha_digitavel?: string;
  codigo_barras?: string;
  id_cliente?: string;
}

function buildPhoneSearchTerms(digits: string) {
  const terms = new Set<string>();
  const add = (value?: string) => {
    if (value) terms.add(value);
  };

  add(digits);
  add(digits.startsWith("55") ? digits.slice(2) : `55${digits}`);

  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length >= 10) {
    const ddd = national.slice(0, 2);
    const number = national.slice(2);
    add(number);

    if (number.length === 9) {
      add(`(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`);
      add(`${ddd} ${number.slice(0, 5)}-${number.slice(5)}`);
      add(`${number.slice(0, 5)}-${number.slice(5)}`);
      add(`${number.slice(1, 5)}-${number.slice(5)}`);
    } else if (number.length === 8) {
      add(`(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`);
      add(`${ddd} ${number.slice(0, 4)}-${number.slice(4)}`);
      add(`${number.slice(0, 4)}-${number.slice(4)}`);
    }
  }

  return Array.from(terms);
}

function parseMoney(value?: string) {
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGetBoletoResponse(data: IxcBoletoDados[] | IxcBoletoDados | null): IxcBoletoDados | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  return data;
}

function mergeBoletoDados(fatura: IxcFatura, boleto: IxcBoletoDados | null): IxcFatura {
  if (!boleto) return fatura;
  return {
    ...fatura,
    linha_digitavel: fatura.linha_digitavel || boleto.linha_digitavel,
    boleto: fatura.boleto || boleto.codigo_barras,
    codigo_barras: fatura.codigo_barras || boleto.codigo_barras,
    data_vencimento: fatura.data_vencimento || boleto.data_vencimento,
    valor: fatura.valor || boleto.valor_boleto,
  };
}

function isFaturaAberta(fatura: IxcFatura) {
  const status = String(fatura.status || fatura.status_cobranca || "").trim().toUpperCase();
  const valorAberto = parseMoney(fatura.valor_aberto);
  const valorRecebido = parseMoney(fatura.valor_recebido);

  // IXC costuma usar status A para aberto. Valor aberto positivo reforça a regra.
  // Status recebidos/baixados/liquidados ficam fora mesmo se algum campo textual vier estranho.
  const statusFechado = ["R", "RECEBIDO", "BAIXADO", "PAGO", "C", "CANCELADO", "F", "FECHADO", "LIQUIDADO"].includes(status);
  if (statusFechado) return false;
  if (valorAberto > 0) return true;
  if (status === "A" && valorRecebido <= 0) return true;
  return false;
}

export const ixcApi = {
  // Busca chamados abertos. Sem mock em produção: se o IXC falhar, retorna unavailable.
  async getChamados(page = 1, status = "A"): Promise<{ total: number; items: IxcChamado[]; unavailable?: boolean }> {
    const data = await ixcRequest<IxcListResponse<IxcChamado>>(
      "su_oss_chamado",
      { qtype: "su_oss_chamado.status", query: status, oper: "=", page: String(page), rp: "50", sortname: "su_oss_chamado.data_abertura", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: [], unavailable: true };

    const items = normalizeRegistros(data.registros).filter((chamado) => String(chamado.status || "").toUpperCase() === status.toUpperCase());
    return { total: parseInt(String(data.total || items.length || "0"), 10), items };
  },

  // Busca chamado por ID
  async getChamado(id: string): Promise<IxcChamado | null> {
    const data = await ixcRequest<IxcListResponse<IxcChamado>>(
      "su_oss_chamado",
      { qtype: "su_oss_chamado.id", query: id, oper: "=", page: "1", rp: "1", sortname: "su_oss_chamado.id", sortorder: "desc" }
    );
    if (!data) return null;
    return normalizeRegistros(data.registros)[0] || null;
  },

  // Busca cliente por ID
  async getCliente(id: string): Promise<IxcCliente | null> {
    const data = await ixcRequest<IxcListResponse<IxcCliente>>(
      "cliente",
      { qtype: "cliente.id", query: id, oper: "=", page: "1", rp: "1", sortname: "cliente.id", sortorder: "asc" }
    );
    if (!data) return null;
    return normalizeRegistros(data.registros)[0] || null;
  },

  // Busca cliente por ID, telefone/celular ou nome/razão social.
  async buscarClientes(query: string): Promise<{ total: number; items: IxcCliente[] }> {
    const clean = query.trim();
    if (!clean) return { total: 0, items: [] };

    const onlyDigits = clean.replace(/\D/g, "");
    const phoneQueries = onlyDigits ? buildPhoneSearchTerms(onlyDigits) : [];
    const documentSearches = isCpf(clean) || isCnpj(clean)
      ? [
          { qtype: "cliente.cnpj_cpf", query: onlyDigits, oper: "=" },
          { qtype: "cliente.cnpj_cpf", query: clean, oper: "=" },
        ]
      : [];
    const searches = onlyDigits
      ? [
          { qtype: "cliente.id", query: onlyDigits, oper: "=" },
          ...documentSearches,
          ...phoneQueries.flatMap((phoneQuery) => [
            { qtype: "cliente.telefone_celular", query: phoneQuery, oper: "L" },
            { qtype: "cliente.fone_celular", query: phoneQuery, oper: "L" },
            { qtype: "cliente.fone", query: phoneQuery, oper: "L" },
          ]),
        ]
      : [{ qtype: "cliente.razao", query: clean, oper: "L" }];

    const seen = new Set<string>();
    const items: IxcCliente[] = [];

    for (const search of searches) {
      const data = await ixcRequest<IxcListResponse<IxcCliente>>(
        "cliente",
        { ...search, page: "1", rp: "10", sortname: "cliente.id", sortorder: "asc" }
      );
      for (const cliente of normalizeRegistros(data?.registros)) {
        if (!cliente?.id || seen.has(cliente.id)) continue;
        seen.add(cliente.id);
        items.push(cliente);
      }
      if (items.length > 0 && search.qtype === "cliente.id") break;
    }

    return { total: items.length, items };
  },

  // Lista contratos do cliente no IXC. Consulta interna somente; não envia dados para cliente automaticamente.
  async getContratosCliente(idCliente: string): Promise<{ total: number; items: IxcContrato[]; unavailable?: boolean }> {
    const data = await ixcRequest<IxcListResponse<IxcContrato>>(
      "cliente_contrato",
      { qtype: "cliente_contrato.id_cliente", query: idCliente, oper: "=", page: "1", rp: "20", sortname: "cliente_contrato.id", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: [], unavailable: true };

    const items = normalizeRegistros(data.registros);
    return { total: parseInt(String(data.total || items.length || "0"), 10), items };
  },

  // Lista contas a receber/faturas abertas do cliente. Por segurança, não baixa PDF nem envia para cliente.
  async getFaturasCliente(idCliente: string): Promise<{ total: number; items: IxcFatura[]; unavailable?: boolean }> {
    const data = await ixcRequest<IxcListResponse<IxcFatura>>(
      "fn_areceber",
      { qtype: "fn_areceber.id_cliente", query: idCliente, oper: "=", page: "1", rp: "12", sortname: "fn_areceber.id", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: [], unavailable: true };

    const items = normalizeRegistros(data.registros).filter(isFaturaAberta);

    return { total: items.length, items };
  },

  // Consulta dados de boleto via endpoint documentado get_boleto.
  // Somente leitura: não atualiza boleto, não envia e-mail/SMS e não baixa título.
  async getBoletoDados(idReceber: string): Promise<IxcBoletoDados | null> {
    const data = await ixcRequest<IxcBoletoDados[] | IxcBoletoDados>(
      "get_boleto",
      { boletos: idReceber, juro: "N", multa: "N", atualiza_boleto: "N", tipo_boleto: "dados" }
    );

    return normalizeGetBoletoResponse(data);
  },

  async enriquecerFaturaComBoleto(fatura: IxcFatura): Promise<IxcFatura> {
    const boleto = await this.getBoletoDados(fatura.id);
    return mergeBoletoDados(fatura, boleto);
  },

  // Retorna PDF do boleto em base64 via get_boleto. Somente leitura/geração de arquivo.
  async getBoletoArquivoBase64(idReceber: string): Promise<string | null> {
    const raw = await ixcRequestRaw(
      "get_boleto",
      { boletos: idReceber, juro: "N", multa: "N", atualiza_boleto: "N", tipo_boleto: "arquivo", base64: "S" }
    );

    if (!raw) return null;
    const clean = raw.replace(/^"|"$/g, "").trim();
    if (!clean || clean.startsWith("{") || clean.startsWith("[")) {
      try {
        const data = JSON.parse(raw) as { arquivo?: string; base64?: string; file?: string };
        return (data.arquivo || data.base64 || data.file || "").trim() || null;
      } catch {
        return null;
      }
    }
    return clean;
  },

  // Retorna uma única fatura segura para envio assistido.
  // Se houver zero ou mais de uma fatura aberta, bloqueia para evitar pagamento errado.
  async getFaturaSeguraCliente(idCliente: string): Promise<
    | { ok: true; fatura: IxcFatura; total: 1 }
    | { ok: false; reason: "unavailable" | "none" | "multiple"; total: number; items: IxcFatura[] }
  > {
    const result = await this.getFaturasCliente(idCliente);
    if (result.unavailable) return { ok: false, reason: "unavailable", total: 0, items: [] };
    if (result.items.length === 0) return { ok: false, reason: "none", total: 0, items: [] };
    if (result.items.length > 1) return { ok: false, reason: "multiple", total: result.items.length, items: result.items };

    const fatura = await this.enriquecerFaturaComBoleto(result.items[0]);
    return { ok: true, fatura, total: 1 };
  },

  // Responde um chamado
  async responderChamado(idChamado: string, mensagem: string, idUsuario = "10"): Promise<boolean> {
    const data = await ixcRequest<{ id?: string }>(
      "su_oss_mensagem",
      { id_oss: idChamado, mensagem, id_tecnico: idUsuario, tipo: "I" }
    );
    return !!data?.id;
  },

  // Fecha um chamado
  async fecharChamado(idChamado: string): Promise<boolean> {
    const data = await ixcRequest<{ id?: string }>(
      "su_oss_chamado",
      { id: idChamado, status: "F" }
    );
    return !!data;
  },
};
