import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { getSessionCookieName } from "@/lib/dashboard-session";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(appUrl("/login", request));
  response.cookies.set(getSessionCookieName(), "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return response;
}
