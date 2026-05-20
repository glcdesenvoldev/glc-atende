import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDashboardUser } from "@/lib/dashboard-session";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const authDir = path.join(dataDir, "auth");
const passwordFile = path.join(authDir, "dashboard-password.json");
const resetFile = path.join(authDir, "password-reset.json");
type PasswordRecord = {
  hash: string;
  updatedAt: string;
};

type ResetRecord = {
  email: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export function getAllowedResetEmails() {
  return (process.env.DASHBOARD_RESET_EMAILS || process.env.DASHBOARD_RESET_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function validateDashboardCredentials(username: string, password: string) {
  if (!safeEqual(username, getDashboardUser())) return false;

  const override = await readPasswordRecord();
  if (override?.hash) return bcrypt.compare(password, override.hash);

  const envPassword = process.env.DASHBOARD_BASIC_PASSWORD || "";
  if (!envPassword) return false;
  if (envPassword.startsWith("$2a$") || envPassword.startsWith("$2b$")) return bcrypt.compare(password, envPassword);
  return safeEqual(password, envPassword);
}

export async function setDashboardPassword(password: string) {
  await mkdir(authDir, { recursive: true });
  const hash = await bcrypt.hash(password, 12);
  const record: PasswordRecord = { hash, updatedAt: new Date().toISOString() };
  await writeFile(passwordFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function createPasswordReset(email: string) {
  const normalized = email.trim().toLowerCase();
  const allowed = getAllowedResetEmails();
  if (!allowed.includes(normalized)) return null;

  await mkdir(authDir, { recursive: true });
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + getResetTtlMs()).toISOString();
  const record: ResetRecord = { email: normalized, tokenHash, expiresAt, createdAt: new Date().toISOString() };
  await writeFile(resetFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { email: normalized, token, expiresAt };
}

export async function consumePasswordReset(email: string, token: string) {
  const normalized = email.trim().toLowerCase();
  const record = await readResetRecord();
  if (!record) return false;
  if (record.email !== normalized) return false;
  if (Date.parse(record.expiresAt) < Date.now()) return false;
  return safeEqual(record.tokenHash, hashResetToken(token));
}

export async function clearPasswordReset() {
  await mkdir(authDir, { recursive: true });
  await writeFile(resetFile, "{}\n", "utf8");
}

export function getResetTtlMinutes() {
  return Math.max(5, Number(process.env.DASHBOARD_RESET_TOKEN_TTL_MINUTES || 20));
}

function getResetTtlMs() {
  return getResetTtlMinutes() * 60_000;
}

function hashResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function readPasswordRecord() {
  try {
    return JSON.parse(await readFile(passwordFile, "utf8")) as PasswordRecord;
  } catch {
    return null;
  }
}

async function readResetRecord() {
  try {
    const record = JSON.parse(await readFile(resetFile, "utf8")) as Partial<ResetRecord>;
    if (!record.email || !record.tokenHash || !record.expiresAt || !record.createdAt) return null;
    return record as ResetRecord;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
