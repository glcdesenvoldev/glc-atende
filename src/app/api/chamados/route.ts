import { NextResponse } from "next/server";
import { ixcApi, type IxcChamado } from "@/lib/ixc";

export async function GET() {
  const data = await ixcApi.getChamados();
  return NextResponse.json({
    ok: !data.unavailable,
    unavailable: Boolean(data.unavailable),
    total: data.total,
    items: data.items.map(toSafeChamado),
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
  };
}
