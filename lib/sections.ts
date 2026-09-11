/**
 * The four fixed question sections — the single source of truth for both server and client.
 *
 * This module is a pure leaf with zero imports and zero side effects, which is what lets the
 * client bundle (the admin quiz builder) import the ids and labels without pulling the matching
 * engine or anything server-only along with it. `lib/types.ts` stays type-only; `lib/matching.ts`
 * and `lib/rooms.ts` are not client-safe.
 *
 * Sections are fixed and explicit: a question declares which one it belongs to. They are never
 * derived from position and never generated at runtime — there are exactly four, forever.
 */

/** Canonical order. `SectionScores.bySectionIndex[i]` always means `SECTION_IDS[i]`. */
export const SECTION_IDS = ["lifestyle", "personality", "values", "relationships"] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_COUNT = SECTION_IDS.length; // 4

export const SECTION_LABELS_TH: Record<SectionId, string> = {
  lifestyle: "ไลฟ์สไตล์",
  personality: "บุคลิกภาพ",
  values: "ค่านิยม",
  relationships: "ความสัมพันธ์",
};

/** Shown greyed under each section header in the quiz builder, and used as the input placeholder,
 * so a host can see what kind of question belongs in each section without extra docs. */
export const SECTION_EXAMPLES_TH: Record<SectionId, string> = {
  lifestyle: "เช่น คุณชอบใช้วันหยุดทำกิจกรรมนอกบ้านมากแค่ไหน?",
  personality: "เช่น คุณชอบวางแผนล่วงหน้ามากแค่ไหน?",
  values: "เช่น ความมั่นคงในชีวิตสำคัญกับคุณมากแค่ไหน?",
  relationships: "เช่น คุณเปิดใจคุยเรื่องความรู้สึกกับคนอื่นง่ายแค่ไหน?",
};

/** Section id -> its index in the canonical order. */
export function sectionIndex(id: SectionId): number {
  return SECTION_IDS.indexOf(id);
}

/** Canonical index -> section id, or null if the index is out of range. */
export function sectionIdAt(index: number): SectionId | null {
  return SECTION_IDS[index] ?? null;
}
