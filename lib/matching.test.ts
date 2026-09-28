import { describe, expect, it } from "vitest";

import {
  computeGroups,
  computePairwiseCompatibility,
  computeSectionScores,
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

/** Every sex — the multi-select equivalent of "open to anyone", and the default for fixtures that
 * aren't about preference at all. Fixtures testing the preference gate spell their own list out. */
const ANYONE: DesiredSex = ["male", "female", "lgbtq_male", "lgbtq_female"];

function person(
  id: string,
  sex: Sex,
  bySectionIndex: (number | null)[],
  desiredSex: DesiredSex = ANYONE,
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

// ---- Pair formation ----

describe("computeGroups — population edge cases", () => {
  it("n=0 is a no-op", () => {
    expect(computeGroups([])).toEqual({ groups: [], unmatchedIds: [], computedAt: expect.any(Number) });
  });

  it("n=1: the lone participant is unmatched", () => {
    const result = computeGroups([person("a", "male", [50])]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds).toEqual(["a"]);
  });

  it("a zero-answer participant (overall=null) is excluded entirely, never paired", () => {
    const zeroAnswers: MatchableParticipant = {
      id: "z",
      sex: "male",
      desiredSex: ANYONE,
      sectionScores: scores([null, null, null, null]),
    };
    const result = computeGroups([zeroAnswers, person("m1", "male", [50]), person("f1", "female", [52])]);
    expect(result.unmatchedIds).toContain("z");
    expect(groupOf(result, "z")).toBeUndefined();
    expect(groupOf(result, "m1")?.memberIds).toEqual(expect.arrayContaining(["m1", "f1"]));
  });

  it("every formed pair has exactly two members — matching is strictly 1-to-1", () => {
    const people = Array.from({ length: 7 }, (_, i) => person(`p${i}`, "male", [50 + i]));
    const result = computeGroups(people, { rng: () => 0 });
    for (const g of result.groups) expect(g.memberIds).toHaveLength(2);
  });

  it("an odd population leaves exactly one person unmatched, and nobody is placed twice", () => {
    const people = Array.from({ length: 5 }, (_, i) => person(`p${i}`, "male", [50 + i]));
    const result = computeGroups(people, { rng: () => 0 });

    expect(result.groups).toHaveLength(2);
    expect(result.unmatchedIds).toHaveLength(1);
    const allIds = [...result.groups.flatMap((g) => g.memberIds), ...result.unmatchedIds];
    expect(allIds).toHaveLength(5);
    expect(new Set(allIds).size).toBe(5);
  });

  it("everyone is accounted for exactly once, whatever the preference mix", () => {
    const people = [
      person("m1", "male", [50], ["female"]),
      person("m2", "male", [60], ["female"]),
      person("f1", "female", [55], ["male"]),
      person("q1", "lgbtq_male", [70], ["lgbtq_female"]),
      person("q2", "lgbtq_female", [72], ["lgbtq_male"]),
    ];
    const result = computeGroups(people, { rng: () => 0 });
    const allIds = [...result.groups.flatMap((g) => g.memberIds), ...result.unmatchedIds];
    expect(allIds.sort()).toEqual(["f1", "m1", "m2", "q1", "q2"]);
  });
});

describe("computeGroups — desired-sex gate (primary pass)", () => {
  it("one-directional interest is not enough — both sides must accept the other", () => {
    // Perfect score match, but m2 only wants women. m1 would accept him; he wouldn't accept m1.
    // The primary gate must refuse them; they only end up together via the disclosed friend pass.
    const result = computeGroups([
      person("m1", "male", [50], ANYONE),
      person("m2", "male", [50], ["female"]),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].formedVia).toBe("friend-match");
  });

  it("selecting every sex accepts everyone, in both directions", () => {
    const result = computeGroups([
      person("a", "lgbtq_male", [50], ANYONE),
      person("b", "male", [50], ANYONE),
      person("c", "female", [52], ANYONE),
      person("d", "lgbtq_female", [52], ANYONE),
    ]);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(2);
    for (const g of result.groups) expect(g.formedVia).toBe("primary-pair");
  });

  it("a multi-select preference matches any of the chosen sexes", () => {
    // q1 is open to both flavours of LGBTQ+ but not to men or women; only q2 qualifies.
    const result = computeGroups([
      person("q1", "lgbtq_female", [50], ["lgbtq_male", "lgbtq_female"]),
      person("q2", "lgbtq_male", [51], ["lgbtq_female"]),
      person("m1", "male", [50], ["female"]),
    ]);
    expect(groupOf(result, "q1")?.memberIds.sort()).toEqual(["q1", "q2"]);
    expect(result.unmatchedIds).toEqual(["m1"]); // wanted a woman; there isn't one here
  });

  it("the four sexes are distinct — wanting lgbtq_male does not match an lgbtq_female", () => {
    // Both are lgbtq_female and both asked for lgbtq_male, so neither satisfies the other's ask.
    // They fall through to the friend pass rather than counting as a preference match.
    const result = computeGroups([
      person("a", "lgbtq_female", [50], ["lgbtq_male"]),
      person("b", "lgbtq_female", [50], ["lgbtq_male"]),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].formedVia).toBe("friend-match");
  });

  it("a low-scoring preference match still beats sending both people to the friend pass", () => {
    // a+b are mutually compatible but nearly opposite (compat 5). c is incompatible with both by
    // preference, yet scores almost perfectly with b. The preference match must still win.
    const result = computeGroups(
      [
        person("a", "male", [0], ["female"]),
        person("b", "female", [95], ["male"]),
        person("c", "male", [95], ["male"]),
      ],
      { rng: () => 0 },
    );
    expect(groupOf(result, "a")?.memberIds.sort()).toEqual(["a", "b"]);
    expect(groupOf(result, "a")?.formedVia).toBe("primary-pair");
    expect(result.unmatchedIds).toEqual(["c"]);
  });
});

describe("computeGroups — friend-match fallback", () => {
  it("pairs leftovers by score alone when preferences left them stranded, and labels it", () => {
    // Two men who both want women, with no women present: the primary pass can't touch them, so
    // the friend pass pairs them on score rather than leaving them with nobody.
    const result = computeGroups([
      person("m1", "male", [50], ["female"]),
      person("m2", "male", [52], ["female"]),
    ]);

    expect(result.unmatchedIds).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].memberIds.sort()).toEqual(["m1", "m2"]);
    expect(result.groups[0].formedVia).toBe("friend-match");
  });

  it("only runs for people the primary pass could not place", () => {
    // f1+m1 are mutually compatible and pair first; q1+q2 are left over and friend-match.
    const result = computeGroups(
      [
        person("m1", "male", [50], ["female"]),
        person("f1", "female", [50], ["male"]),
        person("q1", "lgbtq_male", [80], ["female"]),
        person("q2", "lgbtq_female", [80], ["male"]),
      ],
      { rng: () => 0 },
    );

    expect(groupOf(result, "m1")?.formedVia).toBe("primary-pair");
    expect(groupOf(result, "q1")?.memberIds.sort()).toEqual(["q1", "q2"]);
    expect(groupOf(result, "q1")?.formedVia).toBe("friend-match");
    expect(result.unmatchedIds).toEqual([]);
  });

  it("picks the closest-scoring partner among the leftovers", () => {
    // All three want women and none are present, so all three land in the friend pass. m1 and m3
    // score identically; m2 is far off and is the one left over.
    const result = computeGroups(
      [
        person("m1", "male", [50], ["female"]),
        person("m2", "male", [0], ["female"]),
        person("m3", "male", [50], ["female"]),
      ],
      { rng: () => 0 },
    );

    expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["m1", "m3"]);
    expect(result.unmatchedIds).toEqual(["m2"]);
  });

  it("someone with nobody left at all is honestly unmatched, never fabricated a partner", () => {
    const result = computeGroups([person("m1", "male", [50], ["female"])]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds).toEqual(["m1"]);
  });

  it("leaves nobody in the friend pass when two people share no comparable section", () => {
    // Disjoint sections => compatibility is null, so even the ungated pass can't pair them.
    const result = computeGroups([
      person("a", "male", [50, null, null, null], ["female"]),
      person("b", "male", [null, 50, null, null], ["female"]),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.unmatchedIds.sort()).toEqual(["a", "b"]);
  });
});

describe("computeGroups — exact-tie breaking", () => {
  // m1 scores 100 against f1 and 99.6 against f2 — both round to 100, so they are a genuine tie.
  // m2 is far off both and must never win round one.
  const m1 = person("m1", "male", [100], ["female"]);
  const m2 = person("m2", "male", [0], ["female"]);
  const f1 = person("f1", "female", [100], ["male"]);
  const f2 = person("f2", "female", [99.6], ["male"]);

  it("rng=0 picks the first of the tied candidates", () => {
    const result = computeGroups([m1, m2, f1, f2], { rng: () => 0 });
    expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["f1", "m1"]);
  });

  it("a different rng output picks the other tied candidate, proving randomization is real", () => {
    const result = computeGroups([m1, m2, f1, f2], { rng: () => 0.99 });
    expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["f2", "m1"]);
  });

  it("never picks a candidate whose score rounds lower, whatever the rng", () => {
    for (const rngValue of [0, 0.25, 0.5, 0.75, 0.99]) {
      const result = computeGroups([m1, m2, f1, f2], { rng: () => rngValue });
      expect(["f1", "f2"]).toContain(groupOf(result, "m1")?.memberIds.find((id) => id !== "m1"));
    }
  });

  it("a whole-point difference is not a tie — the higher score always wins", () => {
    // 100 vs 98 round to different integers, so f2 is never in the running for m1.
    const nearMiss = person("f2", "female", [98], ["male"]);
    for (const rngValue of [0, 0.5, 0.99]) {
      const result = computeGroups([m1, m2, f1, nearMiss], { rng: () => rngValue });
      expect(groupOf(result, "m1")?.memberIds.sort()).toEqual(["f1", "m1"]);
    }
  });
});

describe("computeGroups — determinism under reordered input", () => {
  it("is deterministic regardless of input order, given a fixed rng", () => {
    const people = [
      person("m1", "male", [90], ["female"]),
      person("m2", "male", [40], ["female"]),
      person("f1", "female", [88], ["male"]),
      person("f2", "female", [38], ["male"]),
    ];
    const forward = computeGroups(people, { rng: () => 0 });
    const backward = computeGroups([...people].reverse(), { rng: () => 0 });

    const asPairs = (r: ReturnType<typeof computeGroups>) =>
      new Set(r.groups.map((g) => [...g.memberIds].sort().join("|")));
    expect(asPairs(forward)).toEqual(asPairs(backward));
  });
});

