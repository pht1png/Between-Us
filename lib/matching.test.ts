import { describe, expect, it } from "vitest";

import {
  computeGroups,
  computePairwiseCompatibility,
  computeSectionScores,
  MAX_GROUP_SIZE,
  type MatchableParticipant,
} from "@/lib/matching";
import { SECTION_IDS, type SectionId } from "@/lib/sections";
import type { DesiredSex, Question, SectionScores, SectionScoreTuple, Sex } from "@/lib/types";

/** Pads to the fixed four sections, so tests can keep expressing only the sections they care
 * about. The padded nulls are inert: `overall` filters them and compatibility skips any index
 * where either side is null. */
function scores(partial: (number | null)[]): SectionScores {
  const bySectionIndex = [0, 1, 2, 3].map((i) => partial[i] ?? null) as SectionScoreTuple;
  const present = bySectionIndex.filter((s): s is number => s !== null);
  const overall = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
  return { bySectionIndex, overall };
}

/** Defaults to the complement of `sex`, which reproduces exactly the opposite-sex pairing graph
 * these fixtures were originally written against — so a fixture only spells `desiredSex` out when
 * the preference itself is what's under test. `lgbtq+` has no complement, so it defaults to "any". */
function complementOf(sex: Sex): DesiredSex {
  if (sex === "male") return "female";
  if (sex === "female") return "male";
  return "any";
}

function person(
  id: string,
  sex: Sex,
  bySectionIndex: (number | null)[],
  desiredSex: DesiredSex = complementOf(sex),
): MatchableParticipant {
  return { id, sex, desiredSex, sectionScores: scores(bySectionIndex) };
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
    const zeroAnswers = {
      id: "z",
      sex: "male" as Sex,
      desiredSex: "any" as DesiredSex,
      sectionScores: scores([null, null, null, null]),
    };
    const result = computeGroups([zeroAnswers, person("m1", "male", [50]), person("f1", "female", [52])]);
    expect(result.unmatchedIds).toContain("z");
    expect(groupOf(result, "z")).toBeUndefined();
    // the two real participants still form a normal pair
    expect(groupOf(result, "m1")?.memberIds).toEqual(expect.arrayContaining(["m1", "f1"]));
  });

  it("all one sex, all open to anyone: they pair normally — 'any' genuinely accepts them", () => {
    const result = computeGroups([
      person("m1", "male", [80], "any"),
      person("m2", "male", [82], "any"),
      person("m3", "male", [10], "any"),
      person("m4", "male", [12], "any"),
    ]);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(2);
    for (const g of result.groups) {
      // Not a consolation "fallback" any more: both sides asked for this, so it's a real match.
      expect(g.formedVia).toBe("primary-pair");
      expect(g.memberIds).toHaveLength(2);
    }
  });

  it("all one sex, all wanting the other sex: nobody is compatible, everyone honestly unmatched", () => {
    const people = [
      person("m1", "male", [80]),
      person("m2", "male", [82]),
      person("m3", "male", [10]),
    ];
    const result = computeGroups(people);
    // The old engine would have force-paired these as a "same-sex fallback". Now that they have
    // each said what they want, inventing that match would contradict them.
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds.sort()).toEqual(["m1", "m2", "m3"]);
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

  it("wildly uneven (8M/2F) with strict opposite-sex preferences: only pairs form, the surplus is unmatched", () => {
    // A leftover male can't join an existing [male, female] group: he'd have to be mutually
    // compatible with *every* member, and the male already there isn't someone he asked for.
    // So with strict preferences the group-growth path can't engage, and the honest outcome is
    // 2 pairs plus 6 unmatched rather than a fabricated set of larger groups.
    const males = Array.from({ length: 8 }, (_, i) => person(`m${i}`, "male", [50]));
    const females = [person("f0", "female", [80]), person("f1", "female", [20])];
    const result = computeGroups([...males, ...females]);

    expect(result.groups.length).toBe(2);
    const sizes = result.groups.map((g) => g.memberIds.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2]);
    for (const g of result.groups) {
      expect(g.formedVia).toBe("primary-pair");
    }

    // everyone is accounted for exactly once, whether placed or unmatched
    const allIds = [...result.groups.flatMap((g) => g.memberIds), ...result.unmatchedIds];
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds).size).toBe(10);
    expect(result.unmatchedIds).toHaveLength(6);
  });

  it("nobody is placed twice or dropped, whatever the preference mix", () => {
    // 1 female, 5 males — with strict preferences only one pair can form, and the cap is never
    // a factor. The load-bearing invariant is conservation: placed + unmatched === everyone.
    const males = Array.from({ length: 5 }, (_, i) => person(`m${i}`, "male", [50]));
    const females = [person("f0", "female", [51])];
    const result = computeGroups([...males, ...females]);

    for (const g of result.groups) {
      expect(g.memberIds.length).toBeLessThanOrEqual(MAX_GROUP_SIZE);
    }
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

  /** These fixtures isolate *how leftovers spread across groups*, which is a question about group
   * size, not about preference. Everyone is open to anyone so the compatibility gate is a no-op
   * here and the spreading behavior is what's actually under test. (With strict opposite-sex
   * preferences a group can never take a third member at all — covered separately above.) */
  function open(id: string, sex: Sex, bySectionIndex: (number | null)[]) {
    return person(id, sex, bySectionIndex, "any");
  }

  it("an even, fully-compatible room pairs everyone off rather than building bigger groups", () => {
    // Once eligibility isn't capped by the smaller sex, greedy pairing consumes the whole pool,
    // so everyone gets a dedicated match and no leftover exists to grow a group with.
    const people = [
      ...Array.from({ length: 4 }, (_, i) => open(`m${i}`, "male", [50])),
      ...Array.from({ length: 2 }, (_, i) => open(`f${i}`, "female", [50])),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(sizes(result)).toEqual([2, 2, 2]);
    expect(result.unmatchedIds).toEqual([]);
  });

  it("an odd room leaves exactly one leftover, who joins a group instead of going unmatched", () => {
    const people = [
      ...Array.from({ length: 6 }, (_, i) => open(`m${i}`, "male", [50])),
      ...Array.from({ length: 3 }, (_, i) => open(`f${i}`, "female", [50])),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(sizes(result)).toEqual([2, 2, 2, 3]); // 4 pairs + the odd one absorbed
    expect(result.unmatchedIds).toEqual([]);
    const trio = result.groups.find((g) => g.memberIds.length === 3)!;
    expect(trio.formedVia).toBe("leftover-join");
  });

  it("spreads leftovers across groups instead of hoarding them into one", () => {
    // Two leftovers who can't pair with each other (no shared section => not comparable), each
    // comparable to exactly one of the two existing pairs. Both must be placed, one per group.
    const people = [
      open("a1", "male", [50, null, null, null]),
      open("a2", "female", [50, null, null, null]),
      open("b1", "male", [null, 50, null, null]),
      open("b2", "female", [null, 50, null, null]),
      open("x", "male", [56, null, null, null]), // only comparable to the a-pair
      open("y", "female", [null, 56, null, null]), // only comparable to the b-pair
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(result.unmatchedIds).toEqual([]);
    expect(sizes(result)).toEqual([3, 3]); // one leftover each, not both piled into one group
    expect(groupOf(result, "x")!.memberIds).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(groupOf(result, "y")!.memberIds).toEqual(expect.arrayContaining(["b1", "b2"]));
  });

  it("skips a group the leftover is incompatible with and places them in one they fit", () => {
    // x wants women. The all-male pair is rejected outright however good the score; the all-female
    // pair accepts him. He must land there rather than be stranded.
    const people = [
      open("m1", "male", [50]),
      open("m2", "male", [50]),
      open("f1", "female", [50]),
      open("f2", "female", [50]),
      person("x", "male", [60], "female"),
    ];
    const result = computeGroups(people, { rng: () => 0 });

    expect(result.unmatchedIds).toEqual([]);
    const xGroup = groupOf(result, "x")!;
    expect(xGroup.memberIds).toHaveLength(3);
    expect(xGroup.memberIds).toEqual(expect.arrayContaining(["f1", "f2"]));
    expect(xGroup.formedVia).toBe("leftover-join");
  });
});

describe("computeGroups — desired-sex compatibility", () => {
  it("one-directional interest is not enough — both sides must accept the other", () => {
    // Perfect score match, but m2 only wants women. m1 would accept him; he wouldn't accept m1.
    const result = computeGroups([
      person("m1", "male", [50], "any"),
      person("m2", "male", [50], "female"),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds.sort()).toEqual(["m1", "m2"]);
  });

  it("'any' accepts every sex, in both directions", () => {
    const result = computeGroups([
      person("a", "lgbtq+", [50], "any"),
      person("b", "male", [50], "any"),
      person("c", "female", [52], "any"),
      person("d", "lgbtq+", [52], "any"),
    ]);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(2);
  });

  it("an lgbtq+ participant matches whoever asked for them, and is matched by their own ask", () => {
    const result = computeGroups([
      person("q1", "lgbtq+", [50], "lgbtq+"),
      person("q2", "lgbtq+", [51], "lgbtq+"),
      person("m1", "male", [50], "female"),
    ]);
    const pair = groupOf(result, "q1");
    expect(pair?.memberIds.sort()).toEqual(["q1", "q2"]);
    expect(result.unmatchedIds).toEqual(["m1"]); // wanted a woman; there isn't one here
  });

  it("a leftover is refused a group containing anyone incompatible, even when the fit score is perfect", () => {
    // m1+f1 pair up. m2 is score-identical to both and f1 would accept him — but the group also
    // contains m1, whom m2 did not ask for, so the whole group is rejected rather than joined
    // on the strength of a good average.
    const result = computeGroups(
      [
        person("m1", "male", [50], "female"),
        person("f1", "female", [50], "any"),
        person("m2", "male", [50], "female"),
      ],
      { rng: () => 0 },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].memberIds).toHaveLength(2);
    expect(result.unmatchedIds).toHaveLength(1);
  });

  it("a residual set with no internally-compatible pair is never force-paired", () => {
    // Two men who both want women, and no women present: the primary pass leaves them, and
    // there is deliberately no fallback tier left to pair them anyway.
    const result = computeGroups([
      person("m1", "male", [50], "female"),
      person("m2", "male", [50], "female"),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds.sort()).toEqual(["m1", "m2"]);
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
