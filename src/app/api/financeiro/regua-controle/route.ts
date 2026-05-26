import { NextRequest, NextResponse } from "next/server";
import { disableBillingCadenceException, listBillingCadenceExceptions, listBillingCadenceHistory, recordBillingCadenceEvent, upsertBillingCadenceException, type BillingCadenceStage } from "@/lib/billing-cadence";

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") || "100");
  const [history, exceptions] = await Promise.all([
    listBillingCadenceHistory(Number.isFinite(limit) ? limit : 100),
    listBillingCadenceExceptions(),
  ]);
  return NextResponse.json({ ok: true, history, exceptions, safety: "Controle interno. Não envia WhatsApp e não altera IXC." });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "add_exception") {
    const idCliente = normalizeId(body.idCliente);
    if (!idCliente) return NextResponse.json({ ok: false, error: "idCliente obrigatório." }, { status: 400 });
    const exception = await upsertBillingCadenceException({ idCliente, reason: String(body.reason || "Exceção manual"), createdBy: "dashboard" });
    return NextResponse.json({ ok: true, exception });
  }

  if (action === "remove_exception") {
    const idCliente = normalizeId(body.idCliente);
    if (!idCliente) return NextResponse.json({ ok: false, error: "idCliente obrigatório." }, { status: 400 });
    const exception = await disableBillingCadenceException({ idCliente, createdBy: "dashboard" });
    return NextResponse.json({ ok: true, exception });
  }

  if (action === "record_dry_run") {
    const idCliente = normalizeId(body.idCliente);
    const faturaId = normalizeText(body.faturaId);
    const stage = normalizeStage(body.stage);
    if (!idCliente || !faturaId || !stage) return NextResponse.json({ ok: false, error: "idCliente, faturaId e stage são obrigatórios." }, { status: 400 });
    const event = await recordBillingCadenceEvent({ idCliente, faturaId, stage, status: "dry_run", reason: String(body.reason || "Registro dry-run manual"), createdBy: "dashboard" });
    return NextResponse.json({ ok: true, event });
  }

  return NextResponse.json({ ok: false, error: "Ação inválida." }, { status: 400 });
}

function normalizeId(value: unknown) {
  const clean = String(value || "").trim();
  return /^\d+$/.test(clean) ? clean : "";
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeStage(value: unknown): BillingCadenceStage | null {
  const clean = String(value || "").trim();
  if (clean === "D-5" || clean === "D0" || clean === "D+3") return clean;
  return null;
}
