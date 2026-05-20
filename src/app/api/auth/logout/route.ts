import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/dashboard-session";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(getSessionCookieName(), "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return response;
}
