import { NextResponse } from "next/server";
import { ixcApi, type IxcChamado } from "@/lib/ixc";
import { getWhatsAppChamados } from "@/lib/whatsapp-chamados";

export async function GET() {
  const [data, whatsappChamados] = await Promise.all([
    ixcApi.getChamados(),
    getWhatsAppChamados(),
  ]);
  const items = [...whatsappChamados, ...data.items]
    .sort((a, b) => new Date(b.data_update || b.data_abertura || 0).getTime() - new Date(a.data_update || a.data_abertura || 0).getTime());

  return NextResponse.json({
    ok: !data.unavailable,
    unavailable: Boolean(data.unavailable),
    total: (data.total || data.items.length) + whatsappChamados.length,
    items: items.map(toSafeChamado),
  });
}

function toSafeChamado(chamado: IxcChamado) {
  return {
    id: chamado.id,
    assunto: chamado.assunto || "Sem assunto",
    descricao: chamado.descricao || "",
    status: chamado.status || "-",
    prioridade: chamado.prioridade || "M",
    id_cliente: chamado.id_cliente || "",
    nome_cliente: chamado.nome_cliente || "Cliente não informado",
    data_abertura: chamado.data_abertura || chamado.data_update || new Date().toISOString(),
    data_update: chamado.data_update || chamado.data_abertura || new Date().toISOString(),
    origem: String(chamado.id || "").startsWith("wa-") ? "whatsapp" : "ixc",
    canReply: String(chamado.id || "").startsWith("wa-"),
  };
}
