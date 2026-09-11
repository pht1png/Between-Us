import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { scheduleRosterFlush } from "@/lib/bus";
import { findParticipantByResumeToken, getRoom, joinRoom } from "@/lib/rooms";
import { joinSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ pin: string }> }) {
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

  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "ข้อมูลไม่ถูกต้อง" } },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const existingToken = cookieStore.get("resume_token")?.value;
  const existingParticipant = existingToken ? findParticipantByResumeToken(room, existingToken) : undefined;

  const result = joinRoom(room, parsed.data, existingParticipant);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  cookieStore.set("resume_token", result.resumeToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  });

  scheduleRosterFlush(room);

  return NextResponse.json({ id: result.participant.id }, { status: 201 });
}
