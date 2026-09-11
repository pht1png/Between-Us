import { NextResponse } from "next/server";

import { getRoomCount } from "@/lib/rooms";

export async function GET() {
  return NextResponse.json({ ok: true, uptimeMs: Math.round(process.uptime() * 1000), rooms: getRoomCount() });
}
