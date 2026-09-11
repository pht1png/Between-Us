import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { findParticipantByResumeToken, getRoom } from "@/lib/rooms";

const DATA_URL_PREFIX = /^data:image\/(jpeg|png|webp);base64,/;

/**
 * Serves one participant's profile photo as real image bytes.
 *
 * Photos used to ride along inside every SSE roster snapshot as base64 data URLs, which made the
 * host broadcast ~2.9 MiB at 150 participants. Serving them here instead means each photo crosses
 * the wire once per viewer and is then cached by the browser.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pin: string; id: string }> },
) {
  const { pin, id } = await params;
  const room = getRoom(pin);
  if (!room) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องนี้" } },
      { status: 404 },
    );
  }

  // Readable by this room's host, or by any participant in it — players need their groupmates'
  // photos on the reveal screen. Anyone else gets nothing.
  const cookieStore = await cookies();
  const hostToken = cookieStore.get("host_token")?.value;
  const resumeToken = cookieStore.get("resume_token")?.value;
  const isHost = !!hostToken && room.hostToken === hostToken;
  const isMember = !!resumeToken && findParticipantByResumeToken(room, resumeToken) !== undefined;
  if (!isHost && !isMember) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "ไม่มีสิทธิ์เข้าถึงรูปนี้" } },
      { status: 401 },
    );
  }

  const participant = room.participants.get(id);
  const photo = participant?.photo;
  if (!photo) {
    return NextResponse.json(
      { error: { code: "PARTICIPANT_NOT_FOUND", message: "ไม่พบรูปของผู้เข้าร่วมคนนี้" } },
      { status: 404 },
    );
  }

  const match = DATA_URL_PREFIX.exec(photo);
  if (!match) {
    return NextResponse.json(
      { error: { code: "PARTICIPANT_NOT_FOUND", message: "ไม่พบรูปของผู้เข้าร่วมคนนี้" } },
      { status: 404 },
    );
  }

  const bytes = Buffer.from(photo.slice(match[0].length), "base64");
  // Hand back a real ArrayBuffer: a Node Buffer types as Uint8Array<ArrayBufferLike>, which isn't
  // assignable to BodyInit.
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": `image/${match[1]}`,
      "Content-Length": String(bytes.byteLength),
      // Immutable because the URL carries ?v=photoVersion — a re-upload changes the URL.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
