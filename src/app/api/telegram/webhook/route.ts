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
  if (!validateTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const result = await handleTelegramUpdate(update);

  return NextResponse.json(result);
}
