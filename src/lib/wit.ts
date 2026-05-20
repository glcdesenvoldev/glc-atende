export type WitTicketSummary = {
  id: string;
  status?: string;
  queue?: string;
  attendant?: string;
  channel?: string;
  contactMasked?: string;
  clientName?: string;
  updatedAt?: string;
  attendanceTimeMs?: number;
  queueTimeMs?: number;
  rawKeys: string[];
};

export type WitMonitorResult = {
  ok: boolean;
  configured: boolean;
  status?: number;
  size: number;
  tickets: WitTicketSummary[];
  error?: string;
};

type WitAuth = {
  tokenType: string;
  accessToken: string;
  accountId: string;
};

const WIT_API_BASE = process.env.WIT_API_BASE || "https://app.withub.ai";
const DEFAULT_PROVIDER_ID = process.env.WIT_PROVIDER_ID || "14";
const DEFAULT_OPERATION_ID = process.env.WIT_OPERATION_ID || "2157";
const DEFAULT_USER_ID = process.env.WIT_USER_ID || "426f431b-6a72-42c1-a26f-bba28cd838b4";

export function getWitDefaults() {
  return {
    apiBase: WIT_API_BASE,
    providerId: DEFAULT_PROVIDER_ID,
    operationId: DEFAULT_OPERATION_ID,
    userId: DEFAULT_USER_ID,
  };
}

export function getWitAuthFromEnv(): WitAuth | null {
  const accessToken = process.env.WIT_ACCESS_TOKEN || "";
  const accountId = process.env.WIT_ACCOUNT_ID || "";
  const tokenType = process.env.WIT_TOKEN_TYPE || "Bearer";

  if (!accessToken || !accountId) return null;
  return { tokenType, accessToken, accountId };
}

export function getWitAuthFromHeaders(headers: Headers): WitAuth | null {
  const accessToken = headers.get("x-wit-access-token") || "";
  const accountId = headers.get("x-wit-account-id") || "";
  const tokenType = headers.get("x-wit-token-type") || "Bearer";

  if (!accessToken || !accountId) return null;
  return { tokenType, accessToken, accountId };
}

export async function getWitPendingTickets(auth: WitAuth): Promise<WitMonitorResult> {
  // Fonte principal do Dashboard/Atendimento: lista tickets já em atendimento humano/bot.
  const attendanceResult = await fetchWitTickets(
    auth,
    `${WIT_API_BASE}/api/main/dashboard/metrics/attendances/${DEFAULT_OPERATION_ID}`,
    normalizeAttendanceTickets,
  );

  if (attendanceResult.ok && attendanceResult.tickets.length > 0) return attendanceResult;

  // Fallback antigo: pode retornar vazio dependendo da visão/permissão do usuário monitor.
  const pendingResult = await fetchWitTickets(
    auth,
    `${WIT_API_BASE}/api/main/tickets/pending`,
    normalizePendingTickets,
  );

  if (!attendanceResult.ok && pendingResult.tickets.length === 0) return attendanceResult;
  return pendingResult.ok ? pendingResult : attendanceResult;
}

async function fetchWitTickets(
  auth: WitAuth,
  url: string,
  normalize: (payload: unknown) => WitTicketSummary[],
): Promise<WitMonitorResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: `${auth.tokenType} ${auth.accessToken}`,
        idAccount: auth.accountId,
      },
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json() : await response.text();

    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        status: response.status,
        size: 0,
        tickets: [],
        error: safeErrorMessage(body),
      };
    }

    const tickets = normalize(body);
    return {
      ok: true,
      configured: true,
      status: response.status,
      size: tickets.length,
      tickets,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      size: 0,
      tickets: [],
      error: error instanceof Error ? error.message : "wit_fetch_failed",
    };
  }
}

export async function getWitQueueMetrics(auth: WitAuth) {
  const params = new URLSearchParams();
  params.set("idUser", DEFAULT_USER_ID);
  params.append("idsOperation[]", DEFAULT_OPERATION_ID);
  params.append("idsProvider[]", DEFAULT_PROVIDER_ID);

  const response = await fetch(`${WIT_API_BASE}/api/main/tabulator/user/queues/metrics?${params.toString()}`, {
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `${auth.tokenType} ${auth.accessToken}`,
      idAccount: auth.accountId,
    },
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    // Retorna somente chaves/contadores para evitar vazar dados pessoais.
    keys: body?.data && typeof body.data === "object" ? Object.keys(body.data) : [],
    rawType: typeof body?.data,
  };
}

export function normalizeAttendanceTickets(payload: unknown): WitTicketSummary[] {
  const payloadRecord = asRecord(payload);
  const data = asRecord(payloadRecord?.data) || payloadRecord;
  const deskNotDailyMetrics = asRecord(data?.deskNotDailyMetrics);
  const rawTickets = deskNotDailyMetrics?.ticketsInDesk || [];

  const list = Array.isArray(rawTickets) ? rawTickets : [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((ticket) => {
      const contact = pickString(ticket, ["contactOrigin", "providerIdentifier"]);
      const assignedUser = pickNestedString(ticket, ["assignedUserForTicket.name"]);

      return {
        id: String(ticket.id || ticket.idTicket || ticket.ticketId || "sem-id"),
        status: pickNestedString(ticket, ["businessStatus.name", "businessStatus.label"]),
        queue: pickString(ticket, ["queue", "queueName"]),
        attendant: maskName(assignedUser || pickString(ticket, ["userName"])),
        channel: pickString(ticket, ["channel"]),
        contactMasked: contact ? maskContact(contact) : undefined,
        clientName: maskName(pickString(ticket, ["clientName"])),
        updatedAt: pickString(ticket, ["firstResponseAt", "updatedAt", "createdAt"]),
        attendanceTimeMs: pickNumber(ticket, ["attendanceTime"]),
        queueTimeMs: pickNumber(ticket, ["queueTime"]),
        rawKeys: Object.keys(ticket).slice(0, 40),
      };
    });
}

export function normalizePendingTickets(payload: unknown): WitTicketSummary[] {
  const payloadRecord = asRecord(payload);
  const data = asRecord(payloadRecord?.data) || payloadRecord;
  const rawTickets = data?.tickets || data?.items || data?.data || [];

  const list = Array.isArray(rawTickets)
    ? rawTickets
    : rawTickets && typeof rawTickets === "object"
      ? Object.values(rawTickets).flatMap((value) => Array.isArray(value) ? value : [value])
      : [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((ticket) => {
      const contact = pickString(ticket, [
        "phone",
        "telefone",
        "contact",
        "contactOrigin",
        "providerIdentifier",
        "whatsapp",
      ]);

      return {
        id: String(ticket.id || ticket.idTicket || ticket.ticketId || ticket.uuid || "sem-id"),
        status: pickString(ticket, ["status", "statusName", "situation", "state"]),
        queue: pickString(ticket, ["queue", "queueName", "department", "sector"]),
        attendant: maskName(pickNestedString(ticket, ["attendant.name", "user.name", "operator.name", "assignedUserForTicket.name"]) || pickString(ticket, ["userName"])),
        channel: pickNestedString(ticket, ["channel.name", "channel.type", "provider.name"]) || pickString(ticket, ["channel"]),
        contactMasked: contact ? maskContact(contact) : undefined,
        clientName: maskName(pickNestedString(ticket, ["customer.name", "client.name", "contact.name", "name"]) || pickString(ticket, ["clientName"])),
        updatedAt: pickString(ticket, ["updatedAt", "lastMessageAt", "lastInteractionAt", "createdAt"]),
        attendanceTimeMs: pickNumber(ticket, ["attendanceTime"]),
        queueTimeMs: pickNumber(ticket, ["queueTime"]),
        rawKeys: Object.keys(ticket).slice(0, 40),
      };
    });
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickNestedString(obj: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((acc, key) => asRecord(acc)?.[key], obj);
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function maskContact(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 3)}***@${domain}`;
  }
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : "***";
}

function maskName(value?: string) {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return `${parts[0].slice(0, 2)}***`;
  return `${parts[0]} ${parts[1].slice(0, 1)}***`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeErrorMessage(body: unknown) {
  if (typeof body === "string") return body.slice(0, 120);
  const record = asRecord(body);
  const status = record?.status || record?.statusCode;
  if (status) return `wit_http_${status}`;
  return "wit_request_failed";
}
