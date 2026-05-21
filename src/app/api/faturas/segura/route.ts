import { NextRequest, NextResponse } from "next/server";
import { ixcApi, type IxcFatura } from "@/lib/ixc";
import { validateSharedSecret } from "@/lib/security";

export async function GET(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const idCliente = request.nextUrl.searchParams.get("idCliente")?.trim();
  if (!idCliente) {
    return NextResponse.json({ ok: false, error: "idCliente obrigatório" }, { status: 400 });
  }

  const result = await ixcApi.getFaturaSeguraCliente(idCliente);
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      reason: result.reason,
      total: result.total,
      items: result.items.slice(0, 10).map(toSafeFatura),
      message: messageForReason(result.reason, result.total),
    });
  }

  return NextResponse.json({
    ok: true,
    total: 1,
    fatura: toSafeFatura(result.fatura),
    message: "Uma única fatura aberta localizada. Conferência humana ainda recomendada antes do envio ao cliente.",
  });
}

function messageForReason(reason: string, total: number) {
  if (reason === "unavailable") return "IXC indisponível ou sem resposta. Não gerar boleto/PIX agora.";
  if (reason === "none") return "Nenhuma fatura aberta localizada para este cliente.";
  if (reason === "multiple") return `Cliente possui ${total} faturas abertas. Envio automático bloqueado para evitar pagamento errado.`;
  return "Fatura segura não disponível.";
}

function toSafeFatura(fatura: IxcFatura) {
  return {
    id: fatura.id,
    id_cliente: fatura.id_cliente,
    valor: fatura.valor,
    valor_aberto: fatura.valor_aberto,
    data_vencimento: fatura.data_vencimento,
    data_emissao: fatura.data_emissao,
    status: fatura.status,
    status_cobranca: fatura.status_cobranca,
    linha_digitavel: fatura.linha_digitavel || fatura.boleto || "",
    pix_copia_cola: fatura.pix_copia_cola || fatura.pix || "",
    pix_txid: fatura.pix_txid || "",
    link: fatura.link || fatura.gateway_link || "",
  };
}
