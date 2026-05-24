import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const auditFile = path.join(dataDir, "audit", "events.jsonl");
const FINANCE_ACTIONS = new Set([
  "finance_approval_create",
  "finance_approval_decide",
  "finance_approval_manual_sent",
]);

type AuditEvent = {
  ts?: string;
  action?: string;
  status?: string;
  id?: string;
  clientId?: string;
  faturaId?: string;
};

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit") || 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 100);

  const events = await readFinanceAuditEvents(limit);
  return NextResponse.json({ ok: true, total: events.length, items: events });
}

async function readFinanceAuditEvents(limit: number): Promise<AuditEvent[]> {
  try {
    const content = await readFile(auditFile, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map(parseAuditLine)
      .filter((event): event is AuditEvent => Boolean(event && event.action && FINANCE_ACTIONS.has(event.action)))
      .slice(-limit)
      .reverse()
      .map(toSafeAuditEvent);
  } catch {
    return [];
  }
}

function parseAuditLine(line: string): AuditEvent | null {
  try {
    const parsed = JSON.parse(line) as AuditEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toSafeAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ts: event.ts || "",
    action: event.action || "",
    status: event.status || "",
    id: event.id || "",
    clientId: event.clientId || "",
    faturaId: event.faturaId || "",
  };
}
