/**
 * Webhook IXC — recebe notificações de novos chamados
 * Configurar no IXC: Parâmetros → Notificações → URL: https://atende.glcinternet.com.br/api/ixc/webhook
 */
import { NextRequest, NextResponse } from "next/server";

// Notifica Gilson via WhatsApp quando chega chamado novo
async function notificarWhatsApp(mensagem: string) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const evolutionInstance = process.env.EVOLUTION_INSTANCE || "glc";
  const telefoneGilson = process.env.TELEFONE_GILSON;

  if (!evolutionUrl || !evolutionKey || !telefoneGilson) {
    console.log(`[WhatsApp] ${mensagem}`);
    return;
  }

  await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": evolutionKey || "" },
    body:    JSON.stringify({ number: telefoneGilson, text: mensagem }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // IXC pode enviar em diferentes formatos
    const chamado = body.chamado || body.oss || body;
    const assunto    = chamado.assunto      || chamado.subject    || "Novo chamado";
    const cliente    = chamado.nome_cliente || chamado.customer   || "Cliente";
    const prioridade = chamado.prioridade   || chamado.priority   || "M";
    const id         = chamado.id           || chamado.ticket_id  || "?";

    // LGPD: não registrar payload bruto do IXC, pois pode conter dados pessoais.
    console.log("[IXC Webhook] chamado recebido", { id, prioridade });

    const prioLabel: Record<string, string> = { A: "🔴 URGENTE", M: "🟡 Médio", B: "🟢 Baixo" };
    const emoji = prioLabel[prioridade] || "📋";

    const msg =
      `${emoji} *Novo Chamado GLC Internet*\n\n` +
      `📋 #${id} — ${assunto}\n` +
      `👤 Cliente: ${cliente}\n` +
      `⏰ Aberto agora\n\n` +
      `Responda aqui ou diga *"direciona pro Olindo"*`;

    await notificarWhatsApp(msg);

    return NextResponse.json({ ok: true, received: id });
  } catch (err) {
    console.error("[IXC Webhook]", err);
    return NextResponse.json({ ok: true }); // sempre 200 para o IXC
  }
}

// Verificação GET
export async function GET() {
  return NextResponse.json({ status: "webhook ativo", sistema: "GLC Atende" });
}
