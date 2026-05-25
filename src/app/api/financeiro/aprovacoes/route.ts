import { NextRequest, NextResponse } from "next/server";
import { createFinanceApproval, decideFinanceApproval, listFinanceApprovals, markFinanceApprovalManualSent } from "@/lib/finance-approvals";
import { ixcApi } from "@/lib/ixc";
import { notifyFinanceApprovalEvent } from "@/lib/telegram";

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
  if (approval.created) await notifyFinanceApprovalEvent("created", approval.approval);
  return NextResponse.json({ ok: true, ...approval });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : body.action === "manual_sent" ? "manual_sent" : null;

  if (!id || !action) {
    return NextResponse.json({ ok: false, error: "Informe id e action approve/reject/manual_sent." }, { status: 400 });
  }

  if (action === "manual_sent") {
    const result = await markFinanceApprovalManualSent({ id, note: String(body.note || ""), decidedBy: "dashboard" });
    if (!result) return NextResponse.json({ ok: false, error: "Solicitação não encontrada." }, { status: 404 });
    if (result.blocked) return NextResponse.json({ ok: false, error: "Só é possível registrar envio manual após aprovação interna." }, { status: 409 });
    await notifyFinanceApprovalEvent("manual_sent", result.approval);
    return NextResponse.json({ ok: true, approval: result.approval, message: "Envio manual registrado. Nenhuma mensagem foi enviada automaticamente." });
  }

  const approval = await decideFinanceApproval({ id, action, note: String(body.note || ""), decidedBy: "dashboard" });
  if (!approval) return NextResponse.json({ ok: false, error: "Solicitação não encontrada." }, { status: 404 });
  await notifyFinanceApprovalEvent(action === "approve" ? "approved" : "rejected", approval);

  return NextResponse.json({ ok: true, approval, message: "Status atualizado. Nenhuma mensagem foi enviada ao cliente." });
}

function reasonToMessage(reason: string, total: number) {
  if (reason === "multiple") return `Bloqueado: cliente possui ${total} faturas abertas.`;
  if (reason === "none") return "Bloqueado: nenhuma fatura aberta localizada.";
  return "Bloqueado: IXC indisponível ou sem resposta.";
}
