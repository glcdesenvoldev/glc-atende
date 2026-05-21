import { NextRequest, NextResponse } from "next/server";
import { createFinanceApproval, decideFinanceApproval, listFinanceApprovals } from "@/lib/finance-approvals";
import { ixcApi } from "@/lib/ixc";

export async function GET() {
  const items = await listFinanceApprovals();
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const idCliente = String(body.idCliente || "").trim();

  if (!/^\d+$/.test(idCliente)) {
    return NextResponse.json({ ok: false, error: "ID do cliente inválido." }, { status: 400 });
  }

  const result = await ixcApi.getFaturaSeguraCliente(idCliente);
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: reasonToMessage(result.reason, result.total),
      reason: result.reason,
      total: result.total,
    }, { status: 409 });
  }

  const approval = await createFinanceApproval({ idCliente, fatura: result.fatura, createdBy: "dashboard" });
  return NextResponse.json({ ok: true, ...approval });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : null;

  if (!id || !action) {
    return NextResponse.json({ ok: false, error: "Informe id e action approve/reject." }, { status: 400 });
  }

  const approval = await decideFinanceApproval({ id, action, note: String(body.note || ""), decidedBy: "dashboard" });
  if (!approval) return NextResponse.json({ ok: false, error: "Solicitação não encontrada." }, { status: 404 });

  return NextResponse.json({ ok: true, approval, message: "Status atualizado. Nenhuma mensagem foi enviada ao cliente." });
}

function reasonToMessage(reason: string, total: number) {
  if (reason === "multiple") return `Bloqueado: cliente possui ${total} faturas abertas.`;
  if (reason === "none") return "Bloqueado: nenhuma fatura aberta localizada.";
  return "Bloqueado: IXC indisponível ou sem resposta.";
}
