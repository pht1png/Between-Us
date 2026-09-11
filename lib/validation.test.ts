import { describe, expect, it } from "vitest";

import { SECTION_IDS } from "@/lib/sections";
import { answerSchema, createRoomSchema, joinSchema } from "@/lib/validation";

/**
 * These pin the wire contracts. The answer-submission tests in particular exist because the
 * client and server agreeing on `{ questionIndex, value }` is invisible at the type level — the
 * client builds the body with JSON.stringify, so a rename on either side would only show up as a
 * 400 during a live event. Here it shows up as a failing test instead.
 */

describe("answerSchema", () => {
  it("accepts exactly the payload the question page sends", () => {
    // Mirrors app/(play)/question/page.tsx: { questionIndex: asking.question.index, value }
    const parsed = answerSchema.safeParse({ questionIndex: 0, value: 8 });
    expect(parsed.success).toBe(true);
  });

  it("accepts the full 1-10 answer range", () => {
    for (let value = 1; value <= 10; value++) {
      expect(answerSchema.safeParse({ questionIndex: 3, value }).success).toBe(true);
    }
  });

  it("rejects a stringified value rather than coercing it", () => {
    const parsed = answerSchema.safeParse({ questionIndex: 0, value: "8" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join("."))).toContain("value");
  });

  it("rejects a stringified questionIndex", () => {
    const parsed = answerSchema.safeParse({ questionIndex: "0", value: 8 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join("."))).toContain("questionIndex");
  });

  it("rejects a missing value, and names the field", () => {
    const parsed = answerSchema.safeParse({ questionIndex: 0 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join("."))).toEqual(["value"]);
  });

  it("rejects a missing questionIndex, and names the field", () => {
    const parsed = answerSchema.safeParse({ value: 5 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.path.join("."))).toEqual(["questionIndex"]);
  });

  it("rejects out-of-range values", () => {
    expect(answerSchema.safeParse({ questionIndex: 0, value: 0 }).success).toBe(false);
    expect(answerSchema.safeParse({ questionIndex: 0, value: 11 }).success).toBe(false);
  });

  it("rejects a non-integer value (a fractional slider reading must never be stored)", () => {
    expect(answerSchema.safeParse({ questionIndex: 0, value: 7.5 }).success).toBe(false);
  });

  it("rejects a negative questionIndex", () => {
    expect(answerSchema.safeParse({ questionIndex: -1, value: 5 }).success).toBe(false);
  });

  it("rejects null and non-object bodies (what a failed request.json() produces)", () => {
    expect(answerSchema.safeParse(null).success).toBe(false);
    expect(answerSchema.safeParse("questionIndex=0&value=8").success).toBe(false);
    expect(answerSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("createRoomSchema", () => {
  const question = (section: string, text = "คำถามทดสอบ") => ({ text, duration: 20, section });

  function allFourSections() {
    return SECTION_IDS.map((id) => question(id));
  }

  it("accepts a room covering all four sections", () => {
    const parsed = createRoomSchema.safeParse({ questions: allFourSections() });
    expect(parsed.success).toBe(true);
  });

  it("rejects a room that misses a section", () => {
    const parsed = createRoomSchema.safeParse({
      questions: [question("lifestyle"), question("personality"), question("values")],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0].message).toBe("ต้องมีคำถามอย่างน้อย 1 ข้อในทุกหมวด");
  });

  it("rejects an unknown section id, so no fifth section can be introduced over the wire", () => {
    const parsed = createRoomSchema.safeParse({
      questions: [...allFourSections(), question("communication")],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a section on every question", () => {
    const parsed = createRoomSchema.safeParse({
      questions: [...allFourSections(), { text: "ไม่มีหมวด", duration: 20 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("still enforces duration bounds", () => {
    const tooShort = allFourSections();
    tooShort[0] = { ...tooShort[0], duration: 1 };
    expect(createRoomSchema.safeParse({ questions: tooShort }).success).toBe(false);
  });
});

describe("joinSchema", () => {
  const base = { name: "Alex", bio: "ชอบเที่ยวทะเล", sex: "male", photo: null };

  it("accepts a valid profile with a null photo", () => {
    expect(joinSchema.safeParse(base).success).toBe(true);
  });

  it("accepts only the two supported sexes", () => {
    expect(joinSchema.safeParse({ ...base, sex: "female" }).success).toBe(true);
    expect(joinSchema.safeParse({ ...base, sex: "other" }).success).toBe(false);
    expect(joinSchema.safeParse({ ...base, sex: "" }).success).toBe(false);
  });

  it("rejects a photo that is not an image data URL", () => {
    expect(joinSchema.safeParse({ ...base, photo: "https://example.com/a.jpg" }).success).toBe(false);
    expect(joinSchema.safeParse({ ...base, photo: "data:image/jpeg;base64,abc" }).success).toBe(true);
  });
});
