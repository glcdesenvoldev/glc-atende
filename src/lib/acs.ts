import type { IxcCliente, IxcContrato } from "@/lib/ixc";

export type AcsWifiInterface = {
  ssid?: string;
  enabled?: boolean;
  band?: string;
  security?: string;
};

export type AcsDeviceSummary = {
  provider: "ixc-acs";
  enabled: boolean;
  configured: boolean;
  found: boolean;
  mode: "read_only" | "write_locked";
  deviceId?: string;
  serialNumber?: string;
  mac?: string;
  manufacturer?: string;
  model?: string;
  softwareVersion?: string;
  online?: boolean;
  ip?: string;
  pppoeLogin?: string;
  lastInform?: string;
  uptime?: string;
  opticalPower?: string;
  wifi?: AcsWifiInterface[];
  identifiersTried?: string[];
  actionsAvailable: {
    read: boolean;
    reboot: boolean;
    changeWifiPassword: boolean;
  };
  message?: string;
  error?: string;
};

type AcsConfig = {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  accessToken?: string;
  privateKeyPem?: string;
  authPath: string;
  mode: "read_only" | "write_locked";
  timeoutMs: number;
};

export function getAcsConfig(): AcsConfig {
  const mode = process.env.ACS_MODE === "write_locked" ? "write_locked" : "read_only";
  return {
    enabled: process.env.ACS_ENABLED === "1",
    baseUrl: trimTrailingSlash(process.env.ACS_BASE_URL || "https://acs.glcinternet.com.br"),
    clientId: process.env.ACS_CLIENT_ID || "",
    clientSecret: process.env.ACS_CLIENT_SECRET,
    accessToken: process.env.ACS_ACCESS_TOKEN,
    privateKeyPem: normalizePem(process.env.ACS_PRIVATE_KEY_PEM),
    authPath: process.env.ACS_AUTH_PATH || "/api/v2/token/oauth",
    mode,
    timeoutMs: Number(process.env.ACS_TIMEOUT_MS || "12000"),
  };
}

export async function getAcsDeviceForCliente(cliente: IxcCliente, contratos: IxcContrato[]): Promise<AcsDeviceSummary> {
  const config = getAcsConfig();
  const identifiers = extractAcsIdentifiers(cliente, contratos);
  const base: AcsDeviceSummary = {
    provider: "ixc-acs",
    enabled: config.enabled,
    configured: Boolean(config.baseUrl && config.clientId && (config.clientSecret || config.accessToken || config.privateKeyPem)),
    found: false,
    mode: config.mode,
    identifiersTried: identifiers,
    actionsAvailable: {
      read: false,
      reboot: false,
      changeWifiPassword: false,
    },
  };

  if (!config.enabled) {
    return { ...base, message: "ACS configurado no código, mas desligado por ACS_ENABLED." };
  }

  if (!base.configured) {
    return { ...base, message: "ACS sem credenciais configuradas no ambiente." };
  }

  if (!identifiers.length) {
    return { ...base, actionsAvailable: { ...base.actionsAvailable, read: true }, message: "Nenhum serial/MAC/login técnico encontrado no IXC para localizar CPE no ACS." };
  }

  try {
    const token = await getAcsAccessToken(config);
    if (!token) {
      return { ...base, error: "Não foi possível obter token de acesso do ACS." };
    }

    // Primeira fase: tentativa conservadora usando endpoints de leitura do próprio IXC ACS.
    // Os caminhos são configuráveis porque a API pode variar por versão/permissão.
    const device = await findDevice(config, token, identifiers);
    if (!device) {
      return { ...base, configured: true, actionsAvailable: { ...base.actionsAvailable, read: true }, message: "Nenhum dispositivo encontrado no ACS com os identificadores disponíveis." };
    }

    return normalizeAcsDevice(device, identifiers, config.mode);
  } catch (error) {
    return {
      ...base,
      configured: true,
      error: error instanceof Error ? error.message : "Erro desconhecido ao consultar ACS.",
    };
  }
}

function extractAcsIdentifiers(cliente: IxcCliente, contratos: IxcContrato[]) {
  const values = new Set<string>();
  const add = (value: unknown) => {
    const clean = String(value || "").trim();
    if (clean && clean !== "0" && clean.length >= 3) values.add(clean);
  };

  add(cliente.id);
  for (const contrato of contratos) {
    const record = contrato as unknown as Record<string, unknown>;
    [
      "login",
      "login_radius",
      "pppoe",
      "pppoe_login",
      "usuario_pppoe",
      "id_login",
      "id_radusuarios",
      "serial",
      "serial_number",
      "serialNumber",
      "onu_serial",
      "mac",
      "mac_address",
      "endereco_mac",
    ].forEach((key) => add(record[key]));
  }

  return Array.from(values).slice(0, 10);
}

async function getAcsAccessToken(config: AcsConfig) {
  if (config.accessToken) return config.accessToken;

  // IXC ACS usa OAuth2 com client_id + client_secret via form-urlencoded
  // Endpoint oficial: POST /api/v2/token/oauth
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret || "",
  }).toString();

  const response = await acsFetch<Record<string, unknown>>(config, config.authPath, {
    method: "POST",
    body,
    contentType: "application/x-www-form-urlencoded",
  });

  return String(response?.access_token || response?.accessToken || response?.token || "");
}

async function findDevice(config: AcsConfig, token: string, identifiers: string[]) {
  // API v2 pública: GET /api/v2/devices/views/natural com search por serialNumber
  const searchPaths = (process.env.ACS_DEVICE_SEARCH_PATHS || "/api/v2/devices/views/natural")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);

  for (const identifier of identifiers) {
    for (const path of searchPaths) {
      const separator = path.includes("?") ? "&" : "?";
      const url = `${path}${separator}search=${encodeURIComponent(identifier)}`;
      const data = await acsFetch<unknown>(config, url, { method: "GET", token }).catch(() => null);
      const candidate = pickFirstDevice(data, identifier);
      if (candidate) return candidate;
    }
  }

  return null;
}

async function acsFetch<T>(config: AcsConfig, path: string, init: { method: "GET" | "POST"; body?: string; token?: string; contentType?: string }): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "Accept": "application/json",
        "Content-Type": init.contentType || "application/json",
        ...(init.token ? { "Authorization": `Bearer ${init.token}` } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`ACS HTTP ${res.status} em ${path}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function pickFirstDevice(data: unknown, identifier: string): Record<string, unknown> | null {
  const candidates = collectObjects(data).filter((item) => looksLikeDevice(item));
  const exact = candidates.find((item) => JSON.stringify(item).toLowerCase().includes(identifier.toLowerCase()));
  return exact || candidates[0] || null;
}

function collectObjects(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data.flatMap(collectObjects);
  const record = data as Record<string, unknown>;
  const direct = looksLikeDevice(record) ? [record] : [];
  const nested = ["data", "items", "rows", "results", "devices"].flatMap((key) => collectObjects(record[key]));
  return [...direct, ...nested];
}

function looksLikeDevice(item: Record<string, unknown>) {
  return Boolean(item.id || item.serialNumber || item.serial_number || item.sn || item.mac || item.deviceInfo);
}

function normalizeAcsDevice(raw: Record<string, unknown>, identifiers: string[], mode: AcsConfig["mode"]): AcsDeviceSummary {
  const info = (raw.deviceInfo && typeof raw.deviceInfo === "object" ? raw.deviceInfo : {}) as Record<string, unknown>;
  return {
    provider: "ixc-acs",
    enabled: true,
    configured: true,
    found: true,
    mode,
    deviceId: stringValue(raw.id || raw._id || raw.serialNumber || raw.serial_number || raw.sn),
    serialNumber: stringValue(raw.serialNumber || raw.serial_number || raw.sn || info.serialNumber),
    mac: stringValue(raw.mac || raw.macAddress || info.mac),
    manufacturer: stringValue(raw.manufacturer || info.manufacturer),
    model: stringValue(raw.modelName || raw.model || info.modelName || info.model),
    softwareVersion: stringValue(raw.softwareVersion || info.softwareVersion),
    online: booleanValue(raw.online ?? raw.connected ?? raw.status),
    ip: stringValue(raw.ip || raw.ipAddress || info.ip),
    pppoeLogin: stringValue(raw.pppoe || raw.pppLogin || info.pppLogin),
    lastInform: stringValue(raw.lastInform || raw.lastConnection || raw.updatedAt),
    uptime: stringValue(raw.uptime || info.uptime),
    opticalPower: stringValue(raw.opticalPower || raw.rxPower || info.opticalPower),
    wifi: normalizeWifi(raw),
    identifiersTried: identifiers,
    actionsAvailable: {
      read: true,
      reboot: false,
      changeWifiPassword: false,
    },
  };
}

function normalizeWifi(raw: Record<string, unknown>): AcsWifiInterface[] | undefined {
  const wifi = raw.wifi || raw.wifiInterfaces || raw.WiFi;
  if (!wifi) return undefined;
  if (Array.isArray(wifi)) return wifi.map((item) => normalizeWifiInterface(item)).filter(Boolean) as AcsWifiInterface[];
  if (typeof wifi === "object") return Object.values(wifi).map((item) => normalizeWifiInterface(item)).filter(Boolean) as AcsWifiInterface[];
  return undefined;
}

function normalizeWifiInterface(value: unknown): AcsWifiInterface | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    ssid: stringValue(record.ssid || record.SSID || record.name),
    enabled: booleanValue(record.enabled ?? record.Enable),
    band: stringValue(record.band || record.frequency),
    security: stringValue(record.security || record.beaconType),
  };
}

function normalizePem(value?: string) {
  if (!value) return undefined;
  return value.replace(/\\n/g, "\n");
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stringValue(value: unknown) {
  const clean = String(value || "").trim();
  return clean || undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  const clean = String(value || "").trim().toLowerCase();
  if (["true", "1", "sim", "online", "connected", "conectado"].includes(clean)) return true;
  if (["false", "0", "nao", "não", "offline", "disconnected", "desconectado"].includes(clean)) return false;
  return undefined;
}
