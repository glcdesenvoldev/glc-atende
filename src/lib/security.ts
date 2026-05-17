import { NextRequest, NextResponse } from "next/server";

export function requireBasicAuth(request: NextRequest) {
  const user = process.env.DASHBOARD_BASIC_USER;
  const pass = process.env.DASHBOARD_BASIC_PASSWORD;

  if (!user || !pass) {
    return new NextResponse("GLC Atende: autenticação interna não configurada.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const auth = request.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) return basicAuthChallenge();

  const decoded = base64Decode(encoded);
  const separator = decoded.indexOf(":");
  const authUser = separator >= 0 ? decoded.slice(0, separator) : "";
  const authPass = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (safeEqual(authUser, user) && safeEqual(authPass, pass)) return null;
  return basicAuthChallenge();
}

export function validateSharedSecret(request: NextRequest, envName: string) {
  const expected = process.env[envName];
  if (!expected) {
    return new NextResponse(`${envName} não configurado.`, { status: 503 });
  }

  const provided =
    request.headers.get("x-glc-webhook-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.nextUrl.searchParams.get("secret") ||
    "";

  if (safeEqual(provided, expected)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function basicAuthChallenge() {
  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="GLC Atende"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function base64Decode(value: string) {
  try {
    return decodeURIComponent(
      Array.from(atob(value))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
  } catch {
    return "";
  }
}
