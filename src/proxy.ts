import { NextRequest, NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/security";

export function proxy(request: NextRequest) {
  const authError = requireBasicAuth(request);
  if (authError) return authError;
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/chamados/:path*"],
};
