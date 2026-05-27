import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, verifyDashboardSession } from "@/lib/dashboard-session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(getSessionCookieName())?.value;
  const authenticated = await verifyDashboardSession(token);
  if (authenticated) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/chamados/:path*", "/api/cliente360/:path*", "/api/financeiro/:path*"],
};
