import { NextRequest, NextResponse } from "next/server";
import { validateDashboardCredentials } from "@/lib/dashboard-auth";
import { createDashboardSession, getSessionCookieName, getSessionMaxAgeSeconds } from "@/lib/dashboard-session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");

  const ok = await validateDashboardCredentials(username, password);
  if (!ok) return redirectWithError(request, "/login?erro=1");

  const token = await createDashboardSession(username);
  const response = NextResponse.redirect(new URL("/dashboard/chamados", request.url));
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  });
  return response;
}

function redirectWithError(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}
