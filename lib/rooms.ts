import { randomInt } from "node:crypto";

import { broadcastRoom, closeRoomStreams } from "@/lib/bus";
import { computeGroups, computeSectionScores } from "@/lib/matching";
import type { SectionId } from "@/lib/sections";
import type { DesiredSex, ErrorCode, Participant, Room, Sex } from "@/lib/types";

const ROOM_CAPACITY = 200;

// ---- Retention ----
// Rooms are held in memory with every answer and both photo sizes per participant (~35 MB at 150
// people), and nothing used to free them — so memory grew monotonically across events. These two
// windows are the whole policy; raise them freely, they are not a privacy claim.
//
// The hard rule they sit under: the CSV export is the only durable record of an event, so a room
// must stay alive long enough for the host to download it. Shortening ENDED_ROOM_TTL_MS is how you
// would silently start destroying results.

/** From the moment the game ends. This is the backstop for a host who never presses the ended
 * screen's "เสร็จสิ้นและออกจากระบบ" — that button ends and logs out but does not free the room, so
 * this window is also how long players stay on their reveal screen after a host has left. One hour
 * is a deliberate product choice: it covers stragglers and an export, and nothing lingers overnight. */
const ENDED_ROOM_TTL_MS = 60 * 60 * 1000;

/** Only governs a room still stuck in `"lobby"` — the host closed the tab before ever starting it.
 * Longer than the ended window on the chance it's still genuinely being set up. Deliberately does
 * NOT apply once a room reaches "asking": that room is self-bounding (the sum of its remaining
 * question durations is a hard, computable upper bound on how long it can run), so it will reach
 * "ended" — and ENDED_ROOM_TTL_MS — on its own. Applying this TTL to an "asking" room was a real
 * bug: it measured from `createdAt`, not from idleness, so a room a host set up hours before an
 * event could be swept mid-game, out from under an active quiz, the moment 6h had passed since
 * creation — regardless of whether the game was running. The "or created a replacement" case this
 * comment used to also cover is already handled by createRoom's own immediate endGame() call on
 * the old room, which gives it an `endedAt` and moves it to the ended branch instead. */
const ABANDONED_ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

type Store = {
  rooms: Map<string, Room>;
  loggedInTokens: Set<string>;
  // A host token stays valid across sequential rooms (create, end, create again) within one
  // session — so "which room is this token's *current* one" needs its own mapping. Without
  // this, looking a token up against every room it ever touched resolves to whichever room
  // happens to come first in Map iteration order, not the most recent one.
  activeRoomByToken: Map<string, string>; // hostToken -> pin
  timers: Map<string, ReturnType<typeof setTimeout>>;
};

const globalForRooms = globalThis as unknown as { __betweenUsRooms?: Store };

function getStore(): Store {
  if (!globalForRooms.__betweenUsRooms) {
    globalForRooms.__betweenUsRooms = {
      rooms: new Map(),
      loggedInTokens: new Set(),
      activeRoomByToken: new Map(),
      timers: new Map(),
    };
    armSweep();
  }
  return globalForRooms.__betweenUsRooms;
}

/** Armed once, alongside the store it sweeps. One global interval rather than a timer per room: the
 * same pass has to cover both ended rooms and ones that were abandoned without ever ending. */
function armSweep(): void {
  const timer: unknown = setInterval(() => {
    sweepRooms();
  }, SWEEP_INTERVAL_MS);
  // Node hands back a Timeout, other runtimes a number. Unref'd where possible so a ten-minute
  // interval can never hold a vitest run or a shutdown open.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

/** Drops a room and everything still pointing at it. Missing any of these would free the Room object
 * while leaking the thing that referenced it. */
function freeRoom(pin: string): void {
  const store = getStore();
  clearRoomTimer(pin); // a pending auto-advance would otherwise hold the room alive until it fires
  closeRoomStreams(pin);
  store.rooms.delete(pin);
  for (const [token, activePin] of Array.from(store.activeRoomByToken)) {
    if (activePin === pin) store.activeRoomByToken.delete(token);
  }
}

/**
 * Frees every room past its retention window. Returns how many went.
 *
 * `now` is injectable for the same reason `computeGroups` takes an injectable `rng`: so tests can
 * assert the policy without waiting an hour.
 */
export function sweepRooms(now: number = Date.now()): number {
  const store = getStore();
  let freed = 0;
  for (const room of Array.from(store.rooms.values())) {
    if (room.endedAt !== null) {
      if (now > room.endedAt + ENDED_ROOM_TTL_MS) {
        freeRoom(room.pin);
        freed++;
      }
    } else if (room.status === "lobby" && now > room.createdAt + ABANDONED_ROOM_TTL_MS) {
      // Only "lobby" — an "asking" room is never abandoned in this sense, see ABANDONED_ROOM_TTL_MS.
      freeRoom(room.pin);
      freed++;
    }
  }
  return freed;
}

// ---- Auth ----
// One shared HOST_SECRET, no accounts. Login mints a random session token — the raw secret
// itself never travels in a cookie, so logout can actually revoke access.

export function login(password: string): string | null {
  if (!process.env.HOST_SECRET || password !== process.env.HOST_SECRET) return null;
  const token = crypto.randomUUID();
  getStore().loggedInTokens.add(token);
  return token;
}

export function logout(token: string): void {
  getStore().loggedInTokens.delete(token);
}

export function isLoggedIn(token: string): boolean {
  return getStore().loggedInTokens.has(token);
}

/**
 * The one definition of "this request is the host of this room": a live session that also owns it.
 * Every host-authorised route goes through here so they cannot drift apart.
 *
 * They used to — only the export route checked the session, while start/advance/end, the host
 * stream, the photo route and rooms/current compared `room.hostToken` alone. A token copied before
 * logout therefore kept working on all of them (roster, feedback, driving the game) until the room
 * was swept. Both halves matter: the session check makes logout actually revoke, and the ownership
 * check keeps one host's valid session from driving another host's room.
 */
export function isRoomHost(room: Room, token: string | undefined): boolean {
  return !!token && room.hostToken === token && isLoggedIn(token);
}

// ---- Lookup ----

export function getRoom(pin: string): Room | undefined {
  return getStore().rooms.get(pin);
}

export function findRoomByHostToken(token: string): Room | undefined {
  // A revoked session must not resolve a room, or a copied token could still read it via
  // GET /api/admin/rooms/current after the host logged out.
  if (!isLoggedIn(token)) return undefined;
  const pin = getStore().activeRoomByToken.get(token);
  return pin ? getStore().rooms.get(pin) : undefined;
}

export function findParticipantByResumeToken(room: Room, token: string): Participant | undefined {
  for (const participant of room.participants.values()) {
    if (participant.resumeToken === token) return participant;
  }
  return undefined;
}

export function getRoomCount(): number {
  return getStore().rooms.size;
}

// ---- Room creation ----

function generatePin(): string {
  return String(randomInt(100000, 1000000));
}

function generateUniquePin(preferred?: string): string {
  const store = getStore();
  if (preferred && /^\d{6}$/.test(preferred) && !store.rooms.has(preferred)) {
    return preferred;
  }
  let pin = generatePin();
  let attempts = 0;
  while (store.rooms.has(pin) && attempts < 20) {
    pin = generatePin();
    attempts++;
  }
  return pin;
}

/** `preferredPin` is how crash recovery works — see the admin restore flow — rather than a
 * separate /restore route: reuse the same PIN the host already displayed if it's free. */
export function createRoom(
  hostToken: string,
  questions: { text: string; duration: number; section: SectionId }[],
  preferredPin?: string,
): Room {
  const store = getStore();

  // A host creating a room abandons whichever one they had before. End it — and tell its players, so
  // they land on their reveal instead of sitting on a question forever — rather than leaving a second
  // room auto-advancing in the background. It stays resident for the reaper on purpose: an accidental
  // re-create must not destroy a live event's results before anyone has exported them.
  const previousPin = store.activeRoomByToken.get(hostToken);
  const previous = previousPin ? store.rooms.get(previousPin) : undefined;
  if (previous && previous.status !== "ended") {
    endGame(previous);
    broadcastRoom(previous);
  }

  const pin = generateUniquePin(preferredPin);
  const room: Room = {
    pin,
    hostToken,
    status: "lobby",
    questions: questions.map((q) => ({
      id: crypto.randomUUID(),
      text: q.text,
      duration: q.duration,
      section: q.section,
    })),
    currentIndex: 0,
    questionEndsAt: null,
    generation: 0,
    participants: new Map(),
    sectionScores: null,
    matchResult: null,
    createdAt: Date.now(),
    endedAt: null,
  };
  store.rooms.set(pin, room);
  store.activeRoomByToken.set(hostToken, pin);
  return room;
}

// ---- Joining ----

export function joinRoom(
  room: Room,
  profile: {
    name: string;
    bio: string;
    sex: Sex;
    desiredSex: DesiredSex;
    photo: string | null;
    photoThumb: string | null;
  },
  existingParticipant?: Participant,
):
  | { participant: Participant; resumeToken: string }
  | { error: { code: ErrorCode; message: string }; status: number } {
  if (existingParticipant) {
    // Two tabs (or a rejoin) sharing the same resume_token update the same record —
    // never mint a duplicate participant for one browser session.
    existingParticipant.name = profile.name;
    existingParticipant.bio = profile.bio;
    existingParticipant.sex = profile.sex;
    existingParticipant.desiredSex = profile.desiredSex;
    // Bump only on an actual change — the photo URL carries this as a cache-buster, so an
    // unconditional bump would re-download every photo on every ordinary reconnect. Both sizes
    // are always regenerated together from one source image, so checking `photo` alone covers it.
    if (existingParticipant.photo !== profile.photo) {
      existingParticipant.photo = profile.photo;
      existingParticipant.photoThumb = profile.photoThumb;
      existingParticipant.photoVersion += 1;
    }
    existingParticipant.lastSeen = Date.now();
    return { participant: existingParticipant, resumeToken: existingParticipant.resumeToken };
  }

  if (room.participants.size >= ROOM_CAPACITY) {
    return { error: { code: "ROOM_FULL", message: "ห้องเต็มแล้ว" }, status: 403 };
  }

  const participant: Participant = {
    id: crypto.randomUUID(),
    resumeToken: crypto.randomUUID(),
    name: profile.name,
    bio: profile.bio,
    sex: profile.sex,
    desiredSex: profile.desiredSex,
    photo: profile.photo,
    photoThumb: profile.photoThumb,
    photoVersion: 0,
    answers: Array(room.questions.length).fill(null),
    feedback: null,
    lastSeen: Date.now(),
  };
  room.participants.set(participant.id, participant);
  return { participant, resumeToken: participant.resumeToken };
}

// ---- Answers ----

export function submitAnswer(
  room: Room,
  participant: Participant,
  questionIndex: number,
  value: number,
): { ok: true } | { error: { code: ErrorCode; message: string }; status: number } {
  if (room.status !== "asking" || questionIndex !== room.currentIndex) {
    return { error: { code: "QUESTION_CLOSED", message: "คำถามนี้ปิดรับคำตอบแล้ว" }, status: 410 };
  }
  if (room.questionEndsAt !== null && Date.now() > room.questionEndsAt + 1500) {
    return { error: { code: "QUESTION_CLOSED", message: "หมดเวลาตอบคำถามนี้แล้ว" }, status: 410 };
  }
  // Indexed set, never appended — a second tab sharing the same resume_token just overwrites,
  // so it can never double-count one participant's weight in the matching.
  participant.answers[questionIndex] = value;
  participant.lastSeen = Date.now();
  return { ok: true };
}

// ---- Feedback ----

/**
 * Free-text feedback from the reveal screen. Deliberately ungated by room status or question
 * timers, unlike `submitAnswer` — this isn't tied to a question index or a phase window, it's a
 * note left on the way out. Resubmitting overwrites; an empty string clears it.
 */
export function submitFeedback(participant: Participant, feedback: string): { ok: true } {
  const trimmed = feedback.trim();
  participant.feedback = trimmed.length > 0 ? trimmed : null;
  participant.lastSeen = Date.now();
  return { ok: true };
}

// ---- Phase transitions ----
// Invariant: everything below is fully synchronous — no `await` anywhere in this section.
// That's what makes "two triggers land at the same instant" a non-issue: only one of the call
// sites can ever be mid-execution, and the generation counter makes the loser's callback a no-op
// instead of a double-advance.
//
// There are three trigger sources for an advance, all funnelling through advanceQuestion():
//   1. the per-question auto-advance timer (scheduleAutoAdvance),
//   2. advanceIfComplete(), the instant the last participant answers (the answers route),
//   3. the dormant host-only POST /api/admin/rooms/[pin]/advance escape hatch.

function clearRoomTimer(pin: string): void {
  const store = getStore();
  const timer = store.timers.get(pin);
  if (timer) {
    clearTimeout(timer);
    store.timers.delete(pin);
  }
}

function scheduleAutoAdvance(room: Room): void {
  clearRoomTimer(room.pin);
  const duration = room.questions[room.currentIndex].duration;
  const generation = room.generation;
  room.questionEndsAt = Date.now() + duration * 1000;
  const timer = setTimeout(
    () => {
      if (room.generation !== generation) return; // stale — a manual advance/end already won
      advanceQuestion(room);
      broadcastRoom(room);
    },
    duration * 1000 + 1500, // matches the answer-submission grace window in submitAnswer
  );
  getStore().timers.set(room.pin, timer);
}

export function startRoom(room: Room): void {
  room.generation++;
  room.status = "asking";
  room.currentIndex = 0;
  scheduleAutoAdvance(room);
}

/** Computes section scores + groups exactly once — idempotent by construction, not by luck.
 * Reached from the auto-advance timer, from advanceIfComplete once everyone has answered the last
 * question, and from the end/create routes; whichever gets here first (they can't race, Node's
 * event loop is single-threaded) does the real work. */
function endGame(room: Room): void {
  if (room.status === "ended") return;
  clearRoomTimer(room.pin);
  room.generation++;
  room.status = "ended";
  room.questionEndsAt = null;
  room.endedAt = Date.now(); // starts the retention clock — see ENDED_ROOM_TTL_MS

  if (room.matchResult === null) {
    const sectionScores = new Map(
      Array.from(room.participants.values()).map((p) => [p.id, computeSectionScores(p.answers, room.questions)]),
    );
    room.sectionScores = sectionScores;
    room.matchResult = computeGroups(
      Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        sex: p.sex,
        desiredSex: p.desiredSex,
        sectionScores: sectionScores.get(p.id)!,
      })),
    );
  }
}

export function advanceQuestion(room: Room): void {
  clearRoomTimer(room.pin);
  if (room.currentIndex + 1 < room.questions.length) {
    room.generation++;
    room.currentIndex++;
    scheduleAutoAdvance(room);
  } else {
    endGame(room);
  }
}

export function endRoom(room: Room): void {
  endGame(room);
}

function everyoneHasAnswered(room: Room): boolean {
  // Unreachable through the answers route (it only gets here with a resolved participant, so the
  // room has at least one), but an empty room must never read as "everyone's done".
  if (room.participants.size === 0) return false;
  for (const participant of room.participants.values()) {
    if (participant.answers[room.currentIndex] == null) return false;
  }
  return true;
}

/**
 * Moves the room on the instant the last participant answers, instead of waiting out the rest of the
 * question's duration. Called after every successful answer submission.
 *
 * This only *accelerates* `scheduleAutoAdvance`'s timer — it never replaces it. The timer stays
 * armed and remains the only thing that rescues a room from someone who never submits at all (a
 * closed or backgrounded tab runs no client JS, so nothing auto-submits on their behalf).
 *
 * Reuses `advanceQuestion` verbatim, so running off the last question falls through to `endGame`
 * via exactly the same path the timer already takes — nothing here special-cases the end of a game.
 * `advanceQuestion`'s own `clearRoomTimer` genuinely cancels the superseded timeout rather than
 * leaving it to fire and no-op, so there's no window where both triggers can advance.
 *
 * Both the participant count and each answer are read live rather than snapshotted at question
 * start, which is what makes a mid-question joiner correctly hold the room back until they answer
 * too. Returns whether it advanced, so the caller can skip a redundant broadcast.
 */
export function advanceIfComplete(room: Room): boolean {
  if (room.status !== "asking") return false;
  if (!everyoneHasAnswered(room)) return false;
  advanceQuestion(room);
  broadcastRoom(room);
  return true;
}
