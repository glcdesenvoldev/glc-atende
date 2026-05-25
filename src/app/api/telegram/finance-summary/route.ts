import { NextRequest, NextResponse } from "next/server";
import { validateSharedSecret } from "@/lib/security";
import { buildTelegramFinanceSummaryDryRun, sendTelegramFinanceSummary } from "@/lib/telegram";

export async function GET(request: NextRequest) {
  return runFinanceSummary(request);
}

export async function POST(request: NextRequest) {
  return runFinanceSummary(request);
}

async function runFinanceSummary(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const target = getFinanceSummaryTarget(request);

  if (dryRun) {
    const summary = await buildTelegramFinanceSummaryDryRun();
    return NextResponse.json({ ...summary, targetConfigured: Boolean(target) });
  }

  if (!target) return NextResponse.json({ ok: false, error: "telegram_target_not_configured" }, { status: 503 });

  const result = await sendTelegramFinanceSummary(target);
  return NextResponse.json({ ...result, targetConfigured: true });
}

function getFinanceSummaryTarget(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get("target")?.trim();
  if (explicit) return explicit;

  return (
    process.env.TELEGRAM_FINANCE_NOTIFY_CHAT_IDS?.split(",")[0]?.trim() ||
    process.env.TELEGRAM_DAILY_SUMMARY_TARGET?.trim() ||
    process.env.TELEGRAM_GROUP_ID?.trim() ||
    process.env.TELEGRAM_ALLOWED_GROUPS?.split(",")[0]?.trim() ||
    process.env.TELEGRAM_PRIVATE_USERS?.split(",")[0]?.trim() ||
    process.env.TELEGRAM_ALLOWED_USERS?.split(",")[0]?.trim() ||
    ""
  );
}
