import { cookies } from "next/headers";

import { addSubscriber, buildHostEvent, buildPlayerEvent, formatFatalEvent, formatSnapshot, removeSubscriber } from "@/lib/bus";
import type { Subscriber } from "@/lib/bus";
import { findParticipantByResumeToken, getRoom } from "@/lib/rooms";

const HEARTBEAT_MS = 15_000;
const SELF_CAP_MS = 8 * 60 * 1000; // one EventSource reconnect every 8 minutes is cheap and bounds any leaked stream

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function GET(request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const cookieStore = await cookies();
  const hostToken = cookieStore.get("host_token")?.value;
  const resumeToken = cookieStore.get("resume_token")?.value;

  const room = getRoom(pin);
  if (!room) {
    return new Response(decoder.decode(formatFatalEvent("ROOM_NOT_FOUND", "ไม่พบห้องนี้")), {
      status: 404,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const isHost = !!hostToken && room.hostToken === hostToken;
  const participant = !isHost && resumeToken ? findParticipantByResumeToken(room, resumeToken) : undefined;

  if (!isHost && !participant) {
    return new Response(decoder.decode(formatFatalEvent("PARTICIPANT_NOT_FOUND", "ไม่พบข้อมูลผู้เข้าร่วมของคุณ")), {
      status: 404,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let selfCap: ReturnType<typeof setTimeout> | undefined;
  let subscriber: Subscriber | undefined;

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(encoder.encode("retry: 2000\n\n"));

        subscriber = isHost
          ? { controller, role: "host" }
          : { controller, role: "player", participantId: participant!.id };
        addSubscriber(pin, subscriber);

        controller.enqueue(formatSnapshot(isHost ? buildHostEvent(room) : buildPlayerEvent(room, participant!)));

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
          } catch {
            cleanup();
          }
        }, HEARTBEAT_MS);

        selfCap = setTimeout(() => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }, SELF_CAP_MS);

        function cleanup() {
          if (heartbeat) clearInterval(heartbeat);
          if (selfCap) clearTimeout(selfCap);
          if (subscriber) removeSubscriber(pin, subscriber);
        }

        request.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        if (selfCap) clearTimeout(selfCap);
        if (subscriber) removeSubscriber(pin, subscriber);
      },
    },
    // Byte-based, so `desiredSize` reflects queued BYTES. The default CountQueuingStrategy counts
    // chunks, which would make the backpressure check in broadcastRoom meaningless — and leaves
    // the queue effectively unbounded, so one slow consumer could retain snapshots until the
    // process runs out of heap.
    new ByteLengthQueuingStrategy({ highWaterMark: 1_000_000 }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
