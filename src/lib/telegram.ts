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
  if (!isAuthorized(actor.id, chatId, message.chat.type)) {
    await sendTelegramMessage(chatId, "⚠️ Acesso não autorizado neste bot.");
    return { ok: true, ignored: "unauthorized" };
  }

  if (update.callback_query?.data) {
    await handleCallback(chatId, update.callback_query.data);
    return { ok: true };
  }

  const text = (message.text || "").trim();
  if (!text) return { ok: true, ignored: "no_text" };

  await handleCommand(chatId, text);
  return { ok: true };
}

async function handleCallback(chatId: number, data: string) {
  const [action, value] = data.split(":");

  if (action === "faturas" && value) {
    await replyFaturas(chatId, value);
    return;
  }

  if (action === "cliente" && value) {
    await replyCliente(chatId, value);
    return;
  }

  await sendTelegramMessage(chatId, "Comando de botão ainda não suportado.");
}

async function handleCommand(chatId: number, text: string) {
  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().split("@")[0];
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/start":
    case "/ajuda":
    case "/help":
      await sendTelegramMessage(chatId, helpText());
      return;

    case "/chamados":
      await replyChamados(chatId);
      return;

    case "/cliente":
      if (!arg) {
        await sendTelegramMessage(chatId, "Use: /cliente ID, telefone ou nome\nEx.: /cliente 12345");
        return;
      }
      await replyCliente(chatId, arg);
      return;

    case "/faturas":
    case "/boletos":
      if (!arg) {
        await sendTelegramMessage(chatId, "Use: /faturas ID_CLIENTE\nEx.: /faturas 12345");
        return;
      }
      await replyFaturas(chatId, arg);
      return;

    case "/pix":
    case "/boleto":
      await sendTelegramMessage(
        chatId,
        "⚠️ Geração/envio automático de PIX ou boleto ainda está bloqueado por segurança.\n\nUse /faturas ID_CLIENTE para consultar as faturas e copiar os dados disponíveis."
      );
      return;

    default:
      await sendTelegramMessage(chatId, `Comando não reconhecido.\n\n${helpText()}`);
  }
}

async function replyChamados(chatId: number) {
  const { total, items } = await ixcApi.getChamados(1, "A");
  if (items.length === 0) {
    await sendTelegramMessage(chatId, `✅ Nenhum chamado aberto encontrado. Total IXC: ${total}.`);
    return;
  }

  const lines = items.slice(0, 10).map(formatChamado);
  await sendTelegramMessage(chatId, `📋 Chamados abertos: ${total}\n\n${lines.join("\n\n")}`);
}

async function replyCliente(chatId: number, query: string) {
  const result = /^\d+$/.test(query.trim())
    ? { total: 1, items: [await ixcApi.getCliente(query.trim())].filter(Boolean) as IxcCliente[] }
    : await ixcApi.buscarClientes(query);

  if (result.items.length === 0) {
    await sendTelegramMessage(chatId, "Cliente não encontrado. Tente ID, telefone com DDD ou parte do nome.");
    return;
  }

  const lines = result.items.slice(0, 5).map(formatCliente);
  const keyboard: ReplyMarkup | undefined = result.items.length === 1
    ? { inline_keyboard: [[{ text: "Ver faturas", callback_data: `faturas:${result.items[0].id}` }]] }
    : undefined;

  await sendTelegramMessage(chatId, `👤 Cliente(s) encontrado(s):\n\n${lines.join("\n\n")}`, keyboard);
}

async function replyFaturas(chatId: number, idCliente: string) {
  const { items } = await ixcApi.getFaturasCliente(idCliente.trim());

  if (items.length === 0) {
    await sendTelegramMessage(chatId, `✅ Nenhuma fatura aberta/localizada para o cliente ${idCliente}.`);
    return;
  }

  const lines = items.slice(0, 8).map(formatFatura);
  await sendTelegramMessage(
    chatId,
    `💰 Faturas do cliente ${idCliente}\n\n${lines.join("\n\n")}\n\n⚠️ Modo seguro: confira os dados antes de enviar boleto/PIX ao cliente.`
  );
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

function isAuthorized(userId: number, chatId: number, chatType: string) {
  const { allowedUsers, allowedGroups } = getTelegramConfig();
  const userAllowed = allowedUsers.length === 0 || allowedUsers.includes(String(userId));
  const groupAllowed = chatType === "private" || allowedGroups.length === 0 || allowedGroups.includes(String(chatId));
  return userAllowed && groupAllowed;
}

function parseCsvIds(value?: string) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function helpText() {
  return [
    "🤖 GLC Atende — comandos internos",
    "",
    "/chamados — lista chamados abertos",
    "/cliente ID|telefone|nome — consulta cliente",
    "/faturas ID_CLIENTE — lista faturas abertas/localizadas",
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

function formatFatura(fatura: IxcFatura) {
  const valor = fatura.valor_aberto || fatura.valor || "-";
  const partes = [
    `Fatura: ${escapeHtml(fatura.id)}`,
    `Valor: R$ ${escapeHtml(valor)} · Venc.: ${escapeHtml(fatura.data_vencimento || "-")}`,
    `Status: ${escapeHtml(fatura.status || fatura.status_cobranca || "-")}`,
  ];

  const linhaDigitavel = fatura.linha_digitavel || fatura.boleto;
  const pix = fatura.pix_copia_cola || fatura.pix;

  if (linhaDigitavel) partes.push(`Linha digitável: ${escapeHtml(linhaDigitavel)}`);
  if (pix) partes.push(`PIX copia e cola: ${escapeHtml(pix)}`);
  if (fatura.link) partes.push(`Link: ${escapeHtml(fatura.link)}`);

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
