import { NextRequest, NextResponse } from "next/server";
import {
  handleTelegramUpdate,
  isTelegramConfigured,
  validateTelegramSecret,
  type TelegramUpdate,
} from "@/lib/telegram";

export async function GET() {
  return NextResponse.json({
    status: "telegram webhook ativo",
    configured: isTelegramConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const secretValidation = validateTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"));
  if (!secretValidation.ok) {
    return NextResponse.json({ error: secretValidation.error }, { status: secretValidation.status });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    const result = await handleTelegramUpdate(update);

    return NextResponse.json(result);
  } catch (error) {
    console.error("telegram_webhook_failed", error);
    return NextResponse.json({ ok: false, error: "telegram_webhook_failed" }, { status: 500 });
  }
}
