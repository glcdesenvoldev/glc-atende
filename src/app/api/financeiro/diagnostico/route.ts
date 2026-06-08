import { NextRequest, NextResponse } from "next/server";
import { buildFinanceDiagnostic } from "@/lib/finance-diagnostics";
import { validateSharedSecret } from "@/lib/security";

export async function GET(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const limit = Number(request.nextUrl.searchParams.get("limit") || process.env.FINANCE_DIAGNOSTIC_LIMIT || "40");
  const minOverdue = Number(request.nextUrl.searchParams.get("minOverdue") || process.env.FINANCE_OVERDUE_ALERT_COUNT || "3");
  const result = await buildFinanceDiagnostic({
    limit: Number.isFinite(limit) ? limit : undefined,
    minOverdue: Number.isFinite(minOverdue) ? minOverdue : undefined,
    auditSource: "api",
  });

  return NextResponse.json(result);
}
