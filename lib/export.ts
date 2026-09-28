/**
 * Turns a finished room into a CSV the host can download and keep.
 *
 * This exists because there is no database: `room.matchResult` lives only as a property of an
 * in-memory object, so once the reaper frees the room (or the process restarts) the event's results
 * are gone with no way to recover them. This file is the only durable record of an event, which is
 * why the CSV carries the question *text* and not just "ข้อ 1" — after the room is freed there is
 * nothing left to look the questions up in.
 *
 * Pure, like `lib/matching.ts`: no I/O, no framework imports, and no `lib/rooms.ts` import — the
 * route hands the room in. Keeping it pure is what makes the escaping rules testable.
 */

import { SEX_LABELS_TH } from "@/lib/labels";
import { computePairwiseCompatibility, computeSectionScores } from "@/lib/matching";
import { SECTION_IDS, SECTION_LABELS_TH } from "@/lib/sections";
import type {
  DesiredSex,
  Question,
  Room,
  SectionScores,
  SectionScoreTuple,
  Sex,
} from "@/lib/types";

export type MatchKind = "primary" | "friend" | "unmatched";

const MATCH_KIND_LABELS_TH: Record<MatchKind, string> = {
  primary: "จับคู่ปกติ",
  // Same wording as the reveal screen and the admin roster badge — a host cross-referencing the
  // file against what someone saw on their phone must not find two different phrasings.
  friend: "จับคู่แบบเพื่อน",
  unmatched: "ไม่ได้จับคู่",
};

export type ResultRow = {
  name: string;
  sex: Sex;
  desiredSex: DesiredSex;
  bio: string;
  answers: (number | null)[]; // indexed by question index, null = never answered
  sectionScores: SectionScoreTuple; // nulls preserved — a skipped section is not a zero
  overall: number | null;
  matchedWith: string | null; // the mate's name, null when unmatched
  compatibility: number | null;
  matchKind: MatchKind;
  feedback: string | null;
};

/**
 * One row per participant, in join order.
 *
 * Works before the game ends too: `room.sectionScores` is only populated by `endGame`, so when it
 * is null the scores are computed locally (purely, without touching the room) and the match columns
 * come back empty. That makes a mid-game export useful rather than blank.
 */
export function buildResultRows(room: Room): ResultRow[] {
  const participants = Array.from(room.participants.values());

  const scores: Map<string, SectionScores> =
    room.sectionScores ??
    new Map(participants.map((p) => [p.id, computeSectionScores(p.answers, room.questions)]));

  return participants.map((p): ResultRow => {
    const myScores = scores.get(p.id);
    const group = room.matchResult?.groups.find((g) => g.memberIds.includes(p.id));
    const mateId = group?.memberIds.find((id) => id !== p.id);
    const mate = mateId ? room.participants.get(mateId) : undefined;
    const mateScores = mateId ? scores.get(mateId) : undefined;

    // Recomputed from the stored scores and rounded exactly as buildRevealForParticipant rounds it,
    // so the number in the file is the number that was on the participant's screen.
    const compatibility =
      myScores && mateScores
        ? computePairwiseCompatibility(myScores, mateScores).compatibility
        : null;

    return {
      name: p.name,
      sex: p.sex,
      desiredSex: p.desiredSex,
      bio: p.bio,
      answers: p.answers,
      sectionScores: myScores?.bySectionIndex ?? [null, null, null, null],
      overall: myScores?.overall ?? null,
      matchedWith: mate?.name ?? null,
      compatibility: compatibility === null ? null : Math.round(compatibility),
      matchKind: group ? (group.formedVia === "friend-match" ? "friend" : "primary") : "unmatched",
      feedback: p.feedback,
    };
  });
}

/** Excel and Sheets execute a cell that opens with one of these, so participant-typed text has to
 * be neutralised before it ever reaches a spreadsheet. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /["\r\n,]/;

function escapeCell(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Blank, never "0" — the same distinction `computeSectionScores` protects: a section nobody
 * answered is not a section answered at the bottom of the scale. */
function num(value: number | null, decimals = 0): string {
  return value === null ? "" : value.toFixed(decimals);
}

/**
 * Written for Excel opening a Thai file by double-click, which is how a host will actually use it:
 * a UTF-8 BOM (without it Excel guesses the local codepage and renders Thai as mojibake) and CRLF
 * line endings.
 */
export function toCsv(rows: ResultRow[], questions: Pick<Question, "text">[]): string {
  const header = [
    "ชื่อ",
    "เพศ",
    "เพศที่สนใจ",
    "แนะนำตัว",
    ...questions.map((q, i) => `ข้อ ${i + 1}: ${q.text}`),
    ...SECTION_IDS.map((id) => `คะแนน${SECTION_LABELS_TH[id]}`),
    "คะแนนรวม",
    "จับคู่กับ",
    "ความเข้ากัน (%)",
    "ประเภทการจับคู่",
    "ความคิดเห็น",
  ];

  const lines = [header, ...rows.map((row) => toCells(row, questions.length))].map((cells) =>
    cells.map(escapeCell).join(","),
  );

  return `﻿${lines.join("\r\n")}\r\n`;
}

function toCells(row: ResultRow, questionCount: number): string[] {
  return [
    row.name,
    SEX_LABELS_TH[row.sex],
    row.desiredSex.map((s) => SEX_LABELS_TH[s]).join(", "),
    row.bio,
    ...Array.from({ length: questionCount }, (_, i) => num(row.answers[i] ?? null)),
    ...row.sectionScores.map((score) => num(score, 1)),
    num(row.overall, 1),
    row.matchedWith ?? "",
    num(row.compatibility),
    MATCH_KIND_LABELS_TH[row.matchKind],
    row.feedback ?? "",
  ];
}

/** What the export route calls. */
export function buildResultCsv(room: Room): string {
  return toCsv(buildResultRows(room), room.questions);
}
