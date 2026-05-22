import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeForAudit } from "@/lib/lgpd";

const dataDir = process.env.DATA_DIR || "/tmp/glc-atende";
const auditDir = path.join(dataDir, "audit");

export async function appendAudit(event: Record<string, unknown>) {
  await mkdir(auditDir, { recursive: true });
  const line = JSON.stringify(sanitizeForAudit({ ts: new Date().toISOString(), ...event }));
  await appendFile(path.join(auditDir, "events.jsonl"), `${line}\n`, "utf8");
}

export async function hasSeenEvent(id: string) {
  const file = path.join(auditDir, "ixc-chamados-notified.txt");
  try {
    const content = await readFile(file, "utf8");
    return new Set(content.split("\n").filter(Boolean)).has(id);
  } catch {
    return false;
  }
}

export async function markEventSeen(id: string) {
  await mkdir(auditDir, { recursive: true });
  await appendFile(path.join(auditDir, "ixc-chamados-notified.txt"), `${id}\n`, "utf8");
}

export async function writeAuditNote(filename: string, content: string) {
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(auditDir, filename), content, "utf8");
}
