import { NextRequest, NextResponse } from "next/server";
import { createPasswordReset, getResetTtlMinutes } from "@/lib/dashboard-auth";
import { sendPasswordResetEmail } from "@/lib/mail";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const reset = await createPasswordReset(email);

  // Não revela se o e-mail existe/autorizado.
  if (reset) {
    try {
      const resetUrl = new URL("/reset-senha", process.env.NEXT_PUBLIC_APP_URL || request.url);
      resetUrl.searchParams.set("email", reset.email);
      resetUrl.searchParams.set("token", reset.token);
      await sendPasswordResetEmail(reset.email, resetUrl.toString(), getResetTtlMinutes());
    } catch (error) {
      console.error("[Password Reset] falha ao enviar e-mail", error);
      return NextResponse.redirect(new URL("/reset-senha?erro=email", request.url));
    }
  }

  return NextResponse.redirect(new URL("/reset-senha?enviado=1", request.url));
}
