import { SECTION_COUNT, sectionIndex } from "@/lib/sections";
import type { Group, MatchResult, PairwiseResult, Question, SectionScores, SectionScoreTuple, Sex } from "@/lib/types";

export const TIE_TOLERANCE = 2;
export const MAX_GROUP_SIZE = 4;

/**
 * Per-section 0-100 scores for one participant.
 *
 * Each question carries its own section, so question order is purely presentational — a host can
 * interleave sections freely and scoring is unaffected. Answers are normalized 1..10 -> 0..100 and
 * averaged within a section over *answered* questions only; a section with no answers (whether the
 * participant skipped them all, or the host wrote no questions for it) stays null rather than
 * collapsing to 0, which would falsely read as "answered at the bottom of the scale".
 */
export function computeSectionScores(
  answers: (number | null)[],
  questions: Pick<Question, "section">[],
): SectionScores {
  const sums = Array<number>(SECTION_COUNT).fill(0);
  const counts = Array<number>(SECTION_COUNT).fill(0);

  for (let i = 0; i < questions.length; i++) {
    const answer = answers[i];
    if (answer == null) continue;
    const section = sectionIndex(questions[i].section);
    sums[section] += ((answer - 1) / 9) * 100; // 1..10 -> 0..100
    counts[section] += 1;
  }

  const bySectionIndex = sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : null)) as SectionScoreTuple;
  const present = bySectionIndex.filter((s): s is number => s !== null);
  const overall = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
  return { bySectionIndex, overall };
}

export function computePairwiseCompatibility(a: SectionScores, b: SectionScores): PairwiseResult {
  const jointIndices: number[] = [];
  const diffs: number[] = [];

  for (let i = 0; i < SECTION_COUNT; i++) {
    const av = a.bySectionIndex[i];
    const bv = b.bySectionIndex[i];
    if (av != null && bv != null) {
      jointIndices.push(i);
      diffs.push(Math.abs(av - bv));
    }
  }

  if (diffs.length === 0) {
    return { compatibility: null, reasonSectionIndex: null }; // sentinel, never NaN
  }

  const meanDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const compatibility = 100 - meanDiff;

  let bestIdx = 0;
  for (let k = 1; k < diffs.length; k++) {
    if (diffs[k] < diffs[bestIdx]) bestIdx = k;
  }
  return { compatibility, reasonSectionIndex: jointIndices[bestIdx] };
}

export type MatchableParticipant = {
  id: string;
  sex: Sex;
  sectionScores: SectionScores;
};

/**
 * Group formation. Male-female pairing is the default, non-optional behavior — the sex field
 * exists specifically so this can happen. Uneven counts: leftover (surplus-sex) participants
 * join whichever existing pair fits them best, growing it into a trio/quartet, rather than
 * being left unmatched or force-paired same-sex with each other. Only once every eligible
 * group hits MAX_GROUP_SIZE (or a room is provably one sex only) does a same-sex fallback
 * happen — and that fallback is always reported via `formedVia`, never silent.
 */
export function computeGroups(participants: MatchableParticipant[], options: { rng?: () => number } = {}): MatchResult {
  const rng = options.rng ?? Math.random;
  const computedAt = Date.now();

  const activeAll = participants.filter((p) => p.sectionScores.overall !== null);
  const unmatchedIds = participants.filter((p) => p.sectionScores.overall === null).map((p) => p.id);

  if (activeAll.length === 0) {
    return { groups: [], unmatchedIds, computedAt };
  }
  if (activeAll.length === 1) {
    return { groups: [], unmatchedIds: [...unmatchedIds, activeAll[0].id], computedAt };
  }

  const byId = new Map(activeAll.map((p) => [p.id, p]));

  function compatibilityBetween(idA: string, idB: string): number | null {
    return computePairwiseCompatibility(byId.get(idA)!.sectionScores, byId.get(idB)!.sectionScores).compatibility;
  }

  function uniformRandom<T>(items: T[]): T {
    const index = Math.min(Math.floor(rng() * items.length), items.length - 1);
    return items[index];
  }

  // Greedy similarity pairing over an arbitrary pool, sex-agnostic. Used for every same-sex
  // fallback trigger (whole-room single-sex, zero comparable cross-sex pairs, cap-exhaustion
  // residuals) — one rule, three call sites. Always reports whatever it couldn't pair as
  // `leftoverIds`, regardless of *why* the loop stopped (ran out of people, or ran out of
  // anyone comparable) — a pool of 3+ mutually-incomparable people must not silently vanish.
  function pairBySimilarity(pool: MatchableParticipant[]): { groups: Group[]; leftoverIds: string[] } {
    const remaining = [...pool];
    const groups: Group[] = [];

    while (remaining.length >= 2) {
      let bestScore: number | null = null;
      for (let i = 0; i < remaining.length; i++) {
        for (let j = i + 1; j < remaining.length; j++) {
          const score = compatibilityBetween(remaining[i].id, remaining[j].id);
          if (score !== null && (bestScore === null || score > bestScore)) bestScore = score;
        }
      }
      if (bestScore === null) break; // nobody left is comparable to anybody else

      const tier: [number, number][] = [];
      for (let i = 0; i < remaining.length; i++) {
        for (let j = i + 1; j < remaining.length; j++) {
          const score = compatibilityBetween(remaining[i].id, remaining[j].id);
          if (score !== null && score >= bestScore - TIE_TOLERANCE) tier.push([i, j]);
        }
      }
      const [i, j] = uniformRandom(tier);
      groups.push({
        id: crypto.randomUUID(),
        memberIds: [remaining[i].id, remaining[j].id],
        formedVia: "same-sex-fallback",
      });
      const hi = Math.max(i, j);
      const lo = Math.min(i, j);
      remaining.splice(hi, 1);
      remaining.splice(lo, 1);
    }

    return { groups, leftoverIds: remaining.map((p) => p.id) };
  }

  const males = activeAll.filter((p) => p.sex === "male");
  const females = activeAll.filter((p) => p.sex === "female");

  // Degenerate: room is provably one sex only. Not the "silent unexpected same-sex match"
  // failure mode — there is no alternative being suppressed, so this must simply be labeled
  // honestly by the caller, not treated as a bug.
  if (males.length === 0 || females.length === 0) {
    const { groups, leftoverIds } = pairBySimilarity(activeAll);
    return { groups, unmatchedIds: [...unmatchedIds, ...leftoverIds], computedAt };
  }

  // Primary greedy male<->female pairing, highest compatibility first, near-ties randomized.
  const unpairedM = [...males];
  const unpairedF = [...females];
  const groups: Group[] = [];

  while (unpairedM.length > 0 && unpairedF.length > 0) {
    let bestScore: number | null = null;
    for (const m of unpairedM) {
      for (const f of unpairedF) {
        const score = compatibilityBetween(m.id, f.id);
        if (score !== null && (bestScore === null || score > bestScore)) bestScore = score;
      }
    }
    if (bestScore === null) break; // no comparable cross-sex pair remains

    const tier: [MatchableParticipant, MatchableParticipant][] = [];
    for (const m of unpairedM) {
      for (const f of unpairedF) {
        const score = compatibilityBetween(m.id, f.id);
        if (score !== null && score >= bestScore - TIE_TOLERANCE) tier.push([m, f]);
      }
    }
    const [m, f] = uniformRandom(tier);
    groups.push({ id: crypto.randomUUID(), memberIds: [m.id, f.id], formedVia: "primary-pair" });
    unpairedM.splice(unpairedM.indexOf(m), 1);
    unpairedF.splice(unpairedF.indexOf(f), 1);
  }

  if (groups.length === 0) {
    // Both sexes present, but zero cross-sex pair had any comparable section at all.
    const { groups: fallbackGroups, leftoverIds } = pairBySimilarity(activeAll);
    return { groups: fallbackGroups, unmatchedIds: [...unmatchedIds, ...leftoverIds], computedAt };
  }

  // Leftover assignment: surplus-sex participants who didn't get a primary pair. Recomputed
  // fresh every round (not assigned to a fixed target up front) so a leftover can end up
  // preferring an already-grown group over a fresh pair.
  let leftovers = [...unpairedM, ...unpairedF];

  function fitToGroup(leftoverId: string, group: Group): number | null {
    const values = group.memberIds
      .map((memberId) => compatibilityBetween(leftoverId, memberId))
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  while (leftovers.length > 0) {
    const eligibleGroups = groups.filter((g) => g.memberIds.length < MAX_GROUP_SIZE);
    let bestFit: number | null = null;
    for (const l of leftovers) {
      for (const g of eligibleGroups) {
        const fit = fitToGroup(l.id, g);
        if (fit !== null && (bestFit === null || fit > bestFit)) bestFit = fit;
      }
    }
    if (bestFit === null) break; // no eligible group left, or none comparable

    const tier: [MatchableParticipant, Group][] = [];
    for (const l of leftovers) {
      for (const g of eligibleGroups) {
        const fit = fitToGroup(l.id, g);
        if (fit !== null && fit >= bestFit - TIE_TOLERANCE) tier.push([l, g]);
      }
    }
    const [l, g] = uniformRandom(tier);
    g.memberIds.push(l.id);
    g.formedVia = "leftover-join";
    leftovers = leftovers.filter((p) => p.id !== l.id);
  }

  if (leftovers.length > 0) {
    // Residual: every eligible group hit MAX_GROUP_SIZE, or none were comparable. These are
    // all the surplus sex by construction, so pairing them among themselves is a genuine
    // same-sex fallback — labeled, not silent.
    const { groups: residualGroups, leftoverIds } = pairBySimilarity(leftovers);
    groups.push(...residualGroups);
    unmatchedIds.push(...leftoverIds);
  }

  return { groups, unmatchedIds, computedAt };
}
