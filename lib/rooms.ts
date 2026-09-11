import { randomInt } from "node:crypto";

import { broadcastRoom } from "@/lib/bus";
import { computeGroups, computeSectionScores } from "@/lib/matching";
import type { SectionId } from "@/lib/sections";
import type { ErrorCode, Participant, Room, Sex } from "@/lib/types";

const ROOM_CAPACITY = 200;

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
  }
  return globalForRooms.__betweenUsRooms;
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

// ---- Lookup ----

export function getRoom(pin: string): Room | undefined {
  return getStore().rooms.get(pin);
}

export function findRoomByHostToken(token: string): Room | undefined {
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
  };
  store.rooms.set(pin, room);
  store.activeRoomByToken.set(hostToken, pin);
  return room;
}

// ---- Joining ----

export function joinRoom(
  room: Room,
  profile: { name: string; bio: string; sex: Sex; photo: string | null },
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
    // Bump only on an actual change — the photo URL carries this as a cache-buster, so an
    // unconditional bump would re-download every photo on every ordinary reconnect.
    if (existingParticipant.photo !== profile.photo) {
      existingParticipant.photo = profile.photo;
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
    photo: profile.photo,
    photoVersion: 0,
    answers: Array(room.questions.length).fill(null),
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

// ---- Phase transitions ----
// Invariant: everything below is fully synchronous — no `await` anywhere in this section.
// That's what makes "the host clicks Next at the exact instant the timer fires" a non-issue:
// only one of the two call sites can ever be mid-execution, and the generation counter makes
// the loser's callback a no-op instead of a double-advance.

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
 * Called from both a host-click route and the internal auto-advance timer; whichever gets
 * here first (they can't race, Node's event loop is single-threaded) does the real work. */
function endGame(room: Room): void {
  if (room.status === "ended") return;
  clearRoomTimer(room.pin);
  room.generation++;
  room.status = "ended";
  room.questionEndsAt = null;

  if (room.matchResult === null) {
    const sectionScores = new Map(
      Array.from(room.participants.values()).map((p) => [p.id, computeSectionScores(p.answers, room.questions)]),
    );
    room.sectionScores = sectionScores;
    room.matchResult = computeGroups(
      Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        sex: p.sex,
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
