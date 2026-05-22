import { NextRequest, NextResponse } from "next/server";
import { runRetentionCleanup } from "@/lib/retention";
import { validateSharedSecret } from "@/lib/security";

export async function POST(request: NextRequest) {
  const secretError = validateSharedSecret(request, "MONITOR_SECRET");
  if (secretError) return secretError;

  const results = await runRetentionCleanup();
  return NextResponse.json({ ok: true, results });
}
