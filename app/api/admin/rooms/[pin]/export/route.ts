import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildResultCsv } from "@/lib/export";
import { getRoom, isLoggedIn } from "@/lib/rooms";

/** `2026-09-28` — sorts correctly in a downloads folder, which is where these will pile up. */
function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Downloads a room's results as CSV. This is the only durable record of an event — rooms are held in
 * memory and freed by the reaper — so it is deliberately available for the whole life of the room,
 * not only at the moment the game ends.
 *
 * Unlike start/advance/end, this also requires `isLoggedIn(token)`: the response is a file of every
 * participant's name, bio, answers and free-text feedback, so a logged-out session's stale cookie
 * should not still be able to pull it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
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
  if (!token || !isLoggedIn(token) || room.hostToken !== token) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "คุณไม่มีสิทธิ์เข้าถึงห้องนี้" } },
      { status: 401 },
    );
  }

  return new Response(buildResultCsv(room), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="between-us-${pin}-${isoDate(Date.now())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
