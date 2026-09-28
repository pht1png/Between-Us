import type { SectionId } from "@/lib/sections";

export type Sex = "male" | "female" | "lgbtq_male" | "lgbtq_female";

/** Who a participant wants to be matched with — a non-empty, multi-select subset of `Sex`.
 * Selecting all four values is how "anyone" is expressed; there is no separate "any" sentinel. */
export type DesiredSex = Sex[];

export type Question = {
  id: string;
  text: string;
  duration: number; // seconds, clamped [5, 300] server-side
  section: SectionId; // explicit, host-assigned — never derived from position
};

export type RoomStatus = "lobby" | "asking" | "reveal" | "ended";

export type Participant = {
  id: string;
  resumeToken: string; // server-only, never serialized to any client payload
  name: string;
  bio: string;
  sex: Sex;
  desiredSex: DesiredSex; // server-only — feeds matching, never serialized to the host
  photo: string | null; // large "card" data URL, or null if capture failed/declined. Server-only
  // — never serialized into a broadcast; clients fetch it from the participant photo route instead.
  photoThumb: string | null; // small data URL, compressed separately — admin roster only
  photoVersion: number; // bumped whenever `photo`/`photoThumb` change, so cached URLs can't go stale
  answers: (number | null)[]; // indexed by question index, length === questions.length
  feedback: string | null; // free text from the reveal screen; outside the scored answers pipeline
  lastSeen: number;
};

// ---- Matching engine types (lib/matching.ts owns the logic, these are the shared shapes) ----

/** Always exactly four entries, indexed by SECTION_IDS order — a wrong-length value can't compile. */
export type SectionScoreTuple = [number | null, number | null, number | null, number | null];

export type SectionScores = {
  bySectionIndex: SectionScoreTuple;
  overall: number | null; // mean of non-null section scores; null = zero answers anywhere
};

export type PairwiseResult = {
  compatibility: number | null; // 0-100, null = zero comparable sections between this pair
  reasonSectionIndex: number | null;
};

/** How a pair came about. `friend-match` means the preference gate was deliberately ignored
 * because that person would otherwise have been left over — always disclosed, never silent. */
export type GroupOrigin = "primary-pair" | "friend-match";

export type Group = {
  id: string;
  memberIds: string[]; // always exactly 2 — matching is strictly 1-to-1
  formedVia: GroupOrigin;
};

export type MatchResult = {
  groups: Group[];
  unmatchedIds: string[]; // zero-answer participants + genuinely unplaceable residuals
  computedAt: number;
};

export type Room = {
  pin: string;
  hostToken: string;
  status: RoomStatus;
  questions: Question[];
  currentIndex: number;
  questionEndsAt: number | null;
  generation: number; // guards stale timer callbacks
  participants: Map<string, Participant>;
  sectionScores: Map<string, SectionScores> | null; // computed once, at "ended"
  matchResult: MatchResult | null; // computed once, at "ended"
  createdAt: number;
  /** Set once, by endGame(). The reaper needs "when did this finish" separately from "when was
   * this created": a room the host abandoned mid-game has only the latter, and the two get
   * different retention windows. */
  endedAt: number | null;
};

// ---- Per-participant reveal view (built at the API/bus layer, never stored) ----

export type GroupmateView = {
  id: string;
  name: string;
  bio: string;
  sex: Sex;
  photoUrl: string | null; // route URL, not a data URL — keeps payloads small
  compatibility: number; // non-null by construction
  reason: string; // pre-rendered Thai sentence from PairwiseResult.reasonSectionIndex
};

export type RevealView =
  | {
      status: "matched";
      /** "friend" means this pair ignored the desired-sex preference so the participant wasn't
       * left out of an uneven room — the reveal screen must say so plainly. */
      kind: "primary" | "friend";
      groupmate: GroupmateView;
    }
  | { status: "unmatched" };

export type HostParticipantView = Pick<Participant, "id" | "name" | "bio" | "sex"> & {
  photoUrl: string | null; // route URL — embedding data URLs here made the roster broadcast
  // ~2.9 MiB at 150 participants, which is what exhausted the heap during a question burst.
  answered: boolean; // answers[currentIndex] != null — derived, never stored
};

export type HostGroupView = {
  memberNames: string[];
  formedVia: GroupOrigin;
};

/** Post-game free text, shown to the host only on the "ended" snapshot. Deliberately not part of
 * `HostParticipantView` — it is not roster metadata and does not exist before the reveal. */
export type HostFeedbackView = {
  participantId: string;
  name: string;
  feedback: string;
};

export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_ENDED"
  | "PARTICIPANT_NOT_FOUND"
  | "ROOM_FULL"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "QUESTION_CLOSED";

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;
    /** Field paths that failed validation — names only, never values, so this is safe to
     * return to a client. Present only on VALIDATION_ERROR. */
    fields?: string[];
  };
};

/** Player-role SSE snapshot. */
export type PlayerEvent =
  | { type: "lobby"; serverNow: number; pin: string }
  | {
      type: "asking";
      serverNow: number;
      question: {
        index: number;
        total: number;
        text: string;
        section: SectionId;
        /** True when this question opens a new section (or is the very first question).
         * Computed server-side from the ordered question list so the client never has to
         * remember the previous render to detect a section boundary. */
        isFirstInSection: boolean;
      };
      endsAt: number;
      yourAnswer: number | null;
      answeredCount: number;
      totalParticipants: number;
    }
  | { type: "reveal"; serverNow: number; reveal: RevealView };

/** Host-role SSE snapshot. */
export type HostEvent =
  | { type: "lobby"; serverNow: number; pin: string; participants: HostParticipantView[] }
  | {
      type: "asking";
      serverNow: number;
      pin: string;
      currentIndex: number;
      totalQuestions: number;
      question: { text: string; duration: number };
      endsAt: number;
      participants: HostParticipantView[];
      distribution: number[]; // length 10, bucket counts for values 1..10
    }
  | {
      type: "ended";
      serverNow: number;
      pin: string;
      participants: HostParticipantView[];
      groups: HostGroupView[];
      feedback: HostFeedbackView[];
    };
