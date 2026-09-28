import { SECTION_COUNT, sectionIndex } from "@/lib/sections";
import type {
  DesiredSex,
  Group,
  GroupOrigin,
  MatchResult,
  PairwiseResult,
  Question,
  SectionScores,
  SectionScoreTuple,
  Sex,
} from "@/lib/types";


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

/** Both sides must accept the other. One-directional interest is never enough to pair people. */
export function mutuallyCompatible(a: MatchableParticipant, b: MatchableParticipant): boolean {
  return a.desiredSex.includes(b.sex) && b.desiredSex.includes(a.sex);
}

/**
 * Greedy 1-to-1 pairing over a pool. Each round takes the highest-scoring remaining pair (subject
 * to `eligible`, when given) and removes both people.
 *
 * Ties are *exact*, not fuzzy: only candidates whose score rounds to the same whole percent as the
 * best are considered tied, and one of those is picked uniformly at random. Rounding — rather than
 * comparing raw floats — matches what the UI actually displays and absorbs the float noise that
 * the section-score averaging chain would otherwise leak into equality checks.
 */
function pairBySimilarity(
  pool: MatchableParticipant[],
  compatibilityBetween: (idA: string, idB: string) => number | null,
  rng: () => number,
  eligible: ((a: MatchableParticipant, b: MatchableParticipant) => boolean) | null,
  formedVia: GroupOrigin,
): { groups: Group[]; leftover: MatchableParticipant[] } {
  const remaining = [...pool];
  const groups: Group[] = [];

  while (remaining.length >= 2) {
    let bestScore: number | null = null;
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        if (eligible && !eligible(remaining[i], remaining[j])) continue;
        const score = compatibilityBetween(remaining[i].id, remaining[j].id);
        if (score !== null && (bestScore === null || score > bestScore)) bestScore = score;
      }
    }
    // Nobody left is both eligible and score-comparable with anybody else.
    if (bestScore === null) break;

    const bestRounded = Math.round(bestScore);
    const tier: [number, number][] = [];
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        if (eligible && !eligible(remaining[i], remaining[j])) continue;
        const score = compatibilityBetween(remaining[i].id, remaining[j].id);
        if (score !== null && Math.round(score) === bestRounded) tier.push([i, j]);
      }
    }

    const [i, j] = tier[Math.min(Math.floor(rng() * tier.length), tier.length - 1)];
    groups.push({
      id: crypto.randomUUID(),
      memberIds: [remaining[i].id, remaining[j].id],
      formedVia,
    });
    const hi = Math.max(i, j);
    const lo = Math.min(i, j);
    remaining.splice(hi, 1);
    remaining.splice(lo, 1);
  }

  return { groups, leftover: remaining };
}

/**
 * Pairing runs in two passes, and everything it produces is strictly 1-to-1.
 *
 * Pass 1 ("primary") is gated by mutual desired-sex compatibility: two people are only paired when
 * each one's stated preference accepts the other's sex, checked both ways. There is deliberately
 * no minimum score here — a real, consensual match outranks a higher-scoring one that ignores what
 * someone actually asked for, however lukewarm the fit.
 *
 * Pass 2 ("friend match") exists because an uneven mix of sexes and preferences would otherwise
 * strand people who could still enjoy meeting someone. Whoever pass 1 couldn't place is re-paired
 * on compatibility score alone, with the preference gate dropped entirely. That is a real deviation
 * from what those participants asked for, so it is never silent: the pair carries
 * `formedVia: "friend-match"` and the reveal screen tells them plainly why.
 *
 * Anyone still unpaired after both passes — an odd one out, or someone with nobody comparable —
 * is honestly `unmatched`. No third tier, nothing fabricated.
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

  const primary = pairBySimilarity(activeAll, compatibilityBetween, rng, mutuallyCompatible, "primary-pair");

  // Whoever pass 1 couldn't place: re-paired on score alone, preference gate dropped. By
  // construction these people share no mutually-compatible pair among themselves, so this is the
  // only remaining way to give them anyone at all — and it's disclosed, not silent.
  const friend = pairBySimilarity(primary.leftover, compatibilityBetween, rng, null, "friend-match");

  unmatchedIds.push(...friend.leftover.map((p) => p.id));

  return { groups: [...primary.groups, ...friend.groups], unmatchedIds, computedAt };
}
