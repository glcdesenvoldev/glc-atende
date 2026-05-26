type EvolutionSendTextInput = {
  number: string;
  text: string;
  instance?: string;
};

export type EvolutionSendTextResult =
  | { ok: true; messageId?: string }
  | { ok: false; reason: string; status?: number };

export function normalizeBrazilWhatsAppNumber(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return "";
  return `55${national}`;
}

export function maskWhatsAppNumber(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***${digits.slice(-4)}`;
}

export function isBillingCadenceWhatsAppEnabled() {
  return process.env.BILLING_CADENCE_WHATSAPP_ENABLED === "1";
}

export function getBillingCadenceEvolutionConfig() {
  return {
    enabled: isBillingCadenceWhatsAppEnabled(),
    url: process.env.EVOLUTION_API_URL || "",
    apiKey: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.EVOLUTION_BILLING_INSTANCE || process.env.EVOLUTION_INSTANCE || "glc",
  };
}

export async function sendEvolutionText(input: EvolutionSendTextInput): Promise<EvolutionSendTextResult> {
  const config = getBillingCadenceEvolutionConfig();
  const number = normalizeBrazilWhatsAppNumber(input.number);

  if (!config.enabled) return { ok: false, reason: "Envio WhatsApp da régua bloqueado por BILLING_CADENCE_WHATSAPP_ENABLED." };
  if (!config.url || !config.apiKey || !config.instance) return { ok: false, reason: "Evolution API sem URL, chave ou instância configurada." };
  if (!number) return { ok: false, reason: "Telefone WhatsApp inválido ou ausente." };

  const response = await fetch(`${config.url.replace(/\/$/, "")}/message/sendText/${input.instance || config.instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": config.apiKey },
    body: JSON.stringify({ number, text: input.text }),
  });

  if (!response.ok) return { ok: false, reason: "Evolution API retornou falha no envio.", status: response.status };

  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  const key = data?.key && typeof data.key === "object" ? data.key as Record<string, unknown> : null;
  const messageId = firstString(data?.id, data?.messageId, key?.id);
  return { ok: true, messageId };
}

function firstString(...values: unknown[]) {
  const value = values.find((item) => typeof item === "string" || typeof item === "number");
  return value == null ? undefined : String(value);
}
