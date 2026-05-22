import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendAudit } from "@/lib/audit";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const auditDir = path.join(dataDir, "audit");

type RetentionTarget = {
  label: string;
  path: string;
  retentionDays: number;
};

export type RetentionResult = {
  label: string;
  path: string;
  retentionDays: number;
  kept: number;
  removed: number;
  skipped: boolean;
  reason?: string;
};

export async function runRetentionCleanup(): Promise<RetentionResult[]> {
  const auditRetentionDays = Number(process.env.AUDIT_RETENTION_DAYS || "365");
  const telegramRetentionDays = Number(process.env.TELEGRAM_AUDIT_RETENTION_DAYS || String(auditRetentionDays));
  const targets: RetentionTarget[] = [
    { label: "audit_events", path: path.join(auditDir, "events.jsonl"), retentionDays: auditRetentionDays },
    { label: "telegram_audit", path: process.env.AUDIT_LOG_PATH || path.join(auditDir, "telegram-audit.jsonl"), retentionDays: telegramRetentionDays },
  ];

  const uniqueTargets = Array.from(new Map(targets.map((target) => [target.path, target])).values());
  const results: RetentionResult[] = [];
  for (const target of uniqueTargets) {
    results.push(await cleanupJsonlTarget(target));
  }

  await appendAudit({
    action: "retention_cleanup",
    status: "success",
    results: results.map((result) => ({
      label: result.label,
      retentionDays: result.retentionDays,
      kept: result.kept,
      removed: result.removed,
      skipped: result.skipped,
      reason: result.reason,
    })),
  });

  return results;
}

async function cleanupJsonlTarget(target: RetentionTarget): Promise<RetentionResult> {
  const retentionDays = Number.isFinite(target.retentionDays) && target.retentionDays > 0 ? target.retentionDays : 365;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    await stat(target.path);
  } catch {
    return { ...target, retentionDays, kept: 0, removed: 0, skipped: true, reason: "file_not_found" };
  }

  const content = await readFile(target.path, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const kept: string[] = [];
  let removed = 0;

  for (const line of lines) {
    const ts = parseLineTimestamp(line);
    if (!ts || ts >= cutoff) {
      kept.push(line);
    } else {
      removed += 1;
    }
  }

  if (removed === 0) return { ...target, retentionDays, kept: kept.length, removed, skipped: false };

  await mkdir(path.dirname(target.path), { recursive: true });
  const tmp = `${target.path}.tmp-${Date.now()}`;
  await writeFile(tmp, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  await rename(tmp, target.path);

  return { ...target, retentionDays, kept: kept.length, removed, skipped: false };
}

function parseLineTimestamp(line: string) {
  try {
    const parsed = JSON.parse(line) as { ts?: string; timestamp?: string };
    const raw = parsed.ts || parsed.timestamp || "";
    const time = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}
