import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  advanceQuestion,
  createRoom,
  endRoom,
  findParticipantByResumeToken,
  findRoomByHostToken,
  getRoom,
  getRoomCount,
  joinRoom,
  startRoom,
  submitAnswer,
  submitFeedback,
  sweepRooms,
} from "@/lib/rooms";
import { SECTION_IDS, type SectionId } from "@/lib/sections";
import type { DesiredSex, Participant, Room, Sex } from "@/lib/types";

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

/** Open to every sex — the multi-select equivalent of "anyone", so fixtures that aren't about
 * preference don't accidentally constrain matching. */
const ANYONE: DesiredSex = ["male", "female", "lgbtq_male", "lgbtq_female"];

let rooms: Room[] = [];

function makeRoom(perSection = 1) {
  const room = createRoom(`host-${crypto.randomUUID()}`, questions(perSection));
  rooms.push(room);
  return room;
}

function join(room: Room, name: string, sex: Sex, desiredSex: DesiredSex = ANYONE) {
  const result = joinRoom(room, {
    name,
    bio: `${name} bio`,
    sex,
    desiredSex,
    photo: null,
    photoThumb: null,
  });
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

    const again = joinRoom(
      room,
      { name: "Alex 2", bio: "new bio", sex: "male", desiredSex: ANYONE, photo: null, photoThumb: null },
      first,
    );
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

    joinRoom(
      room,
      { name: "Alex", bio: "b", sex: "male", desiredSex: ANYONE, photo: null, photoThumb: null },
      p,
    );
    expect(p.photoVersion).toBe(0); // unchanged photo -> cached URL stays valid

    joinRoom(
      room,
      {
        name: "Alex",
        bio: "b",
        sex: "male",
        desiredSex: ANYONE,
        photo: "data:image/jpeg;base64,AAA",
        photoThumb: "data:image/jpeg;base64,BBB",
      },
      p,
    );
    expect(p.photoVersion).toBe(1);
    expect(p.photoThumb).toBe("data:image/jpeg;base64,BBB"); // both sizes land together
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

describe("sweepRooms", () => {
  const HOUR = 60 * 60 * 1000;

  // Rooms live in one process-wide store, so earlier tests in this file leave their (now ended)
  // rooms behind and a sweep would count those too. Purge first so each test's numbers are its own.
  beforeEach(() => {
    sweepRooms(Date.now() + 1000 * HOUR);
  });

  /** Ends a room the way a real game does, so `endedAt` is set by endGame rather than by the test. */
  function playToEnd() {
    const room = makeRoom();
    const p = join(room, "Alex", "male");
    startRoom(room);
    answerAll(room, p, 5);
    endRoom(room);
    return room;
  }

  it("frees an ended room once its window has passed", () => {
    const room = playToEnd();
    expect(room.endedAt).not.toBeNull();

    expect(sweepRooms(Date.now() + 1 * HOUR)).toBe(0); // still inside the 2h window
    expect(getRoom(room.pin)).toBe(room);

    expect(sweepRooms(Date.now() + 3 * HOUR)).toBe(1);
    expect(getRoom(room.pin)).toBeUndefined();
  });

  it("keeps a room that just ended — the host still has to be able to export it", () => {
    const room = playToEnd();
    expect(sweepRooms()).toBe(0);
    expect(getRoom(room.pin)).toBe(room);
  });

  it("gives a room that never ended the longer abandoned window", () => {
    const room = makeRoom(); // still in lobby, endedAt === null
    expect(room.endedAt).toBeNull();

    expect(sweepRooms(Date.now() + 3 * HOUR)).toBe(0); // past the ended window, not the abandoned one
    expect(getRoom(room.pin)).toBe(room);

    expect(sweepRooms(Date.now() + 7 * HOUR)).toBe(1);
    expect(getRoom(room.pin)).toBeUndefined();
  });

  it("drops the freed room from the room count", () => {
    const before = getRoomCount();
    playToEnd();
    expect(getRoomCount()).toBe(before + 1);

    sweepRooms(Date.now() + 3 * HOUR);
    expect(getRoomCount()).toBe(before);
  });

  it("stops resolving a freed room by host token, so the admin restore path sees no live room", () => {
    // freeRoom has to drop the activeRoomByToken entry too, or that map grows across events and
    // GET /api/admin/rooms/current keeps pointing at a room that no longer exists.
    const token = `host-${crypto.randomUUID()}`;
    const room = createRoom(token, questions());
    rooms.push(room);
    endRoom(room);
    expect(findRoomByHostToken(token)).toBe(room);

    sweepRooms(Date.now() + 3 * HOUR);
    expect(findRoomByHostToken(token)).toBeUndefined();
    expect(getRoom(room.pin)).toBeUndefined();
  });
});

describe("createRoom replacing a host's previous room", () => {
  it("ends the previous room but leaves it resident for the reaper", () => {
    // An accidental re-create must not destroy results before anyone has exported them — so the old
    // room is ended (its timer stopped, its players released to their reveal) but not freed.
    const token = `host-${crypto.randomUUID()}`;
    const first = createRoom(token, questions());
    rooms.push(first);
    startRoom(first);

    const second = createRoom(token, questions());
    rooms.push(second);

    expect(first.status).toBe("ended");
    expect(first.endedAt).not.toBeNull();
    expect(getRoom(first.pin)).toBe(first); // still there to export
    expect(second.pin).not.toBe(first.pin);
    expect(second.status).toBe("lobby");
  });

  it("does not disturb an already-ended previous room", () => {
    const token = `host-${crypto.randomUUID()}`;
    const first = createRoom(token, questions());
    rooms.push(first);
    endRoom(first);
    const endedAt = first.endedAt;

    const second = createRoom(token, questions());
    rooms.push(second);

    expect(first.endedAt).toBe(endedAt); // endGame stayed idempotent
    expect(getRoom(first.pin)).toBe(first);
  });
});

describe("submitFeedback", () => {
  it("stores trimmed text and overwrites on resubmit", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");

    submitFeedback(alex, "  อยากให้จัดอีก  ");
    expect(alex.feedback).toBe("อยากให้จัดอีก");

    submitFeedback(alex, "เปลี่ยนใจ");
    expect(alex.feedback).toBe("เปลี่ยนใจ");
  });

  it("treats an empty or whitespace-only submission as clearing it", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");

    submitFeedback(alex, "บางอย่าง");
    submitFeedback(alex, "   ");

    expect(alex.feedback).toBeNull();
  });

  it("works after the room has ended — feedback is left on the way out, not during a question", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    startRoom(room);
    answerAll(room, alex, 5);
    endRoom(room);

    submitFeedback(alex, "สนุกมาก");

    expect(room.status).toBe("ended");
    expect(alex.feedback).toBe("สนุกมาก");
  });
});
