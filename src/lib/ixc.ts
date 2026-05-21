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
    const searches = onlyDigits
      ? [
          { qtype: "cliente.id", query: onlyDigits, oper: "=" },
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

  // Lista contas a receber/faturas abertas do cliente. Por segurança, não baixa PDF nem envia para cliente.
  async getFaturasCliente(idCliente: string): Promise<{ total: number; items: IxcFatura[]; unavailable?: boolean }> {
    const data = await ixcRequest<IxcListResponse<IxcFatura>>(
      "fn_areceber",
      { qtype: "fn_areceber.id_cliente", query: idCliente, oper: "=", page: "1", rp: "100", sortname: "fn_areceber.id", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: [], unavailable: true };

    const items = normalizeRegistros(data.registros).filter(isFaturaAberta);

    return { total: items.length, items };
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
    return { ok: true, fatura: result.items[0], total: 1 };
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
