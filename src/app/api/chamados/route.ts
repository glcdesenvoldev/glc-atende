import { NextResponse } from "next/server";
import { ixcApi } from "@/lib/ixc";
export async function GET() {
  const data = await ixcApi.getChamados();
  return NextResponse.json(data);
}
