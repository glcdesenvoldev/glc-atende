import { NextRequest, NextResponse } from "next/server";
import { ixcApi, type IxcFatura } from "@/lib/ixc";

const MAX_CLIENTES = 20;

type FinanceiroStatus = "segura" | "multiplas" | "sem_fatura" | "indisponivel";

type FinanceiroItem = {
  idCliente: string;
  status: FinanceiroStatus;
  total: number;
  bloqueio: string | null;
  fatura?: ReturnType<typeof toSafeFaturaDetalhe>;
  faturas?: ReturnType<typeof toSafeFaturaResumo>[];
};

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids") || request.nextUrl.searchParams.get("idCliente") || "";
  const ids = normalizeIds(idsParam);

  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "Informe pelo menos um ID de cliente." }, { status: 400 });
  }

  if (ids.length > MAX_CLIENTES) {
    return NextResponse.json({ ok: false, error: `Limite de ${MAX_CLIENTES} clientes por consulta.` }, { status: 400 });
  }

  const items: FinanceiroItem[] = [];
  for (const idCliente of ids) {
    const result = await ixcApi.getFaturaSeguraCliente(idCliente);

    if (!result.ok) {
      items.push({
        idCliente,
        status: statusFromReason(result.reason),
        total: result.total,
        faturas: result.items.slice(0, 8).map(toSafeFaturaResumo),
        bloqueio: messageForReason(result.reason, result.total),
      });
      continue;
    }

    items.push({
      idCliente,
      status: "segura",
      total: 1,
      fatura: toSafeFaturaDetalhe(result.fatura),
      bloqueio: null,
    });
  }

  return NextResponse.json({
    ok: true,
    totalClientes: items.length,
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

function statusFromReason(reason: string): FinanceiroStatus {
  if (reason === "multiple") return "multiplas";
  if (reason === "none") return "sem_fatura";
  return "indisponivel";
}

function messageForReason(reason: string, total: number) {
  if (reason === "unavailable") return "IXC indisponível ou sem resposta. Não gerar boleto/PIX agora.";
  if (reason === "none") return "Nenhuma fatura aberta localizada para este cliente.";
  if (reason === "multiple") return `Cliente possui ${total} faturas abertas. Envio automático bloqueado para evitar pagamento errado.`;
  return "Fatura segura não disponível.";
}

function buildResumo(items: Array<{ status: FinanceiroStatus }>) {
  return items.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { segura: 0, multiplas: 0, sem_fatura: 0, indisponivel: 0 }
  );
}

function toSafeFaturaResumo(fatura: IxcFatura) {
  return {
    id: fatura.id,
    valor: fatura.valor_aberto || fatura.valor || "",
    data_vencimento: fatura.data_vencimento || "",
    status: fatura.status || fatura.status_cobranca || "",
  };
}

function toSafeFaturaDetalhe(fatura: IxcFatura) {
  const linhaDigitavel = fatura.linha_digitavel || fatura.boleto || "";
  const pix = fatura.pix_copia_cola || fatura.pix || "";

  return {
    ...toSafeFaturaResumo(fatura),
    id_cliente: fatura.id_cliente,
    data_emissao: fatura.data_emissao || "",
    has_linha_digitavel: Boolean(linhaDigitavel),
    has_pix: Boolean(pix),
    has_link: Boolean(fatura.link),
    linha_digitavel: linhaDigitavel,
    pix_copia_cola: pix,
    pix_txid: fatura.pix_txid || "",
    link: fatura.link || "",
  };
}
