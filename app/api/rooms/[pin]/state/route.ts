import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildPlayerEvent } from "@/lib/bus";
import { findParticipantByResumeToken, getRoom } from "@/lib/rooms";

export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("resume_token")?.value;

  const room = getRoom(pin);
  if (!room) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องนี้" } },
      { status: 404 },
    );
  }

  const participant = token ? findParticipantByResumeToken(room, token) : undefined;
  if (!participant) {
    return NextResponse.json(
      { error: { code: "PARTICIPANT_NOT_FOUND", message: "ไม่พบข้อมูลผู้เข้าร่วมของคุณ" } },
      { status: 404 },
    );
  }

  return NextResponse.json(buildPlayerEvent(room, participant));
}
