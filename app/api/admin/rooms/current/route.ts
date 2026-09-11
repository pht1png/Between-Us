import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildHostEvent } from "@/lib/bus";
import { findRoomByHostToken } from "@/lib/rooms";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("host_token")?.value;
  const room = token ? findRoomByHostToken(token) : undefined;

  if (!room) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องที่กำลังใช้งาน" } },
      { status: 404 },
    );
  }

  return NextResponse.json(buildHostEvent(room));
}
