import { NextRequest, NextResponse } from "next/server";
import { validateSharedSecret } from "@/lib/security";
import { sendTelegramDailySummary } from "@/lib/telegram";

export async function GET(request: NextRequest) {
  return runDailySummary(request);
}

export async function POST(request: NextRequest) {
  return runDailySummary(request);
}

async function runDailySummary(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const target = getDailySummaryTarget(request);
  if (!target) return NextResponse.json({ ok: false, error: "telegram_target_not_configured" }, { status: 503 });

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, targetConfigured: true });
  }

  const result = await sendTelegramDailySummary(target);
  return NextResponse.json({ ...result, targetConfigured: true });
}

function getDailySummaryTarget(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("target")?.trim();
  if (explicit) return explicit;

  return (
    process.env.TELEGRAM_DAILY_SUMMARY_TARGET?.trim() ||
    process.env.TELEGRAM_GROUP_ID?.trim() ||
    process.env.TELEGRAM_ALLOWED_GROUPS?.split(",")[0]?.trim() ||
    process.env.TELEGRAM_PRIVATE_USERS?.split(",")[0]?.trim() ||
    process.env.TELEGRAM_ALLOWED_USERS?.split(",")[0]?.trim() ||
    ""
  );
}
