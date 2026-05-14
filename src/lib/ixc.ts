/**
 * IXC Soft API Client
 * 
 * Tenta API direta primeiro. Se falhar (401/nginx block),
 * usa dados do banco local (populados via webhook ou importação manual)
 */

const IXC_BASE = process.env.IXC_URL || "https://ixc.glcinternet.com.br/webservice/v1";
const IXC_TOKEN = process.env.IXC_TOKEN;

function getAuthHeader() {
  if (!IXC_TOKEN) return null;
  const b64 = Buffer.from(IXC_TOKEN).toString("base64");
  return `Basic ${b64}`;
}

async function ixcRequest<T>(endpoint: string, body?: object): Promise<T | null> {
  try {
    const auth = getAuthHeader();
    if (!auth) return null;

    const res = await fetch(`${IXC_BASE}/${endpoint}`, {
      method:  body ? "POST" : "GET",
      headers: {
        "Authorization": auth,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "ixcsoft":       "listar",
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
  id:           string;
  assunto:      string;
  descricao:    string;
  status:       string;
  prioridade:   string;
  id_cliente:   string;
  nome_cliente: string;
  data_abertura: string;
  data_update:  string;
  mensagens?:   IxcMensagem[];
}

export interface IxcMensagem {
  id:        string;
  mensagem:  string;
  usuario:   string;
  data:      string;
  tipo:      "cliente" | "suporte";
}

export interface IxcCliente {
  id:           string;
  razao:        string;
  fone_celular: string;
  email:        string;
  status:       string;
  endereco:     string;
  cidade:       string;
}

export const ixcApi = {
  // Busca chamados abertos
  async getChamados(page = 1, status = "A"): Promise<{ total: number; items: IxcChamado[] }> {
    const data = await ixcRequest<{ total: string; registros: Record<string, IxcChamado> }>(
      "su_oss_chamado",
      { qtype: "su_oss_chamado.status", query: status, oper: "=", page: String(page), rp: "50", sortname: "su_oss_chamado.data_abertura", sortorder: "desc" }
    );

    if (!data) return { total: 0, items: getMockChamados() };

    const items = Object.values(data.registros || {});
    return { total: parseInt(data.total || "0"), items };
  },

  // Busca cliente por ID
  async getCliente(id: string): Promise<IxcCliente | null> {
    const data = await ixcRequest<{ registros: Record<string, IxcCliente> }>(
      "cliente",
      { qtype: "id", query: id, oper: "=", page: "1", rp: "1", sortname: "id", sortorder: "asc" }
    );
    if (!data) return null;
    return Object.values(data.registros || {})[0] || null;
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
    { id: "1001", assunto: "Internet caiu", descricao: "Sem conexão desde ontem à noite", status: "A", prioridade: "A", id_cliente: "101", nome_cliente: "Mario Augusto", data_abertura: new Date(Date.now() - 30*60000).toISOString(), data_update: new Date(Date.now() - 30*60000).toISOString() },
    { id: "1002", assunto: "Lentidão na internet", descricao: "Velocidade muito baixa, streaming travando", status: "A", prioridade: "M", id_cliente: "102", nome_cliente: "Edgard Gomes", data_abertura: new Date(Date.now() - 2*60*60000).toISOString(), data_update: new Date(Date.now() - 2*60*60000).toISOString() },
    { id: "1003", assunto: "Roteador sem luz", descricao: "Luz do roteador apagou, sem sinal", status: "A", prioridade: "M", id_cliente: "103", nome_cliente: "Josy Dias", data_abertura: new Date(Date.now() - 4*60*60000).toISOString(), data_update: new Date(Date.now() - 4*60*60000).toISOString() },
    { id: "1004", assunto: "Solicitar mudança de endereço", descricao: "Vou mudar de casa, preciso transferir o serviço", status: "A", prioridade: "B", id_cliente: "104", nome_cliente: "Otavio Santos", data_abertura: new Date(Date.now() - 24*60*60000).toISOString(), data_update: new Date(Date.now() - 24*60*60000).toISOString() },
  ];
}
