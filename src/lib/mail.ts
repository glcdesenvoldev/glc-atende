import nodemailer from "nodemailer";

export async function sendPasswordResetEmail(to: string, resetUrl: string, expiresMinutes: number) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass || !from) {
    throw new Error("SMTP não configurado: SMTP_HOST, SMTP_USER, SMTP_PASSWORD e SMTP_FROM são obrigatórios");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "true") !== "false",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to,
    subject: "Redefinição de senha — GLC Atende",
    text: [
      "Recebemos uma solicitação para redefinir a senha do GLC Atende.",
      "",
      `Acesse este link em até ${expiresMinutes} minutos:`,
      resetUrl,
      "",
      "Se você não solicitou, ignore este e-mail.",
    ].join("\n"),
    html: [
      "<p>Recebemos uma solicitação para redefinir a senha do <strong>GLC Atende</strong>.</p>",
      `<p>Acesse este link em até <strong>${expiresMinutes} minutos</strong>:</p>`,
      `<p><a href=\"${escapeHtml(resetUrl)}\">Redefinir senha</a></p>`,
      "<p>Se você não solicitou, ignore este e-mail.</p>",
    ].join(""),
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
