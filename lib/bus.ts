import { computePairwiseCompatibility } from "@/lib/matching";
import { SECTION_LABELS_TH, sectionIdAt } from "@/lib/sections";
import type {
  ErrorCode,
  Group,
  GroupmateView,
  HostEvent,
  HostGroupView,
  HostParticipantView,
  Participant,
  PlayerEvent,
  Room,
} from "@/lib/types";

export type Role = "host" | "player";

export type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  role: Role;
  participantId?: string;
};

type BusStore = {
  subscribers: Map<string, Set<Subscriber>>; // pin -> subscribers
  pendingFlush: Map<string, ReturnType<typeof setTimeout>>; // pin -> trailing-flush timer
};

/** Roster-flush throttle window. At 150 participants a 100ms window meant up to 20 full-roster
 * broadcasts per second during an answer burst, purely to convey "one more person answered".
 * 500ms keeps the host's counter feeling live while cutting that traffic ~5x. */
const ROSTER_FLUSH_MS = 500;

const globalForBus = globalThis as unknown as { __betweenUsBus?: BusStore };

function getBusStore(): BusStore {
  if (!globalForBus.__betweenUsBus) {
    globalForBus.__betweenUsBus = { subscribers: new Map(), pendingFlush: new Map() };
  }
  return globalForBus.__betweenUsBus;
}

const encoder = new TextEncoder();

export function addSubscriber(pin: string, subscriber: Subscriber): void {
  const store = getBusStore();
  let set = store.subscribers.get(pin);
  if (!set) {
    set = new Set();
    store.subscribers.set(pin, set);
  }
  set.add(subscriber);
}

export function removeSubscriber(pin: string, subscriber: Subscriber): void {
  const store = getBusStore();
  const set = store.subscribers.get(pin);
  if (!set) return;
  set.delete(subscriber);
  if (set.size === 0) store.subscribers.delete(pin);
}

function formatSseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Named "fatal" rather than the spec's literal "error" — avoids colliding with EventSource's
 * own native connection-error event, which fires under that same name on the client. */
export function formatFatalEvent(code: ErrorCode, message: string): Uint8Array {
  return formatSseEvent("fatal", { error: { code, message } });
}

export function formatSnapshot(payload: HostEvent | PlayerEvent): Uint8Array {
  return formatSseEvent("snapshot", payload);
}

/** Immediate broadcast — used for phase transitions. Never queue this behind a roster batch. */
export function broadcastRoom(room: Room): void {
  const subs = getBusStore().subscribers.get(room.pin);
  if (!subs || subs.size === 0) return;

  let hostBytes: Uint8Array | null = null;
  // Computed once per broadcast rather than once per player: this is O(n), and doing it inside
  // the per-subscriber loop made every broadcast O(n²).
  const precomputed = room.status === "asking" ? { answeredCount: countAnswered(room) } : undefined;

  for (const sub of Array.from(subs)) {
    try {
      // Skip a subscriber whose queue is already over its byte budget — a slow consumer would
      // otherwise accumulate unbounded retained snapshots and take the process down with it.
      // Dropping one is lossless here: every snapshot is full state, so the next supersedes it.
      if (sub.controller.desiredSize !== null && sub.controller.desiredSize <= 0) continue;

      if (sub.role === "host") {
        if (!hostBytes) hostBytes = formatSnapshot(buildHostEvent(room));
        sub.controller.enqueue(hostBytes);
      } else if (sub.participantId) {
        const participant = room.participants.get(sub.participantId);
        if (!participant) continue;
        sub.controller.enqueue(formatSnapshot(buildPlayerEvent(room, participant, precomputed)));
      }
    } catch {
      // controller.enqueue() throws on a cancelled stream — drop it, never let one dead
      // socket unwind the loop and starve the rest of the subscribers.
      subs.delete(sub);
    }
  }
}

/** Throttled, leading+trailing — for joins and answer-count ticks, not phase transitions. */
export function scheduleRosterFlush(room: Room): void {
  const store = getBusStore();
  if (store.pendingFlush.has(room.pin)) return; // trailing flush already scheduled
  broadcastRoom(room); // leading edge
  const timer = setTimeout(() => {
    store.pendingFlush.delete(room.pin);
    broadcastRoom(room);
  }, ROSTER_FLUSH_MS);
  store.pendingFlush.set(room.pin, timer);
}

// ---- View builders ----
// These only depend on lib/types.ts + lib/matching.ts (a pure function library), never on
// lib/rooms.ts — rooms.ts calls broadcastRoom() from its internal auto-advance timer, so the
// dependency must stay one-directional.

/** Photos are served by URL, never embedded. A base64 data URL is ~20KB, so embedding them put
 * ~2.9 MiB into every host roster broadcast at 150 participants; as a URL it's ~60 bytes and the
 * browser caches the image itself. `?v=` busts that cache when a participant re-uploads. */
function photoUrlFor(pin: string, p: Participant): string | null {
  return p.photo ? `/api/rooms/${pin}/participants/${p.id}/photo?v=${p.photoVersion}` : null;
}

function countAnswered(room: Room): number {
  let count = 0;
  for (const p of room.participants.values()) {
    if (p.answers[room.currentIndex] != null) count++;
  }
  return count;
}

function toHostParticipantView(room: Room) {
  return (p: Participant): HostParticipantView => ({
    id: p.id,
    name: p.name,
    bio: p.bio,
    sex: p.sex,
    photoUrl: photoUrlFor(room.pin, p),
    answered: p.answers[room.currentIndex] != null,
  });
}

function computeDistribution(room: Room): number[] {
  const buckets = Array(10).fill(0) as number[];
  for (const p of room.participants.values()) {
    const v = p.answers[room.currentIndex];
    if (v != null && v >= 1 && v <= 10) buckets[v - 1]++;
  }
  return buckets;
}

function buildHostGroups(room: Room): HostGroupView[] {
  if (!room.matchResult) return [];
  return room.matchResult.groups.map(
    (group: Group): HostGroupView => ({
      memberNames: group.memberIds.map((id) => room.participants.get(id)?.name ?? "?"),
      formedVia: group.formedVia,
    }),
  );
}

function reasonText(reasonSectionIndex: number | null): string {
  if (reasonSectionIndex == null) return "คุณทั้งคู่มีความคล้ายกันในหลายด้าน";
  const id = sectionIdAt(reasonSectionIndex);
  if (!id) return "คุณทั้งคู่มีความคล้ายกันในหลายด้าน";
  return `คุณทั้งคู่ตอบหมวด "${SECTION_LABELS_TH[id]}" ใกล้เคียงกันมาก`;
}

function buildRevealForParticipant(room: Room, participantId: string): { status: "matched"; groupmates: GroupmateView[] } | { status: "unmatched" } {
  const matchResult = room.matchResult;
  const sectionScores = room.sectionScores;
  if (!matchResult || !sectionScores) return { status: "unmatched" };

  const group = matchResult.groups.find((g) => g.memberIds.includes(participantId));
  if (!group) return { status: "unmatched" };

  const myScores = sectionScores.get(participantId);
  if (!myScores) return { status: "unmatched" };

  const groupmates: GroupmateView[] = [];
  for (const memberId of group.memberIds) {
    if (memberId === participantId) continue;
    const mate = room.participants.get(memberId);
    const mateScores = sectionScores.get(memberId);
    if (!mate || !mateScores) continue;
    const pairwise = computePairwiseCompatibility(myScores, mateScores);
    if (pairwise.compatibility == null) continue; // shouldn't happen for a formed group, but never fabricate a number
    groupmates.push({
      id: mate.id,
      name: mate.name,
      bio: mate.bio,
      photoUrl: photoUrlFor(room.pin, mate),
      compatibility: Math.round(pairwise.compatibility),
      reason: reasonText(pairwise.reasonSectionIndex),
    });
  }

  if (groupmates.length === 0) return { status: "unmatched" };
  return { status: "matched", groupmates };
}

export function buildHostEvent(room: Room): HostEvent {
  const serverNow = Date.now();
  const participants = Array.from(room.participants.values()).map(toHostParticipantView(room));

  if (room.status === "lobby") {
    return { type: "lobby", serverNow, pin: room.pin, participants };
  }
  if (room.status === "asking") {
    const question = room.questions[room.currentIndex];
    return {
      type: "asking",
      serverNow,
      pin: room.pin,
      currentIndex: room.currentIndex,
      totalQuestions: room.questions.length,
      question: { text: question.text, duration: question.duration },
      endsAt: room.questionEndsAt ?? serverNow,
      participants,
      distribution: computeDistribution(room),
    };
  }
  // "reveal" and "ended" share one host-facing view — admin never distinguishes them visually.
  return { type: "ended", serverNow, pin: room.pin, participants, groups: buildHostGroups(room) };
}

/** `precomputed.answeredCount` lets broadcastRoom compute the roster-wide count once instead of
 * once per subscriber. Omitted by the one-off callers (state route, initial stream snapshot). */
export function buildPlayerEvent(
  room: Room,
  participant: Participant,
  precomputed?: { answeredCount: number },
): PlayerEvent {
  const serverNow = Date.now();

  if (room.status === "lobby") {
    return { type: "lobby", serverNow, pin: room.pin };
  }

  if (room.status === "asking") {
    const question = room.questions[room.currentIndex];
    const answeredCount = precomputed?.answeredCount ?? countAnswered(room);
    return {
      type: "asking",
      serverNow,
      question: { index: room.currentIndex, total: room.questions.length, text: question.text },
      endsAt: room.questionEndsAt ?? serverNow,
      yourAnswer: participant.answers[room.currentIndex] ?? null,
      answeredCount,
      totalParticipants: room.participants.size,
    };
  }

  return { type: "reveal", serverNow, reveal: buildRevealForParticipant(room, participant.id) };
}
