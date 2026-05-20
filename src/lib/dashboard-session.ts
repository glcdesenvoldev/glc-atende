import { jwtVerify, SignJWT } from "jose";

const sessionCookie = "glc_dashboard_session";
const sessionMaxAgeSeconds = Number(process.env.DASHBOARD_SESSION_MAX_AGE_SECONDS || 60 * 60 * 12);

export function getDashboardUser() {
  return process.env.DASHBOARD_BASIC_USER || "gilson";
}

export function getSessionCookieName() {
  return sessionCookie;
}

export function getSessionMaxAgeSeconds() {
  return sessionMaxAgeSeconds;
}

export async function createDashboardSession(username: string) {
  const secret = getSessionSecret();
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSeconds}s`)
    .sign(secret);
}

export async function verifyDashboardSession(token?: string) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return payload.username === getDashboardUser();
  } catch {
    return false;
  }
}

function getSessionSecret() {
  const secret = process.env.DASHBOARD_SESSION_SECRET || process.env.MONITOR_SECRET || process.env.IXC_WEBHOOK_SECRET || "";
  if (!secret) throw new Error("DASHBOARD_SESSION_SECRET não configurado");
  return new TextEncoder().encode(secret);
}
