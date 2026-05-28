import { NextRequest, NextResponse } from "next/server";
import { getCliente360 } from "@/lib/cliente360";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || request.nextUrl.searchParams.get("busca") || "";

  if (!query.trim()) {
    return NextResponse.json({ ok: false, error: "Informe q ou busca para montar a Ficha 360." }, { status: 400 });
  }

  const data = await getCliente360(query);
  return NextResponse.json({ ok: data.status !== "not_found", ...data });
}
