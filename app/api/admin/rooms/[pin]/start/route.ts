import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { broadcastRoom } from "@/lib/bus";
import { getRoom, startRoom } from "@/lib/rooms";

export async function POST(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("host_token")?.value;

  const room = getRoom(pin);
  if (!room) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องนี้" } },
      { status: 404 },
    );
  }
  if (!token || room.hostToken !== token) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "คุณไม่มีสิทธิ์เข้าถึงห้องนี้" } },
      { status: 401 },
    );
  }
  if (room.status !== "lobby") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "ห้องนี้เริ่มไปแล้ว" } },
      { status: 409 },
    );
  }
  if (room.participants.size === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "ยังไม่มีผู้เข้าร่วม" } },
      { status: 409 },
    );
  }

  startRoom(room);
  broadcastRoom(room);

  return NextResponse.json({ ok: true });
}
