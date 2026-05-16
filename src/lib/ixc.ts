/**
 * IXC Soft API Client
 *
 * Tenta API direta primeiro. Se falhar (401/nginx block),
 * usa dados mockados apenas no painel de chamados para desenvolvimento.
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
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data as T;
  } catch {
    return null;
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
  pix?: string;
  pix_copia_cola?: string;
  pix_txid?: string;
}

export const ixcApi = {
  // Busca chamados abertos
  async getChamados(page = 1, status = "A"): Promise<{ total: number; items: IxcChamado[] }> {
    const data = await ixcRequest<IxcListResponse<IxcChamado>>(
      "su_oss_chamado",
      { qtype: "su_oss_chamado.status", query: status, oper: "=", page: String(page), rp: "50", sortname: "su_oss_chamado.data_abertura", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: getMockChamados() };

    const items = normalizeRegistros(data.registros);
    return { total: parseInt(String(data.total || "0"), 10), items };
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
    const searches = onlyDigits
      ? [
          { qtype: "cliente.id", query: onlyDigits, oper: "=" },
          { qtype: "cliente.telefone_celular", query: onlyDigits, oper: "L" },
          { qtype: "cliente.fone", query: onlyDigits, oper: "L" },
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

  // Lista contas a receber/faturas do cliente. Por segurança, não baixa PDF nem envia para cliente.
  async getFaturasCliente(idCliente: string): Promise<{ total: number; items: IxcFatura[] }> {
    const data = await ixcRequest<IxcListResponse<IxcFatura>>(
      "fn_areceber",
      { qtype: "fn_areceber.id_cliente", query: idCliente, oper: "=", page: "1", rp: "20", sortname: "fn_areceber.data_vencimento", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: [] };

    const items = normalizeRegistros(data.registros).filter((fatura) => {
      const status = String(fatura.status || "").toUpperCase();
      const aberto = Number(String(fatura.valor_aberto || "0").replace(",", "."));
      return !status || ["A", "P", "R"].includes(status) || aberto > 0;
    });

    return { total: items.length, items };
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

// Dados mock enquanto API não está acessível
function getMockChamados(): IxcChamado[] {
  return [
    { id: "1001", assunto: "Internet caiu", descricao: "Sem conexão desde ontem à noite", status: "A", prioridade: "A", id_cliente: "101", nome_cliente: "Mario Augusto", data_abertura: new Date(Date.now() - 30 * 60000).toISOString(), data_update: new Date(Date.now() - 30 * 60000).toISOString() },
    { id: "1002", assunto: "Lentidão na internet", descricao: "Velocidade muito baixa, streaming travando", status: "A", prioridade: "M", id_cliente: "102", nome_cliente: "Edgard Gomes", data_abertura: new Date(Date.now() - 2 * 60 * 60000).toISOString(), data_update: new Date(Date.now() - 2 * 60 * 60000).toISOString() },
    { id: "1003", assunto: "Roteador sem luz", descricao: "Luz do roteador apagou, sem sinal", status: "A", prioridade: "M", id_cliente: "103", nome_cliente: "Josy Dias", data_abertura: new Date(Date.now() - 4 * 60 * 60000).toISOString(), data_update: new Date(Date.now() - 4 * 60 * 60000).toISOString() },
    { id: "1004", assunto: "Solicitar mudança de endereço", descricao: "Vou mudar de casa, preciso transferir o serviço", status: "A", prioridade: "B", id_cliente: "104", nome_cliente: "Otavio Santos", data_abertura: new Date(Date.now() - 24 * 60 * 60000).toISOString(), data_update: new Date(Date.now() - 24 * 60 * 60000).toISOString() },
  ];
}
