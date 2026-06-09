import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { IxcChamado } from "@/lib/ixc";

export type WhatsAppChamadoInput = {
  messageId?: string;
  remoteJid: string;
  pushName?: string;
  messageType?: string;
  text?: string;
  receivedAt?: string;
};

type WhatsAppChamadoRecord = WhatsAppChamadoInput & {
  id: string;
  status: "A";
  createdAt: string;
  updatedAt: string;
};

const MAX_ITEMS = 200;

export async function saveWhatsAppChamado(input: WhatsAppChamadoInput) {
  const remoteDigits = formatRemoteJid(input.remoteJid);
  if (!remoteDigits) return null;

  const now = new Date().toISOString();
  const id = buildId(input.messageId, remoteDigits);
  const items = await readWhatsAppChamados();
  const existingIndex = items.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const record: WhatsAppChamadoRecord = {
    id,
    status: "A",
    messageId: input.messageId,
    remoteJid: input.remoteJid,
    pushName: truncate(input.pushName || "", 120),
    messageType: truncate(input.messageType || "conversation", 60),
    text: truncate(input.text || "", 900),
    receivedAt: input.receivedAt || now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const next = existingIndex >= 0
    ? [record, ...items.filter((_, index) => index !== existingIndex)]
    : [record, ...items];

  await writeWhatsAppChamados(next.slice(0, MAX_ITEMS));
  return record;
}

export async function getWhatsAppChamados(): Promise<IxcChamado[]> {
  const items = await readWhatsAppChamados();
  return items
    .filter((item) => item.status === "A")
    .map((item) => ({
      id: item.id,
      assunto: `WhatsApp: ${item.pushName || formatRemoteJid(item.remoteJid) || "Sem nome"}`,
      descricao: item.text || `Mensagem recebida via WhatsApp (${item.messageType || "sem texto"})`,
      status: "A",
      prioridade: "M",
      id_cliente: "",
      nome_cliente: item.pushName || formatRemoteJid(item.remoteJid) || "Contato WhatsApp",
      data_abertura: item.receivedAt || item.createdAt,
      data_update: item.updatedAt || item.receivedAt || item.createdAt,
    }));
}

export async function getWhatsAppChamadoById(id: string) {
  const items = await readWhatsAppChamados();
  return items.find((item) => item.id === id && item.status === "A") || null;
}

export async function markWhatsAppChamadoAnswered(id: string, text: string) {
  const items = await readWhatsAppChamados();
  const now = new Date().toISOString();
  const next = items.map((item) => {
    if (item.id !== id) return item;

    return {
      ...item,
      text: truncate(`${item.text || ""}\n\nResposta enviada: ${text}`.trim(), 900),
      updatedAt: now,
    };
  });

  await writeWhatsAppChamados(next);
}

export function whatsappNumberFromJid(remoteJid: string) {
  return formatRemoteJid(remoteJid).replace(/\D/g, "");
}

async function readWhatsAppChamados(): Promise<WhatsAppChamadoRecord[]> {
  try {
    const content = await readFile(storagePath(), "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

async function writeWhatsAppChamados(items: WhatsAppChamadoRecord[]) {
  const file = storagePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

function storagePath() {
  return process.env.WHATSAPP_CHAMADOS_PATH || path.join(process.env.DATA_DIR || "/tmp/glc-atende", "whatsapp-chamados.json");
}

function buildId(messageId: string | undefined, remoteDigits: string) {
  const suffix = messageId ? messageId.slice(-12) : String(Date.now());
  return `wa-${remoteDigits}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "");
}

function formatRemoteJid(remoteJid: string) {
  return remoteJid.replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, "");
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function isRecord(value: unknown): value is WhatsAppChamadoRecord {
  return Boolean(value && typeof value === "object" && "id" in value);
}
