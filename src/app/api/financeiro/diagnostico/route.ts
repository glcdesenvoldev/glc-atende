import { NextRequest, NextResponse } from "next/server";
import { validateSharedSecret } from "@/lib/security";

export async function GET(request: NextRequest) {
  if (!process.env.MONITOR_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  return NextResponse.json({
    ok: true,
    service: "financeiro-diagnostico",
    status: "available",
    timestamp: new Date().toISOString(),
  });
}
