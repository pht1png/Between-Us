import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildResultRows, toCsv, type ResultRow } from "@/lib/export";
import { createRoom, endRoom, joinRoom, startRoom, submitAnswer } from "@/lib/rooms";
import { SECTION_IDS, type SectionId } from "@/lib/sections";
import type { DesiredSex, Participant, Room, Sex } from "@/lib/types";

/**
 * The CSV is the only durable record of an event — once the reaper frees a room, or the process
 * restarts, there is nothing left to regenerate it from. So these tests pin two separate things:
 * that the rows describe what actually happened in the room, and that the file a host double-clicks
 * in Excel is readable Thai rather than mojibake or a formula.
 */

// ---- toCsv: formatting and escaping, no Room needed ----

const BASE_ROW: ResultRow = {
  name: "Alex",
  sex: "male",
  desiredSex: ["female"],
  bio: "ชอบเที่ยวทะเล",
  answers: [8, null],
  sectionScores: [77.7777, null, 50, 100],
  overall: 75.9259,
  matchedWith: "Bee",
  compatibility: 92,
  matchKind: "primary",
  feedback: null,
};

const QUESTIONS = [{ text: "คำถามหนึ่ง" }, { text: "คำถามสอง" }];

/** Parses one CSV line back into cells, unquoting as it goes — so these tests assert on the values a
 * spreadsheet would show, not on the raw punctuation. No fixture here has a newline inside a cell. */
function cellsOf(csv: string, lineIndex: number): string[] {
  const line = csv.replace(/^﻿/, "").split("\r\n")[lineIndex];
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

describe("toCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF — without both, Excel mangles Thai", () => {
    const csv = toCsv([BASE_ROW], QUESTIONS);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("puts each question's text in the header, not just its number", () => {
    // After the room is freed there is nothing left to look "ข้อ 1" up in.
    const header = toCsv([BASE_ROW], QUESTIONS).split("\r\n")[0];
    expect(header).toContain("ข้อ 1: คำถามหนึ่ง");
    expect(header).toContain("ข้อ 2: คำถามสอง");
  });

  it("names a section score column per section, in canonical order", () => {
    const header = toCsv([BASE_ROW], QUESTIONS).split("\r\n")[0];
    expect(header).toContain("คะแนนไลฟ์สไตล์");
    expect(header).toContain("คะแนนความสัมพันธ์");
    expect(header.indexOf("คะแนนไลฟ์สไตล์")).toBeLessThan(header.indexOf("คะแนนความสัมพันธ์"));
  });

  it("renders a skipped section as empty, never as 0", () => {
    // The whole point of SectionScores allowing null: "nobody answered" and "answered at the very
    // bottom of the scale" must not become the same number in the host's spreadsheet.
    const csv = toCsv([{ ...BASE_ROW, sectionScores: [null, null, null, null] }], QUESTIONS);
    const row = csv.split("\r\n")[1];
    expect(row).not.toContain("0.0");
    expect(row).toContain(",,,,"); // the four score columns, all blank
  });

  it("renders an unanswered question as empty rather than 0", () => {
    const csv = toCsv([{ ...BASE_ROW, answers: [null, null] }], QUESTIONS);
    expect(cellsOf(csv, 1).slice(4, 6)).toEqual(["", ""]);
  });

  it("rounds scores to one decimal and compatibility to a whole percent", () => {
    const cells = cellsOf(toCsv([BASE_ROW], QUESTIONS), 1);
    expect(cells).toContain("77.8"); // section score
    expect(cells).toContain("75.9"); // overall
    expect(cells).toContain("92"); // compatibility, matching what the reveal screen showed
  });

  it("quotes and doubles quotes in free text a participant typed", () => {
    const csv = toCsv([{ ...BASE_ROW, bio: 'ชอบ "ทะเล", ภูเขา' }], QUESTIONS);
    expect(csv).toContain('"ชอบ ""ทะเล"", ภูเขา"');
  });

  it("neutralises a leading = so a spreadsheet can't execute typed text as a formula", () => {
    const csv = toCsv([{ ...BASE_ROW, feedback: "=SUM(A1:A9)" }], QUESTIONS);
    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it("guards the other formula lead-ins too", () => {
    for (const lead of ["+", "-", "@"]) {
      expect(toCsv([{ ...BASE_ROW, name: `${lead}x` }], QUESTIONS)).toContain(`'${lead}x`);
    }
  });

  it("writes Thai labels for sex and the match kind", () => {
    const friend = toCsv([{ ...BASE_ROW, matchKind: "friend" }], QUESTIONS);
    // Must read the same as the reveal screen and the admin badge.
    expect(friend).toContain("จับคู่แบบเพื่อน");
    expect(toCsv([{ ...BASE_ROW, matchKind: "unmatched" }], QUESTIONS)).toContain("ไม่ได้จับคู่");
    expect(toCsv([{ ...BASE_ROW, sex: "lgbtq_female" }], QUESTIONS)).toContain("LGBTQ+ (หญิง)");
  });

  it("joins multi-select preferences into one cell", () => {
    const csv = toCsv([{ ...BASE_ROW, desiredSex: ["male", "lgbtq_female"] }], QUESTIONS);
    expect(csv).toContain('"ชาย, LGBTQ+ (หญิง)"'); // comma inside forces quoting
  });

  it("gives every row the same number of columns as the header", () => {
    const csv = toCsv([BASE_ROW, { ...BASE_ROW, matchKind: "unmatched", matchedWith: null }], QUESTIONS);
    const lineCount = csv.replace(/^﻿/, "").trimEnd().split("\r\n").length;
    const width = cellsOf(csv, 0).length;
    // 4 profile + 2 questions + 4 sections + overall + mate + compatibility + kind + feedback
    expect(width).toBe(15);
    expect(lineCount).toBe(3); // header + two rows
    for (let i = 1; i < lineCount; i++) expect(cellsOf(csv, i).length).toBe(width);
  });
});

// ---- buildResultRows: does it describe what actually happened ----

const ANYONE: DesiredSex = ["male", "female", "lgbtq_male", "lgbtq_female"];

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

function makeRoom() {
  const room = createRoom(`host-${crypto.randomUUID()}`, questions());
  rooms.push(room);
  return room;
}

function join(room: Room, name: string, sex: Sex, desiredSex: DesiredSex = ANYONE) {
  const result = joinRoom(room, { name, bio: `${name} bio`, sex, desiredSex, photo: null, photoThumb: null });
  if ("error" in result) throw new Error(`join failed: ${result.error.code}`);
  return result.participant;
}

function answerAll(room: Room, participant: Participant, value: number) {
  for (let i = 0; i < room.questions.length; i++) {
    room.currentIndex = i;
    submitAnswer(room, participant, i, value);
  }
}

beforeEach(() => {
  rooms = [];
});

afterEach(() => {
  for (const room of rooms) endRoom(room);
});

describe("buildResultRows", () => {
  it("names each person's mate on their own row, both ways", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male", ["female"]);
    const bee = join(room, "Bee", "female", ["male"]);
    startRoom(room);
    answerAll(room, alex, 8);
    answerAll(room, bee, 8);
    endRoom(room);

    const rows = buildResultRows(room);
    expect(rows.map((r) => r.name)).toEqual(["Alex", "Bee"]); // join order
    expect(rows[0].matchedWith).toBe("Bee");
    expect(rows[1].matchedWith).toBe("Alex");
    expect(rows[0].matchKind).toBe("primary");
    expect(rows[0].compatibility).toBe(100); // identical answers
  });

  it("reports a friend-match as such, not as an ordinary pair", () => {
    // Two men who both asked for women: pass 1 can't pair them, pass 2 does — and the file has to
    // say so, exactly as the reveal screen does.
    const room = makeRoom();
    const a = join(room, "Kim", "male", ["female"]);
    const b = join(room, "Lek", "male", ["female"]);
    startRoom(room);
    answerAll(room, a, 7);
    answerAll(room, b, 7);
    endRoom(room);

    const rows = buildResultRows(room);
    expect(rows.every((r) => r.matchKind === "friend")).toBe(true);
    expect(rows[0].matchedWith).toBe("Lek");
  });

  it("leaves someone who answered nothing unmatched, with null scores rather than zeros", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male", ["female"]);
    const bee = join(room, "Bee", "female", ["male"]);
    join(room, "Ghost", "male");
    startRoom(room);
    answerAll(room, alex, 8);
    answerAll(room, bee, 8);
    endRoom(room);

    const ghost = buildResultRows(room).find((r) => r.name === "Ghost")!;
    expect(ghost.matchKind).toBe("unmatched");
    expect(ghost.matchedWith).toBeNull();
    expect(ghost.compatibility).toBeNull();
    expect(ghost.overall).toBeNull();
    expect(ghost.sectionScores).toEqual([null, null, null, null]);
  });

  it("still scores a room that hasn't ended, with the match columns empty", () => {
    // A mid-game export should be useful, not blank — endGame is what populates room.sectionScores,
    // so before that the scores are computed for the file without touching the room.
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    startRoom(room);
    answerAll(room, alex, 10);

    const [row] = buildResultRows(room);
    expect(row.overall).toBe(100);
    expect(row.matchKind).toBe("unmatched");
    expect(row.matchedWith).toBeNull();
    expect(room.sectionScores).toBeNull(); // unchanged by the export
  });

  it("carries feedback through to its own column", () => {
    const room = makeRoom();
    const alex = join(room, "Alex", "male");
    alex.feedback = "อยากให้จัดอีก";
    expect(buildResultRows(room)[0].feedback).toBe("อยากให้จัดอีก");
  });
});
