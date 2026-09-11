import { NextResponse } from "next/server";

import { getRoom } from "@/lib/rooms";

export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const room = getRoom(pin);

  if (!room) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องนี้" } },
      { status: 404 },
    );
  }
  if (room.status === "ended") {
    return NextResponse.json(
      { error: { code: "ROOM_ENDED", message: "ห้องนี้จบไปแล้ว" } },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: room.status });
}
