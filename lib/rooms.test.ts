import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  advanceQuestion,
  createRoom,
  endRoom,
  findParticipantByResumeToken,
  getRoom,
  joinRoom,
  startRoom,
  submitAnswer,
} from "@/lib/rooms";
import { SECTION_IDS, type SectionId } from "@/lib/sections";
import type { Participant, Room } from "@/lib/types";

/**
 * Covers the server half of the answer-submission flow end to end — the path that produces the
 * stored answers everything downstream depends on. Matching "not working" is indistinguishable
 * from "no answers were ever stored", so these assertions anchor the difference.
 */

function questions(perSection = 1) {
  return SECTION_IDS.flatMap((section: SectionId) =>
    Array.from({ length: perSection }, (_, i) => ({
      text: `คำถาม ${section} ${i + 1}`,
      duration: 20,
      section,
    })),
  );
}

let rooms: Room[] = [];

function makeRoom(perSection = 1) {
  const room = createRoom(`host-${crypto.randomUUID()}`, questions(perSection));
  rooms.push(room);
  return room;
}

function join(room: Room, name: string, sex: "male" | "female") {
  const result = joinRoom(room, { name, bio: `${name} bio`, sex, photo: null });
  if ("error" in result) throw new Error(`join failed: ${result.error.code}`);
  return result.participant;
}

/** Answer every question with the same value. */
function answerAll(room: Room, participant: Participant, value: number) {
  for (let i = 0; i < room.questions.length; i++) {
    room.currentIndex = i;
    const result = submitAnswer(room, participant, i, value);
    if ("error" in result) throw new Error(`submit failed at ${i}: ${result.error.code}`);
  }
}

beforeEach(() => {
  rooms = [];
});

afterEach(() => {
  // startRoom/advanceQuestion arm real timers; ending each room clears them so vitest can exit.
  for (const room of rooms) endRoom(room);
});

describe("createRoom", () => {
  it("stores each question's section verbatim and mints ids", () => {
    const room = makeRoom();
    expect(room.questions.map((q) => q.section)).toEqual([...SECTION_IDS]);
    expect(new Set(room.questions.map((q) => q.id)).size).toBe(room.questions.length);
    expect(getRoom(room.pin)).toBe(room);
  });
});

describe("joinRoom", () => {
  it("sizes the answers array to the question count, pre-filled with nulls", () => {
    const room = makeRoom(2);
    const p = join(room, "Alex", "male");
    expect(p.answers).toHaveLength(room.questions.length);
    expect(p.answers.every((a) => a === null)).toBe(true);
  });

  it("a rejoin with the same resume token updates in place instead of duplicating", () => {
    const room = makeRoom();
    const first = join(room, "Alex", "male");
    startRoom(room);
    submitAnswer(room, first, 0, 7);

    const again = joinRoom(room, { name: "Alex 2", bio: "new bio", sex: "male", photo: null }, first);
    if ("error" in again) throw new Error("rejoin failed");

    expect(room.participants.size).toBe(1);
    expect(again.participant.id).toBe(first.id);
    expect(again.resumeToken).toBe(first.resumeToken);
    expect(again.participant.name).toBe("Alex 2");
    expect(again.participant.answers[0]).toBe(7); // answers survive the reconnect
    expect(findParticipantByResumeToken(room, first.resumeToken)?.id).toBe(first.id);
  });

  it("bumps photoVersion only when the photo actually changes", () => {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    expect(p.photoVersion).toBe(0);

    joinRoom(room, { name: "Alex", bio: "b", sex: "male", photo: null }, p);
    expect(p.photoVersion).toBe(0); // unchanged photo -> cached URL stays valid

    joinRoom(room, { name: "Alex", bio: "b", sex: "male", photo: "data:image/jpeg;base64,AAA" }, p);
    expect(p.photoVersion).toBe(1);
  });
});

describe("submitAnswer", () => {
  it("stores the answer at its question index", () => {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    startRoom(room);

    const result = submitAnswer(room, p, 0, 8);
    expect(result).toEqual({ ok: true });
    expect(p.answers[0]).toBe(8);
  });

  it("a resubmission overwrites rather than double-counting", () => {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    startRoom(room);

    submitAnswer(room, p, 0, 3);
    submitAnswer(room, p, 0, 9);
    expect(p.answers[0]).toBe(9);
    expect(p.answers.filter((a) => a !== null)).toHaveLength(1);
  });

  it("refuses an answer for a question that is not the current one", () => {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    startRoom(room);

    const result = submitAnswer(room, p, 2, 5);
    expect("error" in result && result.error.code).toBe("QUESTION_CLOSED");
    expect(p.answers[2]).toBeNull();
  });

  it("refuses answers once the room is no longer asking", () => {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    const result = submitAnswer(room, p, 0, 5); // still in lobby
    expect("error" in result && result.error.code).toBe("QUESTION_CLOSED");
  });
});

describe("endGame", () => {
  it("scores stored answers and produces a real match result", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    const bee = join(room, "Bee", "female");
    startRoom(room);
    answerAll(room, alex, 8);
    answerAll(room, bee, 8);

    endRoom(room);

    expect(room.status).toBe("ended");
    expect(room.sectionScores?.get(alex.id)?.overall).toBeCloseTo(77.78, 1);
    expect(room.matchResult).not.toBeNull();
    expect(room.matchResult!.groups).toHaveLength(1);
    expect(room.matchResult!.groups[0].memberIds.sort()).toEqual([alex.id, bee.id].sort());
    expect(room.matchResult!.groups[0].formedVia).toBe("primary-pair");
    expect(room.matchResult!.unmatchedIds).toEqual([]);
  });

  it("leaves a participant who answered nothing unmatched rather than inventing a match", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    const bee = join(room, "Bee", "female");
    const ghost = join(room, "Ghost", "male");
    startRoom(room);
    answerAll(room, alex, 8);
    answerAll(room, bee, 7);

    endRoom(room);

    expect(room.sectionScores?.get(ghost.id)?.overall).toBeNull();
    expect(room.matchResult!.unmatchedIds).toContain(ghost.id);
    expect(room.matchResult!.groups.some((g) => g.memberIds.includes(ghost.id))).toBe(false);
  });

  it("is idempotent — a second end never recomputes or changes the result", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    const bee = join(room, "Bee", "female");
    startRoom(room);
    answerAll(room, alex, 6);
    answerAll(room, bee, 6);

    endRoom(room);
    const first = room.matchResult;
    endRoom(room);

    expect(room.matchResult).toBe(first); // same object, not merely equal
  });

  it("advancing past the last question ends the game and computes matching", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    const bee = join(room, "Bee", "female");
    startRoom(room);
    answerAll(room, alex, 5);
    answerAll(room, bee, 5);

    room.currentIndex = room.questions.length - 1;
    advanceQuestion(room);

    expect(room.status).toBe("ended");
    expect(room.matchResult).not.toBeNull();
  });

  it("scores each section from its own questions, not from position", () => {
    // 2 questions per section. Answer only the 'values' pair, at the top of the scale.
    const room = makeRoom(2);
    const p = join(room, "Alex", "male");
    startRoom(room);
    room.questions.forEach((q, i) => {
      if (q.section === "values") {
        room.currentIndex = i;
        submitAnswer(room, p, i, 10);
      }
    });

    endRoom(room);

    const scores = room.sectionScores!.get(p.id)!;
    expect(scores.bySectionIndex[SECTION_IDS.indexOf("values")]).toBe(100);
    expect(scores.bySectionIndex[SECTION_IDS.indexOf("lifestyle")]).toBeNull();
    expect(scores.overall).toBe(100);
  });
});
