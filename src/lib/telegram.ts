import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import QRCode from "qrcode";
import { createFinanceApproval, decideFinanceApproval, listFinanceApprovals, markFinanceApprovalManualSent } from "@/lib/finance-approvals";
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

type TelegramDocument = Buffer | Uint8Array;

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
    await answerCallbackQuery(update.callback_query.id, "Processando...");
    await auditLog(auditContext, { action: "callback_received", status: "received", command: update.callback_query.data.split(":")[0] });
    await handleCallback(auditContext, update.callback_query.data);
    return { ok: true };
  }

  const text = (message.text || "").trim();
  if (!text) return { ok: true, ignored: "no_text" };

  await handleCommand(auditContext, text);
  return { ok: true };
}

async function handleCallback(context: AuditContext, data: string) {
  const [action, value, extra] = data.split(":");

  if (action === "faturas" && value) {
    await replyFaturas(context, value, "faturas_callback");
    return;
  }

  if (action === "fatura_segura" && value) {
    await replyFaturaSegura(context, value, "fatura_segura_callback");
    return;
  }

  if (action === "fatura_item" && value && extra) {
    await replyFaturaItem(context, value, extra);
    return;
  }

  if (action === "approval_sent" && value) {
    await replyRegistroEnvioManual(context, value);
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

    case "/aprovacoes":
    case "/ap":
      await replyAprovacoesFinanceiras(context, arg);
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
    `✅ Fatura segura localizada

Cliente: ${escapeHtml(clean)}
${formatFatura(result.fatura)}

Ações disponíveis:
📋 Copiar código para pagamento
📄 Abrir PDF do boleto

⚠️ Conferir nome/cliente no IXC antes de enviar ao cliente. Envio automático externo continua bloqueado nesta fase.`,
    buildFaturaActionsKeyboard(clean, result.fatura)
  );
}

async function replyAprovacoesFinanceiras(context: AuditContext, filter = "") {
  const cleanFilter = filter.trim();
  const all = await listFinanceApprovals();
  const filtered = cleanFilter
    ? all.filter((approval) => approval.idCliente === cleanFilter || approval.faturaId === cleanFilter || approval.id.startsWith(cleanFilter))
    : all;
  const items = filtered.slice(0, 8);

  await auditLog(context, { action: "finance_approvals_list", status: "success", resultCount: items.length, command: cleanFilter || "all" });

  if (!items.length) {
    await sendTelegramMessage(
      context.chatId,
      cleanFilter
        ? `Nenhuma aprovação encontrada para ${escapeHtml(cleanFilter)}.`
        : "Nenhuma aprovação financeira registrada ainda."
    );
    return;
  }

  const lines = items.map((approval) => [
    `${statusEmojiAprovacao(approval.status)} ${statusLabelAprovacao(approval.status)} — protocolo ${escapeHtml(approval.id.slice(0, 8))}`,
    `Cliente: ${escapeHtml(approval.idCliente)} · Fatura: ${escapeHtml(approval.faturaId)}`,
    `Valor: R$ ${escapeHtml(approval.valor || "-")} · Venc.: ${escapeHtml(approval.dataVencimento || "-")}`,
    `Atualizado: ${escapeHtml(formatTelegramDate(approval.updatedAt))}`,
  ].join("\n"));

  await sendTelegramMessage(
    context.chatId,
    ["📋 Aprovações financeiras internas", "", ...lines].join("\n\n"),
    buildAprovacoesListKeyboard(items)
  );
}

function buildAprovacoesListKeyboard(items: Awaited<ReturnType<typeof listFinanceApprovals>>): ReplyMarkup | undefined {
  const rows = items
    .filter((approval) => approval.status === "approved")
    .slice(0, 8)
    .map((approval) => ([{
      text: `📌 Marcar enviado ${approval.id.slice(0, 8)}`,
      callback_data: `approval_sent:${approval.id}`,
    }]));

  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function replyFaturaItem(context: AuditContext, kind: string, idCliente: string) {
  const result = await ixcApi.getFaturaSeguraCliente(idCliente);
  if (!result.ok) {
    await auditLog(context, { action: "fatura_item", status: "blocked", item: kind, clientId: idCliente, reason: result.reason, resultCount: result.total });
    await sendTelegramMessage(context.chatId, `⚠️ Não foi possível abrir este item. A fatura segura do cliente ${escapeHtml(idCliente)} não está mais disponível.`);
    return;
  }

  const fatura = result.fatura;
  const linhaDigitavel = fatura.linha_digitavel || fatura.codigo_barras || fatura.boleto || "";
  const pix = fatura.pix_copia_cola || fatura.pix || "";
  const link = fatura.link || fatura.gateway_link || "";

  await auditLog(context, { action: "fatura_item", status: "success", item: kind, clientId: idCliente, faturaId: fatura.id });

  if (kind === "linha") {
    await sendTelegramMessage(context.chatId, linhaDigitavel ? `📋 Código do boleto — fatura ${escapeHtml(fatura.id)}

<code>${escapeHtml(linhaDigitavel)}</code>

Toque/segure no código para copiar e colar no app do banco.` : "⚠️ Linha digitável/código numérico não retornado pelo IXC nesta fatura.");
    return;
  }

  if (kind === "pix") {
    await sendTelegramMessage(context.chatId, pix ? `PIX copia-e-cola da fatura ${escapeHtml(fatura.id)}:

<code>${escapeHtml(pix)}</code>` : "⚠️ PIX copia-e-cola não retornado pelo IXC nesta fatura.");
    return;
  }

  if (kind === "qr") {
    if (!pix) {
      await sendTelegramMessage(context.chatId, fatura.pix_txid ? "⚠️ IXC retornou apenas TXID, sem PIX copia-e-cola. QR PIX não gerado por segurança." : "⚠️ PIX copia-e-cola não retornado pelo IXC. QR PIX indisponível.");
      return;
    }
    const qr = await generatePixQrCode(pix);
    if (!qr) {
      await sendTelegramMessage(context.chatId, "⚠️ Não consegui gerar o QR PIX com o payload retornado pelo IXC.");
      return;
    }
    await sendTelegramPhoto(context.chatId, qr, `PIX QR Code interno — fatura ${fatura.id}. Conferir antes de enviar ao cliente.`, "pix-qrcode.png");
    return;
  }

  if (kind === "pdf") {
    const pdfBase64 = await ixcApi.getBoletoArquivoBase64(fatura.id);
    if (!pdfBase64) {
      await sendTelegramMessage(context.chatId, "⚠️ PDF do boleto não retornado pelo IXC nesta fatura.");
      return;
    }

    const pdf = Buffer.from(pdfBase64, "base64");
    if (!pdf.length || !pdf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      await sendTelegramMessage(context.chatId, "⚠️ IXC retornou um arquivo inválido para o PDF do boleto.");
      return;
    }

    await sendTelegramDocument(
      context.chatId,
      pdf,
      `📄 PDF do boleto — fatura ${fatura.id}. Conferir antes de enviar ao cliente.`,
      `boleto-${fatura.id}.pdf`,
      "application/pdf"
    );
    return;
  }

  if (kind === "mensagem") {
    await sendTelegramMessage(context.chatId, formatMensagemClienteFaturaTelegram(fatura));
    return;
  }

  if (kind === "aprovar") {
    await replyAprovacaoEnvioManual(context, idCliente, fatura);
    return;
  }

  if (kind === "link") {
    await sendTelegramMessage(context.chatId, link ? `Link/PDF do boleto da fatura ${escapeHtml(fatura.id)}:

${escapeHtml(link)}` : "⚠️ Link/PDF do boleto não retornado pelo IXC nesta fatura.");
    return;
  }

  await sendTelegramMessage(context.chatId, "Item de fatura não reconhecido.");
}

function buildFaturaActionsKeyboard(idCliente: string, fatura: IxcFatura): ReplyMarkup | undefined {
  const linhaDigitavel = fatura.linha_digitavel || fatura.codigo_barras || fatura.boleto;
  const pix = fatura.pix_copia_cola || fatura.pix;
  const link = fatura.link || fatura.gateway_link;
  const row1: ReplyMarkup["inline_keyboard"][number] = [];
  const row2: ReplyMarkup["inline_keyboard"][number] = [];
  const row3: ReplyMarkup["inline_keyboard"][number] = [];

  if (linhaDigitavel) row1.push({ text: "📋 Copiar código boleto", callback_data: `fatura_item:linha:${idCliente}` });
  row1.push({ text: "📄 Ver PDF boleto", callback_data: `fatura_item:pdf:${idCliente}` });
  row2.push({ text: "📝 Copiar mensagem cliente", callback_data: `fatura_item:mensagem:${idCliente}` });
  if (pix) row2.push({ text: "🔳 QR PIX", callback_data: `fatura_item:qr:${idCliente}` });
  if (pix) row2.push({ text: "📋 PIX copia e cola", callback_data: `fatura_item:pix:${idCliente}` });
  row3.push({ text: "✅ Aprovar envio manual", callback_data: `fatura_item:aprovar:${idCliente}` });
  void link;

  const inline_keyboard = [row1, row2, row3].filter((row) => row.length > 0);
  return inline_keyboard.length ? { inline_keyboard } : undefined;
}

async function replyAprovacaoEnvioManual(context: AuditContext, idCliente: string, fatura: IxcFatura) {
  const approvals = await listFinanceApprovals();
  const existingApproved = approvals.find(
    (approval) => approval.status === "approved" && approval.idCliente === idCliente && approval.faturaId === fatura.id
  );

  if (existingApproved) {
    await sendTelegramMessage(
      context.chatId,
      [
        `✅ Envio manual já aprovado — fatura ${escapeHtml(fatura.id)}`,
        `Protocolo: ${escapeHtml(existingApproved.id.slice(0, 8))}`,
        "",
        "Nenhuma mensagem foi enviada automaticamente ao cliente.",
        "Use o botão 📝 Copiar mensagem cliente e envie manualmente após conferência final.",
      ].join("\n"),
      buildManualSentKeyboard(existingApproved.id)
    );
    return;
  }

  const createdBy = `telegram:${context.userId}`;
  const request = await createFinanceApproval({ idCliente, fatura, createdBy });
  const approval = await decideFinanceApproval({
    id: request.approval.id,
    action: "approve",
    note: "Aprovado pelo Telegram para envio manual. Sem disparo automático.",
    decidedBy: createdBy,
  });

  await auditLog(context, {
    action: "finance_approval_telegram",
    status: approval?.status || "approved",
    clientId: idCliente,
    faturaId: fatura.id,
    approvalId: request.approval.id,
  });

  await sendTelegramMessage(
    context.chatId,
    [
      `✅ Aprovado para envio manual — fatura ${escapeHtml(fatura.id)}`,
      `Protocolo: ${escapeHtml(request.approval.id.slice(0, 8))}`,
      `Cliente: ${escapeHtml(idCliente)}`,
      "",
      "Nenhuma mensagem foi enviada automaticamente ao cliente.",
      "Use o botão 📝 Copiar mensagem cliente e envie manualmente após conferir nome/cliente/fatura no IXC.",
      "Depois, toque em 📌 Marcar enviado manualmente para fechar o registro.",
    ].join("\n"),
    buildManualSentKeyboard(request.approval.id)
  );
}

async function replyRegistroEnvioManual(context: AuditContext, approvalId: string) {
  const result = await markFinanceApprovalManualSent({
    id: approvalId,
    note: "Operador informou envio manual pelo Telegram. Sem disparo automático.",
    decidedBy: `telegram:${context.userId}`,
  });

  if (!result) {
    await sendTelegramMessage(context.chatId, "⚠️ Aprovação não encontrada para registrar envio manual.");
    return;
  }

  if (result.blocked) {
    await sendTelegramMessage(context.chatId, "⚠️ Só é possível marcar como enviado manualmente após aprovação interna.");
    return;
  }

  await auditLog(context, {
    action: "finance_manual_sent_telegram",
    status: "manual_sent",
    clientId: result.approval.idCliente,
    faturaId: result.approval.faturaId,
    approvalId: result.approval.id,
  });

  await sendTelegramMessage(
    context.chatId,
    [
      `📌 Envio manual registrado — fatura ${escapeHtml(result.approval.faturaId)}`,
      `Protocolo: ${escapeHtml(result.approval.id.slice(0, 8))}`,
      `Cliente: ${escapeHtml(result.approval.idCliente)}`,
      "",
      "Registro fechado. Nenhuma mensagem foi enviada automaticamente pelo sistema.",
    ].join("\n")
  );
}

function buildManualSentKeyboard(approvalId: string): ReplyMarkup {
  return {
    inline_keyboard: [[{ text: "📌 Marcar enviado manualmente", callback_data: `approval_sent:${approvalId}` }]],
  };
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

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const { botToken } = getTelegramConfig();
  if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN ausente" };

  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ? truncate(text, 180) : undefined,
        show_alert: false,
      }),
    });
    return res.json();
  } catch (error) {
    console.error("telegram_answer_callback_failed", error);
    return { ok: false, error: "answer_callback_failed" };
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

export async function sendTelegramDocument(chatId: string | number, document: TelegramDocument, caption?: string, filename = "documento.pdf", contentType = "application/pdf") {
  const { botToken } = getTelegramConfig();
  if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN ausente" };

  const bytes = Buffer.isBuffer(document) ? document : Buffer.from(document);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("document", new Blob([arrayBuffer], { type: contentType }), filename);
  if (caption) form.set("caption", truncate(caption, 900));

  const res = await fetch(`${TELEGRAM_API}${botToken}/sendDocument`, {
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
    "/aprovacoes ou /ap — lista últimas aprovações/envios manuais financeiros",
    "/aprovacoes ID_CLIENTE|ID_FATURA|PROTOCOLO — filtra aprovações",
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

function formatMensagemClienteFaturaTelegram(fatura: IxcFatura) {
  const valor = escapeHtml(fatura.valor_aberto || fatura.valor || "-");
  const vencimento = escapeHtml(fatura.data_vencimento || "-");
  const linhaDigitavel = fatura.linha_digitavel || fatura.codigo_barras || fatura.boleto || "";

  return [
    `📝 Mensagem pronta para cliente — fatura ${escapeHtml(fatura.id)}`,
    "",
    "Olá! Tudo bem?",
    "Segue sua fatura em aberto:",
    "",
    `Valor: R$ ${valor}`,
    `Vencimento: ${vencimento}`,
    "",
    linhaDigitavel
      ? `Código do boleto / linha digitável:${"\n"}<code>${escapeHtml(linhaDigitavel)}</code>`
      : "Código do boleto: consultar PDF/anexo.",
    "",
    "Você também pode pagar pelo PDF do boleto enviado em anexo.",
    "Qualquer dúvida, estamos à disposição.",
    "GLC Internet",
    "",
    "⚠️ Rascunho interno. Confira cliente/fatura no IXC antes de enviar.",
  ].join("\n");
}

function formatFatura(fatura: IxcFatura) {
  const valor = fatura.valor_aberto || fatura.valor || "-";
  const partes = [
    `Fatura: ${escapeHtml(fatura.id)}`,
    `Valor: R$ ${escapeHtml(valor)} · Venc.: ${escapeHtml(fatura.data_vencimento || "-")}`,
    `Status: ${escapeHtml(fatura.status || fatura.status_cobranca || "-")}`,
  ];

  const linhaDigitavel = fatura.linha_digitavel || fatura.codigo_barras || fatura.boleto;
  const pix = fatura.pix_copia_cola || fatura.pix;

  if (linhaDigitavel) {
    partes.push(`Linha digitável: ${escapeHtml(linhaDigitavel)}`);
  } else {
    partes.push("Linha digitável: não retornada pelo IXC nesta consulta.");
  }

  if (pix) {
    partes.push("PIX: disponível nos botões abaixo.");
  } else if (fatura.pix_txid) {
    partes.push("PIX: IXC retornou apenas TXID, sem copia-e-cola. QR PIX não gerado por segurança.");
  } else {
    partes.push("PIX: copia-e-cola/QR não retornado pelo IXC nesta consulta.");
  }

  return partes.join("\n");
}

function statusLabelAprovacao(status: string) {
  if (status === "pending") return "pendente";
  if (status === "approved") return "aprovado";
  if (status === "manual_sent") return "enviado manualmente";
  if (status === "rejected") return "rejeitado";
  return status || "-";
}

function statusEmojiAprovacao(status: string) {
  if (status === "pending") return "⏳";
  if (status === "approved") return "✅";
  if (status === "manual_sent") return "📌";
  if (status === "rejected") return "❌";
  return "•";
}

function formatTelegramDate(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
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
