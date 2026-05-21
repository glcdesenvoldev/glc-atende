import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import QRCode from "qrcode";
import { ixcApi, type IxcChamado, type IxcCliente, type IxcFatura } from "@/lib/ixc";

const TELEGRAM_API = "https://api.telegram.org/bot";

export type TelegramUpdate = {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
};

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: TelegramUser;
  text?: string;
};

type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type AuditContext = {
  userId: number;
  username?: string;
  firstName?: string;
  chatId: number;
  chatType: string;
  messageId?: number;
};

export function getTelegramConfig() {
  const allowedUsers = parseCsvIds(process.env.TELEGRAM_ALLOWED_USERS);
  const allowedGroups = parseCsvIds(process.env.TELEGRAM_ALLOWED_GROUPS || process.env.TELEGRAM_GROUP_ID);

  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    allowedUsers,
    allowedGroups,
  };
}

export function isTelegramConfigured() {
  return Boolean(getTelegramConfig().botToken);
}

export function validateTelegramSecret(headerValue: string | null) {
  const { webhookSecret } = getTelegramConfig();
  if (!webhookSecret) return true;
  return headerValue === webhookSecret;
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message || update.edited_message || update.callback_query?.message;
  const actor = update.callback_query?.from || message?.from;
  const chatId = message?.chat.id;

  if (!message || !actor || !chatId) return { ok: true, ignored: "empty_update" };
  const auditContext: AuditContext = {
    userId: actor.id,
    username: actor.username,
    firstName: actor.first_name,
    chatId,
    chatType: message.chat.type,
    messageId: message.message_id,
  };

  const accessDenial = getAccessDenialReason(actor.id, chatId, message.chat.type);
  if (accessDenial) {
    await auditLog(auditContext, { action: "access_denied", status: "denied", reason: accessDenial.code });
    await sendTelegramMessage(chatId, accessDenial.message);
    return { ok: true, ignored: accessDenial.code };
  }

  if (update.callback_query?.data) {
    await handleCallback(auditContext, update.callback_query.data);
    return { ok: true };
  }

  const text = (message.text || "").trim();
  if (!text) return { ok: true, ignored: "no_text" };

  await handleCommand(auditContext, text);
  return { ok: true };
}

async function handleCallback(context: AuditContext, data: string) {
  const [action, value] = data.split(":");

  if (action === "faturas" && value) {
    await replyFaturas(context, value, "faturas_callback");
    return;
  }

  if (action === "fatura_segura" && value) {
    await replyFaturaSegura(context, value, "fatura_segura_callback");
    return;
  }

  if (action === "cliente" && value) {
    await replyCliente(context, value, "cliente_callback");
    return;
  }

  await auditLog(context, { action: "callback_unsupported", status: "ignored", command: action });
  await sendTelegramMessage(context.chatId, "Comando de botão ainda não suportado.");
}

async function handleCommand(context: AuditContext, text: string) {
  const [rawCommand, ...rest] = text.split(/\s+/);

  if (!rawCommand.startsWith("/")) {
    if (context.chatType === "private") {
      await replyCliente(context, text, "cliente_direct_private");
      return;
    }

    const mentionQuery = extractBotMentionQuery(text);
    if (mentionQuery) {
      await replyCliente(context, mentionQuery, "cliente_mention_group");
    }
    return;
  }

  const command = rawCommand.toLowerCase().split("@")[0];
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/start":
    case "/ajuda":
    case "/help":
      await sendTelegramMessage(context.chatId, helpText());
      return;

    case "/chamados":
    case "/abertos":
      await replyChamados(context);
      return;

    case "/chamado":
      if (!arg) {
        await sendTelegramMessage(context.chatId, "Use: /chamado ID_DO_CHAMADO\nEx.: /chamado 12345");
        return;
      }
      await replyChamado(context, arg);
      return;

    case "/cliente":
    case "/c":
      if (!arg) {
        await sendTelegramMessage(context.chatId, "Use: /cliente ID, telefone ou nome\nAtalho: /c 12345\n\nNo privado, também pode mandar direto: 12345, telefone ou nome.");
        return;
      }
      await replyCliente(context, arg, command === "/c" ? "cliente_short_command" : "cliente_command");
      return;

    case "/faturas":
    case "/boletos":
      if (!arg) {
        await sendTelegramMessage(context.chatId, "Use: /faturas ID_CLIENTE\nEx.: /faturas 12345");
        return;
      }
      await replyFaturas(context, arg, "faturas_command");
      return;

    case "/fatura_segura":
    case "/fs":
      if (!arg) {
        await sendTelegramMessage(context.chatId, "Use: /fatura_segura ID_CLIENTE\nAtalho: /fs 12345");
        return;
      }
      await replyFaturaSegura(context, arg, command === "/fs" ? "fatura_segura_short_command" : "fatura_segura_command");
      return;

    case "/pix":
    case "/boleto":
      await auditLog(context, { action: command.slice(1), status: "blocked" });
      await sendTelegramMessage(
        context.chatId,
        "⚠️ Geração/envio automático de PIX ou boleto ainda está bloqueado por segurança.\n\nUse /faturas ID_CLIENTE para consultar as faturas e copiar os dados disponíveis."
      );
      return;

    default:
      await auditLog(context, { action: "unknown_command", status: "ignored", command });
      await sendTelegramMessage(context.chatId, `Comando não reconhecido.\n\n${helpText()}`);
  }
}

async function replyChamados(context: AuditContext) {
  const { total, items } = await ixcApi.getChamados(1, "A");
  if (items.length === 0) {
    await auditLog(context, { action: "chamados", status: "success", resultCount: 0, total });
    await sendTelegramMessage(context.chatId, `✅ Nenhum chamado aberto encontrado. Total IXC: ${total}.`);
    return;
  }

  const lines = items.slice(0, 10).map(formatChamado);
  await auditLog(context, { action: "chamados", status: "success", resultCount: items.length, total, chamadoIds: items.slice(0, 10).map((item) => item.id) });
  await sendTelegramMessage(context.chatId, `📋 Chamados abertos: ${total}\n\n${lines.join("\n\n")}`);
}

async function replyChamado(context: AuditContext, idChamado: string) {
  const clean = idChamado.trim().replace(/[^0-9A-Za-z_-]/g, "");
  const chamado = await ixcApi.getChamado(clean);

  if (!chamado) {
    await auditLog(context, { action: "chamado_lookup", status: "not_found", chamadoId: clean });
    await sendTelegramMessage(context.chatId, `Chamado ${clean} não encontrado.`);
    return;
  }

  await auditLog(context, { action: "chamado_lookup", status: "success", chamadoId: chamado.id, clientId: chamado.id_cliente });
  await sendTelegramMessage(context.chatId, formatChamadoDetalhado(chamado));
}

async function replyCliente(context: AuditContext, query: string, action = "cliente_lookup") {
  const clean = query.trim();
  const result = await ixcApi.buscarClientes(clean);

  if (result.items.length === 0) {
    await auditLog(context, { action, status: "not_found", queryType: classifyLookupTerm(clean), resultCount: 0 });
    await sendTelegramMessage(context.chatId, "Cliente não encontrado. Tente ID, telefone com DDD ou parte do nome.");
    return;
  }

  const lines = result.items.slice(0, 5).map(formatCliente);
  const keyboard: ReplyMarkup | undefined = result.items.length === 1
    ? { inline_keyboard: [[
        { text: "Ver faturas", callback_data: `faturas:${result.items[0].id}` },
        { text: "Fatura segura", callback_data: `fatura_segura:${result.items[0].id}` },
      ]] }
    : undefined;

  await auditLog(context, { action, status: "success", queryType: classifyLookupTerm(clean), resultCount: result.items.length, clientIds: result.items.slice(0, 5).map((item) => item.id) });
  await sendTelegramMessage(context.chatId, `👤 Cliente(s) encontrado(s):\n\n${lines.join("\n\n")}`, keyboard);
}

async function replyFaturas(context: AuditContext, idCliente: string, action = "faturas_lookup") {
  const { items } = await ixcApi.getFaturasCliente(idCliente.trim());

  if (items.length === 0) {
    await auditLog(context, { action, status: "success", clientId: idCliente.trim(), resultCount: 0 });
    await sendTelegramMessage(context.chatId, `✅ Nenhuma fatura aberta/localizada para o cliente ${idCliente}.`);
    return;
  }

  const lines = items.slice(0, 8).map(formatFatura);
  await auditLog(context, { action, status: "success", clientId: idCliente.trim(), resultCount: items.length, faturaIds: items.slice(0, 8).map((item) => item.id) });
  await sendTelegramMessage(
    context.chatId,
    `💰 Faturas do cliente ${idCliente}\n\n${lines.join("\n\n")}\n\n⚠️ Modo seguro: confira os dados antes de enviar boleto/PIX ao cliente.`
  );

}

async function replyFaturaSegura(context: AuditContext, idCliente: string, action = "fatura_segura_lookup") {
  const clean = idCliente.trim();
  const result = await ixcApi.getFaturaSeguraCliente(clean);

  if (!result.ok) {
    await auditLog(context, { action, status: "blocked", clientId: clean, reason: result.reason, resultCount: result.total, faturaIds: result.items.slice(0, 10).map((item) => item.id) });

    if (result.reason === "unavailable") {
      await sendTelegramMessage(context.chatId, "⚠️ IXC indisponível ou sem resposta. Não gere nem envie boleto/PIX agora.");
      return;
    }

    if (result.reason === "none") {
      await sendTelegramMessage(context.chatId, `✅ Nenhuma fatura aberta/localizada para o cliente ${escapeHtml(clean)}.`);
      return;
    }

    const lines = result.items.slice(0, 8).map(formatFaturaResumo);
    await sendTelegramMessage(
      context.chatId,
      `🛑 Envio bloqueado por segurança.\n\nCliente ${escapeHtml(clean)} possui ${result.total} faturas abertas/localizadas. Para evitar pagamento errado, escolha manualmente no IXC.\n\n${lines.join("\n\n")}`
    );
    return;
  }

  await auditLog(context, { action, status: "success", clientId: clean, resultCount: 1, faturaIds: [result.fatura.id] });
  await sendTelegramMessage(
    context.chatId,
    `✅ Fatura segura localizada para cliente ${escapeHtml(clean)}\n\n${formatFatura(result.fatura)}\n\n⚠️ Conferir nome/cliente no IXC antes de enviar ao cliente. Envio automático externo continua bloqueado nesta fase.`
  );


  const pix = result.fatura.pix_copia_cola || result.fatura.pix;
  if (pix) {
    const qr = await generatePixQrCode(pix);
    if (qr) {
      await sendTelegramPhoto(
        context.chatId,
        qr,
        `PIX QR Code interno — fatura ${result.fatura.id}. Conferir antes de enviar ao cliente.`,
        "pix-qrcode.png"
      );
    }
  }
}

async function generatePixQrCode(payload: string) {
  const clean = payload.trim();
  if (!clean) return null;
  try {
    return await QRCode.toBuffer(clean, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
    });
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: ReplyMarkup) {
  const { botToken } = getTelegramConfig();
  if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN ausente" };

  const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncate(text, 3900),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  });

  return res.json();
}

function classifyLookupTerm(value: string) {
  const clean = value.trim();
  const digits = clean.replace(/\D/g, "");
  if (/^\d+$/.test(clean) && clean.length <= 7) return "id";
  if (digits.length >= 10) return "phone";
  if (/^\d+$/.test(clean)) return "numeric";
  return "name";
}

async function auditLog(context: AuditContext, event: Record<string, unknown>) {
  const logPath = process.env.AUDIT_LOG_PATH || "/app/data/audit/telegram-audit.jsonl";
  const payload = {
    ts: new Date().toISOString(),
    channel: "telegram",
    userId: context.userId,
    username: context.username,
    firstName: context.firstName,
    chatId: context.chatId,
    chatType: context.chatType,
    messageId: context.messageId,
    ...event,
  };

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(payload)}
`, "utf8");
  } catch (error) {
    console.error("telegram_audit_log_failed", error);
  }
}

function getAccessDenialReason(userId: number, chatId: number, chatType: string) {
  const { allowedUsers, allowedGroups } = getTelegramConfig();
  const privateUsers = parseCsvIds(process.env.TELEGRAM_PRIVATE_USERS || "6384458827");
  const restrictedUsers = parseCsvIds(process.env.TELEGRAM_RESTRICTED_HOURS_USERS || "8705085560");
  const userIdText = String(userId);

  if (chatType === "private" && !privateUsers.includes(userIdText)) {
    return {
      code: "private_access_denied",
      message: "⚠️ Acesso privado não autorizado. Use o grupo oficial para manter auditoria das consultas.",
    };
  }

  const userAllowed = allowedUsers.length === 0 || allowedUsers.includes(userIdText);
  const groupAllowed = chatType === "private" || allowedGroups.length === 0 || allowedGroups.includes(String(chatId));
  if (!userAllowed || !groupAllowed) {
    return { code: "unauthorized", message: "⚠️ Acesso não autorizado neste bot." };
  }

  if (restrictedUsers.includes(userIdText) && !isWithinBusinessHours()) {
    return {
      code: "outside_business_hours",
      message: "⏰ Acesso fora do horário permitido.\n\nHorário do operador: segunda a sexta, 08:00 às 18:00 (Brasília).\nPara urgência, acione Gilson.",
    };
  }

  return null;
}

function isWithinBusinessHours(date = new Date()) {
  const timeZone = process.env.TELEGRAM_ACCESS_TIMEZONE || "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekday = value("weekday");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const allowedWeekdays = parseCsvIds(process.env.TELEGRAM_ACCESS_WEEKDAYS || "Mon,Tue,Wed,Thu,Fri");
  const start = parseHour(process.env.TELEGRAM_ACCESS_START || "08:00");
  const end = parseHour(process.env.TELEGRAM_ACCESS_END || "18:00");
  const nowMinutes = hour * 60 + minute;

  return allowedWeekdays.includes(weekday) && nowMinutes >= start && nowMinutes < end;
}

function parseHour(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return (hour || 0) * 60 + (minute || 0);
}

function extractBotMentionQuery(text: string) {
  const match = text.trim().match(/^@?(GLCATENDE_bot|glcatende_bot)\s+(.+)$/i);
  return match?.[2]?.trim() || "";
}

function parseCsvIds(value?: string) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function sendTelegramPhoto(chatId: string | number, image: Buffer, caption?: string, filename = "imagem.png") {
  const { botToken } = getTelegramConfig();
  if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN ausente" };

  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("photo", new Blob([new Uint8Array(image)], { type: "image/png" }), filename);
  if (caption) form.set("caption", truncate(caption, 900));

  const res = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });

  return res.json();
}

function helpText() {
  return [
    "🤖 GLC Atende — comandos internos",
    "",
    "/chamados ou /abertos — lista chamados abertos",
    "/chamado ID — detalhe rápido de um chamado",
    "/cliente ID|telefone|nome — consulta cliente",
    "/c termo — atalho para consulta de cliente",
    "No privado: envie só o ID, telefone ou nome para buscar cliente",
    "No grupo: /c termo ou /cliente termo",
    "Operador: acesso permitido seg-sex, 08:00-18:00",
    "/faturas ID_CLIENTE — lista faturas abertas/localizadas",
    "/fatura_segura ID_CLIENTE ou /fs ID_CLIENTE — só retorna se existir exatamente 1 fatura aberta",
    "/pix ID_FATURA — bloqueado por segurança nesta fase",
    "/boleto ID_FATURA — bloqueado por segurança nesta fase",
  ].join("\n");
}

function formatChamado(chamado: IxcChamado) {
  return [
    `#${escapeHtml(chamado.id)} — ${escapeHtml(chamado.assunto || "Sem assunto")}`,
    `Cliente: ${escapeHtml(chamado.nome_cliente || chamado.id_cliente || "não informado")}`,
    `Prioridade: ${escapeHtml(chamado.prioridade || "-")} · Status: ${escapeHtml(chamado.status || "-")}`,
  ].join("\n");
}

function formatChamadoDetalhado(chamado: IxcChamado) {
  return [
    `📋 Chamado #${escapeHtml(chamado.id)}`,
    "",
    `Cliente ID: ${escapeHtml(chamado.id_cliente || "-")}`,
    chamado.nome_cliente ? `Cliente: ${escapeHtml(chamado.nome_cliente)}` : "",
    `Assunto: ${escapeHtml(chamado.assunto || "Sem assunto")}`,
    `Prioridade: ${escapeHtml(chamado.prioridade || "-")} · Status: ${escapeHtml(chamado.status || "-")}`,
    chamado.data_abertura ? `Abertura: ${escapeHtml(chamado.data_abertura)}` : "",
    chamado.descricao ? `Descrição: ${escapeHtml(truncate(chamado.descricao, 700))}` : "",
    "",
    chamado.id_cliente ? `Para consultar cliente: /c ${escapeHtml(chamado.id_cliente)}` : "",
  ].filter(Boolean).join("\n");
}

function formatCliente(cliente: IxcCliente) {
  const telefone = cliente.telefone_celular || cliente.fone_celular || cliente.fone || "-";
  const endereco = [cliente.endereco, cliente.numero, cliente.bairro, cliente.cidade].filter(Boolean).join(", ");

  return [
    `ID: ${escapeHtml(cliente.id)}`,
    `Nome: ${escapeHtml(cliente.razao || cliente.fantasia || "-")}`,
    `Status: ${escapeHtml(cliente.status || "-")}`,
    `Telefone: ${escapeHtml(telefone)}`,
    endereco ? `Endereço: ${escapeHtml(endereco)}` : "",
  ].filter(Boolean).join("\n");
}

function formatFaturaResumo(fatura: IxcFatura) {
  const valor = fatura.valor_aberto || fatura.valor || "-";
  return [
    `Fatura: ${escapeHtml(fatura.id)}`,
    `Valor: R$ ${escapeHtml(valor)} · Venc.: ${escapeHtml(fatura.data_vencimento || "-")}`,
    `Status: ${escapeHtml(fatura.status || fatura.status_cobranca || "-")}`,
  ].join("\n");
}

function formatFatura(fatura: IxcFatura) {
  const valor = fatura.valor_aberto || fatura.valor || "-";
  const partes = [
    `Fatura: ${escapeHtml(fatura.id)}`,
    `Valor: R$ ${escapeHtml(valor)} · Venc.: ${escapeHtml(fatura.data_vencimento || "-")}`,
    `Status: ${escapeHtml(fatura.status || fatura.status_cobranca || "-")}`,
  ];

  const linhaDigitavel = fatura.linha_digitavel || fatura.boleto;
  const pix = fatura.pix_copia_cola || fatura.pix;

  if (linhaDigitavel) {
    partes.push(`Linha digitável: ${escapeHtml(linhaDigitavel)}`);
    partes.push("Boleto: use a linha digitável ou o link/PDF abaixo, quando disponível.");
  } else {
    partes.push("Código de barras/linha digitável: não retornado pelo IXC nesta consulta.");
  }

  if (pix) {
    partes.push(`PIX copia e cola: ${escapeHtml(pix)}`);
    partes.push("PIX QR Code: enviado abaixo em imagem interna.");
  } else if (fatura.pix_txid) {
    partes.push("PIX: IXC retornou apenas TXID, sem copia-e-cola. QR PIX não gerado por segurança.");
  } else {
    partes.push("PIX copia-e-cola/QR: não retornado pelo IXC nesta consulta.");
  }

  const link = fatura.link || fatura.gateway_link;
  if (link) partes.push(`Link: ${escapeHtml(link)}`);

  return partes.join("\n");
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 20)}\n...conteúdo cortado` : text;
}
