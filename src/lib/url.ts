import { NextRequest } from "next/server";

export function appUrl(path = "/", request?: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL || getForwardedBaseUrl(request) || request?.url || "http://127.0.0.1:3000";
  return new URL(path, base);
}

function getForwardedBaseUrl(request?: NextRequest) {
  if (!request) return null;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host || host.startsWith("0.0.0.0")) return null;
  return `${proto}://${host}`;
}
