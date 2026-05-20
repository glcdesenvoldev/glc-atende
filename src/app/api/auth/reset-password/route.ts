import { NextRequest, NextResponse } from "next/server";
import { clearPasswordReset, consumePasswordReset, setDashboardPassword } from "@/lib/dashboard-auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const token = String(form.get("token") || "");
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirm") || "");

  if (password.length < 10 || password !== confirm) {
    return NextResponse.redirect(new URL(`/reset-senha?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&erro=senha`, request.url));
  }

  const valid = await consumePasswordReset(email, token);
  if (!valid) return NextResponse.redirect(new URL("/reset-senha?erro=token", request.url));

  await setDashboardPassword(password);
  await clearPasswordReset();
  return NextResponse.redirect(new URL("/login?reset=1", request.url));
}
