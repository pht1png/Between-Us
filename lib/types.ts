import type { SectionId } from "@/lib/sections";

export type Sex = "male" | "female";

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
  photo: string | null; // data URL, or null if capture failed/declined. Server-only — never
  // serialized into a broadcast; clients fetch it from the participant photo route instead.
  photoVersion: number; // bumped whenever `photo` changes, so cached photo URLs can't go stale
  answers: (number | null)[]; // indexed by question index, length === questions.length
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

export type GroupOrigin = "primary-pair" | "leftover-join" | "same-sex-fallback";

export type Group = {
  id: string;
  memberIds: string[]; // length >= 2
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
};

// ---- Per-participant reveal view (built at the API/bus layer, never stored) ----

export type GroupmateView = {
  id: string;
  name: string;
  bio: string;
  photoUrl: string | null; // route URL, not a data URL — keeps payloads small
  compatibility: number; // non-null by construction
  reason: string; // pre-rendered Thai sentence from PairwiseResult.reasonSectionIndex
};

export type RevealView = { status: "matched"; groupmates: GroupmateView[] } | { status: "unmatched" };

export type HostParticipantView = Pick<Participant, "id" | "name" | "bio" | "sex"> & {
  photoUrl: string | null; // route URL — embedding data URLs here made the roster broadcast
  // ~2.9 MiB at 150 participants, which is what exhausted the heap during a question burst.
  answered: boolean; // answers[currentIndex] != null — derived, never stored
};

export type HostGroupView = {
  memberNames: string[];
  formedVia: GroupOrigin;
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
      question: { index: number; total: number; text: string };
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
    };
