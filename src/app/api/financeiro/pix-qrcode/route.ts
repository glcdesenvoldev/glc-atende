import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

const MAX_PIX_PAYLOAD_LENGTH = 4096;

export async function GET(request: NextRequest) {
  const payload = request.nextUrl.searchParams.get("payload") || "";

  if (!payload.trim()) {
    return NextResponse.json({ ok: false, error: "Payload PIX não informado." }, { status: 400 });
  }

  if (payload.length > MAX_PIX_PAYLOAD_LENGTH) {
    return NextResponse.json({ ok: false, error: "Payload PIX acima do limite seguro." }, { status: 400 });
  }

  const png = await QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 6,
  });

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
