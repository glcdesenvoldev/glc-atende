import { NextRequest, NextResponse } from "next/server";
import { ixcApi, type IxcCliente } from "@/lib/ixc";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") || "").trim();

  if (!query) {
    return NextResponse.json({ ok: false, error: "Informe nome, telefone ou ID do cliente." }, { status: 400 });
  }

  const onlyDigits = query.replace(/\D/g, "");
  if (query.length < 3 && onlyDigits.length === 0) {
    return NextResponse.json({ ok: false, error: "Use pelo menos 3 caracteres para buscar por nome." }, { status: 400 });
  }

  const result = await ixcApi.buscarClientes(query);

  return NextResponse.json({
    ok: true,
    total: result.total,
    items: result.items.slice(0, 10).map(toSafeClienteResumo),
  });
}

function toSafeClienteResumo(cliente: IxcCliente) {
  return {
    id: cliente.id,
    nome: cliente.razao || cliente.fantasia || "Cliente sem nome",
    status: resolveClienteStatus(cliente),
    bairro: cliente.bairro || "",
    cidade: cliente.cidade || "",
    telefone_final: maskPhone(cliente.telefone_celular || cliente.fone_celular || cliente.fone || ""),
    documento_final: maskDocument(cliente.cnpj_cpf || ""),
  };
}

function resolveClienteStatus(cliente: IxcCliente) {
  const blocked = String(cliente.bloqueado || "").trim().toUpperCase();
  if (["S", "SIM", "B", "BLOQUEADO", "BLOQUEADA"].includes(blocked)) return "BLOQUEADO";

  return cliente.status || cliente.status_cliente || cliente.ativo || "";
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***${digits.slice(-4)}`;
}

function maskDocument(document: string) {
  const digits = document.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***${digits.slice(-4)}`;
}
