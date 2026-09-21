import { SECTION_COUNT, sectionIndex } from "@/lib/sections";
import type {
  DesiredSex,
  Group,
  MatchResult,
  PairwiseResult,
  Question,
  SectionScores,
  SectionScoreTuple,
  Sex,
} from "@/lib/types";

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
  desiredSex: DesiredSex;
  sectionScores: SectionScores;
};

/** Does `desired` accept someone whose actual sex is `actual`? "any" accepts everyone. */
export function acceptsSex(desired: DesiredSex, actual: Sex): boolean {
  return desired === "any" || desired === actual;
}

/** Both sides must accept the other. One-directional interest is never enough to group people. */
export function mutuallyCompatible(a: MatchableParticipant, b: MatchableParticipant): boolean {
  return acceptsSex(a.desiredSex, b.sex) && acceptsSex(b.desiredSex, a.sex);
}

/**
 * Group formation, driven entirely by mutual desired-sex compatibility — never by a hardcoded
 * "pair opposite sexes" rule. Two people are only ever placed together when each one's stated
 * preference accepts the other's sex, checked both ways, so an explicit preference is honored
 * rather than merely nudged.
 *
 * Uneven counts: leftovers join whichever existing group fits them best (breadth-first, smallest
 * group first, capped at MAX_GROUP_SIZE), but only groups where they are mutually compatible with
 * *every* current member — which keeps every formed group all-pairs-compatible by induction. That
 * matters concretely: the reveal screen shows each groupmate individually, so a group that wasn't
 * all-pairs-compatible would surface a preference-violating "match" to a real person.
 *
 * Anyone still unplaced is honestly `unmatched`. There is deliberately no fallback pairing tier:
 * once the primary pass halts, the survivors provably have zero mutually-compatible pairs among
 * themselves (the pass consumes the best compatible pair until none remains), so there is nothing
 * left to fall back to — only a fabricated, preference-violating match, which this app never makes.
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

  // Primary pairing: greedy over every mutually-compatible pair in one pool, highest
  // compatibility first, near-ties randomized. There are no sex buckets — eligibility comes
  // from the preference predicate alone, which is what lets any combination of identities and
  // preferences pair naturally instead of being forced through an opposite-sex template.
  const unpaired = [...activeAll];
  const groups: Group[] = [];

  while (unpaired.length >= 2) {
    let bestScore: number | null = null;
    for (let i = 0; i < unpaired.length; i++) {
      for (let j = i + 1; j < unpaired.length; j++) {
        if (!mutuallyCompatible(unpaired[i], unpaired[j])) continue;
        const score = compatibilityBetween(unpaired[i].id, unpaired[j].id);
        if (score !== null && (bestScore === null || score > bestScore)) bestScore = score;
      }
    }
    // Nobody left is both mutually compatible and score-comparable with anybody else.
    if (bestScore === null) break;

    const tier: [number, number][] = [];
    for (let i = 0; i < unpaired.length; i++) {
      for (let j = i + 1; j < unpaired.length; j++) {
        if (!mutuallyCompatible(unpaired[i], unpaired[j])) continue;
        const score = compatibilityBetween(unpaired[i].id, unpaired[j].id);
        if (score !== null && score >= bestScore - TIE_TOLERANCE) tier.push([i, j]);
      }
    }
    const [i, j] = uniformRandom(tier);
    groups.push({
      id: crypto.randomUUID(),
      memberIds: [unpaired[i].id, unpaired[j].id],
      formedVia: "primary-pair",
    });
    const hi = Math.max(i, j);
    const lo = Math.min(i, j);
    unpaired.splice(hi, 1);
    unpaired.splice(lo, 1);
  }

  // Leftover assignment: whoever didn't get a primary pair. Recomputed fresh every round (not
  // assigned to a fixed target up front) so a leftover can end up preferring an already-grown
  // group over a fresh pair.
  let leftovers = unpaired;

  function fitToGroup(leftoverId: string, group: Group): number | null {
    const leftover = byId.get(leftoverId)!;
    // Hard reject: one incompatible member disqualifies the whole group for this leftover.
    // Deliberately not folded into the null-filter below — that filter is about *missing
    // scores*, which is a different thing from a *forbidden pairing*. Dropping an incompatible
    // member from the average instead of rejecting outright would quietly place someone in a
    // group with a person their preference excludes.
    if (group.memberIds.some((memberId) => !mutuallyCompatible(leftover, byId.get(memberId)!))) {
      return null;
    }
    const values = group.memberIds
      .map((memberId) => compatibilityBetween(leftoverId, memberId))
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  while (leftovers.length > 0) {
    const eligible = groups.filter((g) => g.memberIds.length < MAX_GROUP_SIZE);
    if (eligible.length === 0) break;

    // Breadth-first: fill the smallest groups first, so leftovers spread across the
    // available pairs instead of piling into whichever one happened to win the first
    // tie. Widen to larger groups only when nobody in this cohort is comparable —
    // otherwise an incomparable small group would strand a placeable leftover.
    const sizes = [...new Set(eligible.map((g) => g.memberIds.length))].sort((a, b) => a - b);
    let cohort: Group[] = [];
    let bestFit: number | null = null;
    for (const size of sizes) {
      cohort = eligible.filter((g) => g.memberIds.length === size);
      bestFit = null;
      for (const l of leftovers) {
        for (const g of cohort) {
          const fit = fitToGroup(l.id, g);
          if (fit !== null && (bestFit === null || fit > bestFit)) bestFit = fit;
        }
      }
      if (bestFit !== null) break;
    }
    if (bestFit === null) break; // nothing placeable at any size

    const tier: [MatchableParticipant, Group][] = [];
    for (const l of leftovers) {
      for (const g of cohort) {
        const fit = fitToGroup(l.id, g);
        if (fit !== null && fit >= bestFit - TIE_TOLERANCE) tier.push([l, g]);
      }
    }
    const [l, g] = uniformRandom(tier);
    g.memberIds.push(l.id);
    g.formedVia = "leftover-join";
    leftovers = leftovers.filter((p) => p.id !== l.id);
  }

  // Residual: every eligible group was full, incompatible, or incomparable. By construction the
  // primary pass already consumed every mutually-compatible pair it could, so these people have
  // no compatible partner left among themselves either — the honest outcome is "unmatched", not
  // a fabricated pairing that ignores what they asked for.
  unmatchedIds.push(...leftovers.map((p) => p.id));

  return { groups, unmatchedIds, computedAt };
}
