# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

"Between Us" — a Thai-language realtime Q&A and matching app for live events. A host creates a room of 1–10 scale questions; guests join by 6-digit PIN or QR on their phones, answer each question on a timer, and at the end each guest is shown the person or small group they matched with. All UI copy is Thai (`<html lang="th">`); keep new copy Thai too.

## Commands

```bash
npm run dev       # next dev (Turbopack) on :3000
npm run build
npm run start     # production server — see "one process" below
npm run lint      # eslint flat config
npm test          # vitest run
npx tsc --noEmit  # typecheck — NOT covered by lint, run it separately

npx vitest run lib/matching.test.ts   # single file
npx vitest run -t "leftover"          # tests whose name matches
npx vitest                            # watch mode
```

`.env.local` must define `HOST_SECRET` (the shared admin password, checked in `lib/rooms.ts`). Env files are gitignored.

Config files use `.mjs`/`.mts` (`vitest.config.mts`, `eslint.config.mjs`) because `package.json` has no `"type": "module"`. Imports use the `@/*` → repo-root alias.

If `node`/`npm` aren't on PATH, this machine manages Node with fnm — activate it first (`fnm env --shell powershell | Out-String | Invoke-Expression`, or prepend the fnm `node-versions/<ver>/installation` dir to PATH under bash).

## Architecture

### All state is in memory, in exactly one process

`lib/rooms.ts` holds `Map<pin, Room>` (plus login tokens and timers) pinned to `globalThis.__betweenUsRooms`; `lib/bus.ts` pins its SSE subscriber registry the same way. The `globalThis` pinning exists so dev HMR doesn't wipe live rooms.

There is deliberately **no database**. The load-bearing consequence: this must be deployed as **one long-running Node process** (`next start`) — never serverless or autoscaled, since a second instance would hold a different `Map` and see none of the first's rooms. A restart loses all rooms by design; recovery is the host recreating the room (`createRoom` accepts a `preferredPin` so the already-displayed PIN can be reused).

Sizing, measured at 150 participants: ~100 MB Next.js baseline + ~35 MB of base64 photos per live room. **512 MB of container RAM is comfortable, 256 MB is not** — and an OOM kill is not degradation, it destroys every live room at once.

### Rooms are reaped, and the CSV export is the only durable record

`sweepRooms(now = Date.now())` in `lib/rooms.ts` frees expired rooms on a lazily-armed 10-minute interval (`.unref()`'d, or a ten-minute timer would hold vitest open). Two windows, because the two cases differ:

- `ENDED_ROOM_TTL_MS` (1 h from `room.endedAt`, set by `endGame`) — a deliberate product choice, and the backstop for a host who never presses the ended screen's "เสร็จสิ้นและออกจากระบบ". Stragglers are still on the reveal screen submitting feedback, and the host still has to export.
- `ABANDONED_ROOM_TTL_MS` (6 h from `room.createdAt`) — **only for a room still in `"lobby"`**, i.e. one the host set up and never started. A room that has reached `"asking"` is deliberately exempt from every sweep: it is self-bounding (the sum of its remaining question durations is a hard upper bound), so it reaches `"ended"` on its own and the ended window takes over. Gating this on status is not cosmetic — measuring from `createdAt` regardless of status meant a room prepared hours before an event could be deleted *mid-game*, which is exactly what surfaced as a mysterious "ไม่พบห้องนี้" during a live quiz.

`now` is injectable for the same reason `computeGroups` takes an injectable `rng`: so tests assert the policy without waiting an hour.

The ended screen's exit button (`resetAndLogOut` in `app/admin/page.tsx`) ends the room, revokes the session via `POST /api/admin/logout`, and navigates to `/`. It does **not** free the room — players may still be on their reveal screens — so the sweep above is the only thing that ever deletes one. It also has a consequence worth knowing: `room.hostToken` is the token that was revoked, and logging back in mints a *different* `host_token`, so **after logout the room can never be exported again**, even while it is still in memory. That is why the download button sits above the exit button and the notice text tells the host to download before leaving.

**The ordering rule that governs all of this:** `room.matchResult` exists only as a property of an in-memory object, so `GET /api/admin/rooms/[pin]/export` (`lib/export.ts`, pure and testable) is the *only* way an event's results survive. Freeing must never precede the host's chance to download — shortening `ENDED_ROOM_TTL_MS` is how you would silently start destroying results. The same reasoning is why the CSV header carries each question's full text rather than "ข้อ 1": once the room is freed there is nothing left to look the questions up in.

`freeRoom` must clear the question timer, call `closeRoomStreams(pin)` (in `bus.ts` — the allowed `rooms.ts` → `bus.ts` direction) and drop the stale `activeRoomByToken` entry; missing any of those frees the `Room` while leaking whatever still referenced it. Creating a room **ends** the host's previous one and broadcasts, so its players reach their reveal rather than hanging — but leaves it resident, so an accidental re-create can't vaporize results before anyone exports them.

Because the export writes Thai text a host opens in Excel, `toCsv` emits a UTF-8 BOM and CRLF line endings, and guards every participant-typed cell against spreadsheet formula injection. Verify changes to it by *opening the file in Excel*, not by reading it in a terminal — a terminal looks fine either way and proves nothing.

### The quiz advances itself

There are no host controls during a question — no "next", no "end". A question ends one of two ways,
both funnelling through `advanceQuestion` in `lib/rooms.ts` (which also falls through to `endGame`
off the last question, so "the game ends itself" needs no separate handling):

- **`advanceIfComplete(room)`**, called by the answers route right after a successful `submitAnswer`,
  in the same synchronous tick. It advances the moment every participant has answered. Participant
  count and answers are read live, never snapshotted, which is what lets a mid-question joiner
  correctly hold the room back until they answer too.
- **`scheduleAutoAdvance`'s per-question timer**, unchanged, as the fallback. It is the only thing
  that rescues a room from someone who never submits at all — a closed or backgrounded tab runs no
  JS, so nothing auto-submits for them.

On the client, `QuestionForm`'s countdown auto-submits the slider's current value when it reaches
zero, so an idle-but-connected player records an answer (5 if untouched) instead of a `null`. The
re-entrancy guards there are **refs, not state**, because the tick closure is created once per
question and never re-captures state — and the "already submitted" ref is set on the manual path
too, or a manual submit just before the buzzer gets chased by a duplicate auto-submit.

`POST /api/admin/rooms/[pin]/advance` is kept but **dormant** — no UI calls it; it exists as a
host-only escape hatch for a stuck room mid-event.

### A dead room sends both roles to `/room-gone`

`app/room-gone/page.tsx` is a standalone page (outside both the `(play)` and admin layouts, since
neither a stored PIN nor a live stream exists by then). It shows the server's own Thai message from
`?message=`, so the copy can't drift from the API. Both `app/(play)/layout.tsx` and
`app/admin/page.tsx` redirect there on `stream.status === "fatal"`, the player clearing its stored
PIN first.

**The non-obvious part is how "fatal" is detected.** The stream route answers a missing room with a
404 that carries a `fatal` event in its body — but a browser discards the body of an EventSource
connection it failed, so that event never reaches the client. `useRoomStream` therefore also listens
for the native `error` event and treats **`readyState === CLOSED`** as fatal (CONNECTING means a
transient drop it should keep retrying — that reconnect is load-bearing, don't break it), then asks
`/api/rooms/[pin]/state` for the real reason. Without that listener a player with a dead PIN just
hangs on a spinner forever.

### Realtime is SSE, one endpoint, two roles

`app/api/rooms/[pin]/stream/route.ts` serves both host and player. Role is resolved server-side from cookies, not from a query param — so the client just opens `/api/rooms/${pin}/stream` and gets whichever payload it's entitled to. `lib/bus.ts` builds those payloads (`buildHostEvent` / `buildPlayerEvent`, typed as `HostEvent` / `PlayerEvent` in `lib/types.ts`).

- `broadcastRoom(room)` — immediate, for phase transitions.
- `scheduleRosterFlush(room)` — throttled leading+trailing, for joins and answer ticks.
- **Never put participant photos in a broadcast.** `Participant.photo` (a ~20KB base64 data URL) is server-only; snapshots carry a `photoUrl` pointing at `/api/rooms/[pin]/participants/[id]/photo?v=<photoVersion>`. Embedding them made the host roster ~2.9 MiB per snapshot at 150 participants; as URLs it is ~55 KiB.
- The stream sends a named `event: ping` heartbeat (not a `:` comment) so the client watchdog can actually observe liveness, plus an 8-minute self-cap that leans on EventSource auto-reconnect.

**Dependency direction is one-way and must stay that way:** `rooms.ts` imports `bus.ts` (its auto-advance timer broadcasts). `bus.ts` must never import `rooms.ts` — it depends only on the pure layer (`types.ts`, `matching.ts`, `sections.ts`).

### Auth is two opaque cookies

Both are httpOnly and are plain `crypto.randomUUID()` values — unsigned on purpose, because every request already does a stateful in-memory lookup to resolve them.

- `host_token` — admin session. Room *creation* only needs `isLoggedIn(token)`. Every route that acts as a room's host (`start`/`advance`/`end`/`export`, the host stream, the photo route's host branch, and `rooms/current`) goes through the single `isRoomHost(room, token)` check in `lib/rooms.ts`: a **live session** (`isLoggedIn`) that **owns the room** (`room.hostToken === token`). Both halves matter — the session half is what makes logout actually revoke (a token copied before logout stops working everywhere), the ownership half stops a valid session from driving someone else's room. Don't inline a `room.hostToken === token` comparison in a new route; that is exactly how these drifted apart before. `findRoomByHostToken` applies the same session check.
- `resume_token` — participant identity, resolved via `findParticipantByResumeToken`. Rejoining with an existing token **updates that participant in place** rather than creating a duplicate, which is what makes reconnects and a second tab safe.

The client never learns a room's PIN from a cookie, so `lib/client-store.ts` keeps it in `localStorage` (`betweenus:pin`), written by the join flow and read by the `(play)` layout.

### Phase transitions and timer safety

Everything in the "phase transitions" section of `lib/rooms.ts` is **fully synchronous — never add `await` there.** Combined with Node's single-threaded loop, that's what makes "host clicks Next at the exact moment the auto-timer fires" a non-issue.

Each transition bumps `room.generation`; the pending `setTimeout` captured the old value and no-ops when they differ, so the loser of that race can't double-advance. `endGame()` is idempotent by construction (`if (room.status === "ended") return`) — that guard, not luck, is what guarantees matching is computed exactly once.

Note `RoomStatus` includes `"reveal"`, but the flow currently goes `asking → ended` directly; the player-facing builder treats both as the reveal payload.

### Matching (`lib/matching.ts`)

Pure, no I/O, no framework imports — this is the testable core, and `lib/matching.test.ts` is where its edge cases are pinned down. Keep logic here, not in route handlers.

1. **Sections are fixed and explicit.** There are exactly four — `lifestyle`, `personality`, `values`, `relationships` — defined once in `lib/sections.ts` (a pure leaf with no imports, so both server and client can import it). Every `Question` carries its own `section`, so question order is purely presentational and a host can interleave sections freely. Never derive a section from position, and never add a fifth: `createRoomSchema` rejects unknown ids and requires all four to have at least one question.
2. **Scores**: answers 1–10 normalize to 0–100; a section score is the mean over *answered* questions only; a fully-skipped section is `null`, never coerced to 0. A participant who answered nothing has `overall === null` and is excluded from matching.
3. **Compatibility** = `100 - meanAbsDiff` over jointly-answered sections — honest 0–100 with no artificial floor. Zero joint sections yields `null` (a sentinel meaning "not comparable"), never `NaN`.
4. **Pairing is strictly 1-to-1** — `Group.memberIds` always holds exactly two ids. Each participant states one `sex` (`male`/`female`/`lgbtq_male`/`lgbtq_female`) and a **non-empty list** of `desiredSex` values (selecting all four is how "anyone" is expressed — there is no `any` sentinel). `computeGroups` runs two passes over the shared greedy helper `pairBySimilarity`:
   - **Pass 1, `primary-pair`**: gated by `mutuallyCompatible` — each side's list must contain the other's sex, checked both ways. There is deliberately **no minimum score**: a real consensual match outranks a higher-scoring one that ignores what someone asked for.
   - **Pass 2, `friend-match`**: whoever pass 1 couldn't place is re-paired on compatibility score alone, with the preference gate dropped, so an uneven mix of sexes doesn't strand people. This *is* a deviation from what those participants asked for, so it is never silent — the pair carries `formedVia: "friend-match"`, the reveal screen explains it in plain Thai, and the admin roster badges it "จับคู่แบบเพื่อน".
   
   Anyone unpaired after both passes lands in `unmatchedIds` and sees a genuine "unmatched" state. Never add a third tier.
5. Ties are **exact, not fuzzy**: only candidates whose score rounds to the same whole percent as the best are considered tied, and one is then picked via the injectable `rng` (so tests stay deterministic). Rounding rather than comparing raw floats both matches what the UI displays and absorbs float noise from the section-score averaging.

Server-side authority matters here: scores are always computed from stored answers, never accepted from a client.

### Client data flow

The `"asking"` `PlayerEvent` carries `question.section` and `question.isFirstInSection`, both computed server-side in `buildPlayerEvent` from the ordered question list. That flag drives the section-boundary slide (a `question-slide-in` keyframe in `globals.css`, applied only when it's true) and the "หมวดใหม่: …" pill — deriving it on the server is what keeps the client free of any "remember the previous render" state, which the `react-hooks/refs` and `react-hooks/set-state-in-effect` rules below would otherwise make awkward.

Free-text participant feedback (collected on the reveal screen, `POST /api/rooms/[pin]/feedback`) lives on `Participant.feedback`, entirely outside the `questions`/`answers` scoring pipeline — `answerSchema` is numeric-only and every `Question` must carry a section, so a text answer cannot ride along there. It reaches the host only on the `"ended"` snapshot, as `HostEvent.feedback`.

`app/(play)/layout.tsx` is the controller for all three player screens: it opens the single SSE subscription via `useRoomStream`, exposes the latest `PlayerEvent` through context (`usePlayEvent`), and routes by phase (`lobby → /waiting`, `asking` unanswered → `/question`, `asking` answered → `/waiting`, `reveal` → `/match`). Individual pages are presentational — they read context and POST; they don't own phase logic.

`app/admin/page.tsx` derives its whole view from `HostEvent` (there is no local phase state machine, and no mock data anywhere). On mount it probes `GET /api/admin/rooms/current`, which doubles as the "already logged in with a live room" check and the after-refresh restore path.

API routes under `app/api/**` stay thin: parse cookies, validate with a `lib/validation.ts` zod schema, delegate to `lib/rooms.ts`, broadcast, return. Errors are `{ error: { code, message } }` with `code` from the `ErrorCode` union and a Thai `message`.

## UI stack gotchas

- **shadcn/ui here is built on `@base-ui/react`, not Radix.** For polymorphic composition use `render={<Link href="..." />}` plus `nativeButton={false}` — there is no `asChild`. `components/ui/slider.tsx` renders a real hidden `<input type="range">` inside the thumb (useful for driving it in browser tests).
- **Tailwind v4, CSS-first.** Theme tokens live in `@theme` in `app/globals.css`; there is no `tailwind.config.js` to edit.
- Next.js 16 supplies global typed-route helpers (e.g. `LayoutProps<"/">`), and dynamic route `params` / `cookies()` are async — `await` them.
- `CardTitle` renders a `div`, not a heading — don't reach for `getByRole("heading")` on it in tests.

## Lint rules that will bite

`eslint-config-next` enforces the strict React hooks rules, and `npm run lint` fails on them:

- `react-hooks/set-state-in-effect` — no `setState` called *synchronously in an effect body*. Nesting it inside a callback the effect registers (`setInterval`, `setTimeout`, `.then()`, an event listener) is fine and is the pattern used throughout. To reset state when a prop changes, prefer remounting via `key=` (see `QuestionForm`) over an effect.
- `react-hooks/purity` — no `Date.now()` / `Math.random()` during render. Clock reads belong in interval/event callbacks; the question timer stores computed `secondsLeft` in state rather than deriving it at render time.
- `react-hooks/refs` — don't read or write `ref.current` during render.
