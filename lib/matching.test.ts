import { describe, expect, it } from "vitest";

import {
  computeGroups,
  computePairwiseCompatibility,
  computeSectionScores,
  MAX_GROUP_SIZE,
  type MatchableParticipant,
} from "@/lib/matching";
import { SECTION_IDS, type SectionId } from "@/lib/sections";
import type { Question, SectionScores, SectionScoreTuple, Sex } from "@/lib/types";

/** Pads to the fixed four sections, so tests can keep expressing only the sections they care
 * about. The padded nulls are inert: `overall` filters them and compatibility skips any index
 * where either side is null. */
function scores(partial: (number | null)[]): SectionScores {
  const bySectionIndex = [0, 1, 2, 3].map((i) => partial[i] ?? null) as SectionScoreTuple;
  const present = bySectionIndex.filter((s): s is number => s !== null);
  const overall = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
  return { bySectionIndex, overall };
}

function person(id: string, sex: Sex, bySectionIndex: (number | null)[]): MatchableParticipant {
  return { id, sex, sectionScores: scores(bySectionIndex) };
}

function qs(...sections: SectionId[]): Pick<Question, "section">[] {
  return sections.map((section) => ({ section }));
}

function repeat(section: SectionId, n: number): SectionId[] {
  return Array<SectionId>(n).fill(section);
}

/** 20 questions, 5 per section, in canonical order — so question indices 0-4 are section 0,
 * 5-9 section 1, and so on. */
const TWENTY = qs(
  ...repeat("lifestyle", 5),
  ...repeat("personality", 5),
  ...repeat("values", 5),
  ...repeat("relationships", 5),
);

function groupOf(result: ReturnType<typeof computeGroups>, id: string) {
  return result.groups.find((g) => g.memberIds.includes(id));
}

// ---- Section scoring ----

describe("computeSectionScores", () => {
  it("normalizes 1..10 to 0..100 and averages equally-weighted within a section", () => {
    const answers = Array<number | null>(20).fill(null);
    for (let i = 0; i < 5; i++) answers[i] = 10; // all of section 0 answered with 10 -> 100
    const result = computeSectionScores(answers, TWENTY);
    expect(result.bySectionIndex[0]).toBe(100);
    expect(result.bySectionIndex[1]).toBeNull();
  });

  it("partial skip within a section averages only the answered subset, never treats missing as 0", () => {
    const answers = Array<number | null>(20).fill(null);
    answers[0] = 10; // section 0, answered
    answers[1] = null; // section 0, skipped
    answers[2] = 10;
    answers[3] = 10;
    answers[4] = 10;
    const result = computeSectionScores(answers, TWENTY);
    expect(result.bySectionIndex[0]).toBe(100); // mean of [10,10,10,10] normalized, not diluted by the skip
  });

  it("a fully-skipped section is null, not 0", () => {
    const answers = Array<number | null>(20).fill(null);
    for (let i = 5; i < 20; i++) answers[i] = 5; // sections 1,2,3 answered, section 0 untouched
    const result = computeSectionScores(answers, TWENTY);
    expect(result.bySectionIndex[0]).toBeNull();
  });

  it("overall is the mean of section scores, null only when every section is null", () => {
    const noAnswers = computeSectionScores(Array(20).fill(null), TWENTY);
    expect(noAnswers.overall).toBeNull();

    const oneAnswer = Array<number | null>(20).fill(null);
    oneAnswer[0] = 10; // section 0 = 100, sections 1-3 null
    const partial = computeSectionScores(oneAnswer, TWENTY);
    expect(partial.overall).toBe(100); // mean of the only non-null section score
  });

  it("always returns exactly four section slots", () => {
    const result = computeSectionScores([10], qs("lifestyle"));
    expect(result.bySectionIndex).toHaveLength(SECTION_IDS.length);
    expect(result.bySectionIndex).toEqual([100, null, null, null]);
  });

  it("scores by each question's own section, so authoring order does not matter", () => {
    // Interleaved authoring: lifestyle, values, lifestyle, values.
    const questions = qs("lifestyle", "values", "lifestyle", "values");
    const result = computeSectionScores([10, 1, 10, 1], questions);
    expect(result.bySectionIndex[0]).toBe(100); // lifestyle: both 10s
    expect(result.bySectionIndex[1]).toBeNull(); // personality: unused
    expect(result.bySectionIndex[2]).toBe(0); // values: both 1s
    expect(result.bySectionIndex[3]).toBeNull(); // relationships: unused

    // The same answers authored contiguously must score identically.
    const contiguous = computeSectionScores([10, 10, 1, 1], qs("lifestyle", "lifestyle", "values", "values"));
    expect(contiguous.bySectionIndex).toEqual(result.bySectionIndex);
  });

  it("weights each section equally in overall, regardless of how many questions it has", () => {
    // 5 lifestyle questions answered 10 (-> 100), 1 values question answered 1 (-> 0).
    const questions = qs(...repeat("lifestyle", 5), "values");
    const result = computeSectionScores([10, 10, 10, 10, 10, 1], questions);
    expect(result.bySectionIndex[0]).toBe(100);
    expect(result.bySectionIndex[2]).toBe(0);
    expect(result.overall).toBe(50); // mean of section means, not of raw answers
  });

  it("a section with no authored questions is null for everyone, never 0", () => {
    const questions = qs("lifestyle", "personality");
    const result = computeSectionScores([10, 10], questions);
    expect(result.bySectionIndex[2]).toBeNull(); // values: nothing authored
    expect(result.bySectionIndex[3]).toBeNull(); // relationships: nothing authored
    expect(result.overall).toBe(100);
  });

  it("zero questions yields four nulls and a null overall", () => {
    const result = computeSectionScores([], qs());
    expect(result.bySectionIndex).toEqual([null, null, null, null]);
    expect(result.overall).toBeNull();
  });
});

// ---- Pairwise compatibility ----

describe("computePairwiseCompatibility", () => {
  it("identical section scores => 100% compatible", () => {
    const a = scores([80, 70, 90, 60]);
    const b = scores([80, 70, 90, 60]);
    expect(computePairwiseCompatibility(a, b).compatibility).toBe(100);
  });

  it("matches the worked example from the spec (82/71/90/64 vs 80/74/87/67)", () => {
    const a = scores([82, 71, 90, 64]);
    const b = scores([80, 74, 87, 67]);
    const result = computePairwiseCompatibility(a, b);
    // diffs: 2,3,3,3 -> mean 2.75 -> compatibility 97.25
    expect(result.compatibility).toBeCloseTo(97.25, 5);
  });

  it("only compares jointly-answered sections, never NaN", () => {
    const a = scores([80, null, 90, null]);
    const b = scores([82, 50, null, 40]);
    const result = computePairwiseCompatibility(a, b);
    // only section 0 is joint: diff=2 -> compatibility 98
    expect(result.compatibility).toBe(98);
    expect(result.reasonSectionIndex).toBe(0);
    expect(Number.isNaN(result.compatibility)).toBe(false);
  });

  it("zero joint sections => null sentinel, never NaN", () => {
    const a = scores([80, null]);
    const b = scores([null, 50]);
    const result = computePairwiseCompatibility(a, b);
    expect(result.compatibility).toBeNull();
    expect(result.reasonSectionIndex).toBeNull();
  });

  it("reasonSectionIndex picks the section with the smallest difference", () => {
    const a = scores([80, 50, 20]);
    const b = scores([85, 50, 90]); // diffs: 5, 0, 70 -> section 1 is closest
    expect(computePairwiseCompatibility(a, b).reasonSectionIndex).toBe(1);
  });
});

// ---- Group formation ----

describe("computeGroups — population edge cases", () => {
  it("n=0 is a no-op", () => {
    expect(computeGroups([])).toEqual({ groups: [], unmatchedIds: [], computedAt: expect.any(Number) });
  });

  it("n=1: the lone participant is unmatched", () => {
    const result = computeGroups([person("a", "male", [50])]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds).toEqual(["a"]);
  });

  it("a zero-answer participant (overall=null) is excluded entirely, never placed in any group", () => {
    const zeroAnswers = { id: "z", sex: "male" as Sex, sectionScores: scores([null, null, null, null]) };
    const result = computeGroups([zeroAnswers, person("m1", "male", [50]), person("f1", "female", [52])]);
    expect(result.unmatchedIds).toContain("z");
    expect(groupOf(result, "z")).toBeUndefined();
    // the two real participants still form a normal pair
    expect(groupOf(result, "m1")?.memberIds).toEqual(expect.arrayContaining(["m1", "f1"]));
  });

  it("all one sex: falls back to similarity pairing, labeled same-sex-fallback", () => {
    const result = computeGroups([
      person("m1", "male", [80]),
      person("m2", "male", [82]),
      person("m3", "male", [10]),
      person("m4", "male", [12]),
    ]);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(2);
    for (const g of result.groups) {
      expect(g.formedVia).toBe("same-sex-fallback");
      expect(g.memberIds).toHaveLength(2);
    }
  });

  it("exactly balanced (4M/4F): four pairs, zero leftovers, everyone placed exactly once", () => {
    const people = [
      person("m1", "male", [90]),
      person("m2", "male", [60]),
      person("m3", "male", [30]),
      person("m4", "male", [5]),
      person("f1", "female", [88]),
      person("f2", "female", [58]),
      person("f3", "female", [33]),
      person("f4", "female", [3]),
    ];
    const result = computeGroups(people);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(4);
    const allMemberIds = result.groups.flatMap((g) => g.memberIds);
    expect(allMemberIds.sort()).toEqual(people.map((p) => p.id).sort());
    for (const g of result.groups) {
      expect(g.memberIds).toHaveLength(2);
      expect(g.formedVia).toBe("primary-pair");
      const sexes = g.memberIds.map((id) => people.find((p) => p.id === id)!.sex);
      expect(new Set(sexes).size).toBe(2); // one of each sex
    }
  });

  it("wildly uneven (8M/2F): groups grow to the cap, never past it, residual forms its own pair", () => {
    const males = Array.from({ length: 8 }, (_, i) => person(`m${i}`, "male", [50]));
    const females = [person("f0", "female", [80]), person("f1", "female", [20])];
    const result = computeGroups([...males, ...females]);

    expect(result.groups.length).toBe(3); // 2 grown mixed groups + 1 same-sex residual pair
    for (const g of result.groups) {
      expect(g.memberIds.length).toBeLessThanOrEqual(MAX_GROUP_SIZE);
    }
    const sizes = result.groups.map((g) => g.memberIds.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 4, 4]);

    const residual = result.groups.find((g) => g.formedVia === "same-sex-fallback");
    expect(residual).toBeDefined();
    expect(residual!.memberIds).toHaveLength(2);

    // everyone accounted for exactly once, nobody duplicated or dropped
    const allIds = result.groups.flatMap((g) => g.memberIds);
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds).size).toBe(10);
    expect(result.unmatchedIds).toEqual([]);
  });

  it("group-size cap is never exceeded even when a leftover's best fit is an already-full group", () => {
    // 1 female, 5 males — one pair forms, then up to 2 more leftovers can join it (cap 4),
    // the remaining 2 males must form their own same-sex pair rather than a group of 5+.
    const males = Array.from({ length: 5 }, (_, i) => person(`m${i}`, "male", [50]));
    const females = [person("f0", "female", [51])];
    const result = computeGroups([...males, ...females]);

    const mixedGroup = result.groups.find((g) => g.memberIds.includes("f0"))!;
    expect(mixedGroup.memberIds.length).toBeLessThanOrEqual(MAX_GROUP_SIZE);
    expect(mixedGroup.memberIds.length).toBe(MAX_GROUP_SIZE); // grows to exactly the cap

    const totalPlaced = result.groups.flatMap((g) => g.memberIds).length;
    expect(totalPlaced + result.unmatchedIds.length).toBe(6);
  });
});

describe("computeGroups — breadth-first leftover assignment", () => {
  /** Sizes of the formed groups, ascending — the shape of the room, independent of who
   * landed where (which is rng-driven under ties by design). */
  function sizes(result: ReturnType<typeof computeGroups>) {
    return result.groups.map((g) => g.memberIds.length).sort((a, b) => a - b);
  }

  it("4M/2F all identical: two trios, not a quartet plus an untouched pair", () => {
    // Every pair scores 100, so nothing but the fill order distinguishes the outcomes.
    // Depth-first would pile both leftovers into whichever group won the first tie.
    const people = [
      ...Array.from({ length: 4 }, (_, i) => person(`m${i}`, "male", [50])),
      ...Array.from({ length: 2 }, (_, i) => person(`f${i}`, "female", [50])),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(sizes(result)).toEqual([3, 3]);
    expect(result.unmatchedIds).toEqual([]);
  });

  it("6M/3F all identical: three trios, nobody hoarded into a quartet", () => {
    const people = [
      ...Array.from({ length: 6 }, (_, i) => person(`m${i}`, "male", [50])),
      ...Array.from({ length: 3 }, (_, i) => person(`f${i}`, "female", [50])),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(sizes(result)).toEqual([3, 3, 3]);
    expect(result.unmatchedIds).toEqual([]);
  });

  it("3M/1F all identical: the quartet is intentional — only one group exists to join", () => {
    // Deliberately locked in: with a single primary pair there is nowhere to spread to, and
    // inventing a same-sex pair while a mixed group still has room would be worse.
    const people = [
      ...Array.from({ length: 3 }, (_, i) => person(`m${i}`, "male", [50])),
      person("f0", "female", [50]),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].memberIds).toHaveLength(MAX_GROUP_SIZE);
    expect(result.groups[0].formedVia).toBe("leftover-join");
    expect(result.unmatchedIds).toEqual([]);
  });

  it("widens past the smallest group when nobody there is comparable, rather than stranding a leftover", () => {
    // Group A lives entirely in section 0; group B and both leftovers live entirely in
    // section 1, so A shares no section with a leftover and compatibility is null there.
    // After the first leftover grows B to 3, A is the *smallest* eligible group but still
    // incomparable — the second leftover must widen to B, not fall through to unmatched.
    const people = [
      person("m1", "male", [50, null, null, null]),
      person("f1", "female", [50, null, null, null]),
      person("m2", "male", [null, 50, null, null]),
      person("f2", "female", [null, 50, null, null]),
      person("m3", "male", [null, 50, null, null]),
      person("m4", "male", [null, 50, null, null]),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(result.unmatchedIds).toEqual([]);
    const groupA = groupOf(result, "m1")!;
    expect(groupA.memberIds.sort()).toEqual(["f1", "m1"]); // untouched, nobody comparable
    const groupB = groupOf(result, "m2")!;
    expect(groupB.memberIds).toHaveLength(4); // both leftovers absorbed here
    expect(groupB.memberIds).toContain("m4");
  });
});

describe("computeGroups — deterministic tie-breaking", () => {
  // m1 is tied (within TIE_TOLERANCE=2) between f1 (compat 100) and f2 (compat 98).
  // m2/f1 and m2/f2 are both far worse (0 and 2) and must never be chosen in round 1
  // regardless of rng output.
  const m1 = person("m1", "male", [100]);
  const m2 = person("m2", "male", [0]);
  const f1 = person("f1", "female", [100]);
  const f2 = person("f2", "female", [98]);

  it("rng=0 deterministically picks the first tied candidate (m1-f1)", () => {
    const result = computeGroups([m1, m2, f1, f2], { rng: () => 0 });
    expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["f1", "m1"]);
    expect(groupOf(result, "m2")?.memberIds.sort()).toEqual(["f2", "m2"]);
  });

  it("a different rng output picks the other tied candidate (m1-f2), proving randomization is real", () => {
    const result = computeGroups([m1, m2, f1, f2], { rng: () => 0.99 });
    expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["f2", "m1"]);
    expect(groupOf(result, "m2")?.memberIds.sort()).toEqual(["f1", "m2"]);
  });

  it("never picks the out-of-tolerance candidate regardless of rng", () => {
    for (const rngValue of [0, 0.25, 0.5, 0.75, 0.99]) {
      const result = computeGroups([m1, m2, f1, f2], { rng: () => rngValue });
      // m1 must always be paired with f1 or f2 in round 1 — never is m2 involved in round 1's pick
      expect(["f1", "f2"]).toContain(groupOf(result, "m1")?.memberIds.find((id) => id !== "m1"));
    }
  });
});

describe("computeGroups — determinism under reordered input", () => {
  it("is deterministic regardless of input order, given a fixed rng", () => {
    const people = [
      person("m1", "male", [90]),
      person("m2", "male", [40]),
      person("f1", "female", [88]),
      person("f2", "female", [38]),
    ];
    const forward = computeGroups(people, { rng: () => 0 });
    const backward = computeGroups([...people].reverse(), { rng: () => 0 });

    const asPairs = (r: ReturnType<typeof computeGroups>) =>
      new Set(r.groups.map((g) => [...g.memberIds].sort().join("|")));
    expect(asPairs(forward)).toEqual(asPairs(backward));
  });
});
