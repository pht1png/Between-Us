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

### Realtime is SSE, one endpoint, two roles

`app/api/rooms/[pin]/stream/route.ts` serves both host and player. Role is resolved server-side from cookies, not from a query param — so the client just opens `/api/rooms/${pin}/stream` and gets whichever payload it's entitled to. `lib/bus.ts` builds those payloads (`buildHostEvent` / `buildPlayerEvent`, typed as `HostEvent` / `PlayerEvent` in `lib/types.ts`).

- `broadcastRoom(room)` — immediate, for phase transitions.
- `scheduleRosterFlush(room)` — throttled leading+trailing, for joins and answer ticks.
- **Never put participant photos in a broadcast.** `Participant.photo` (a ~20KB base64 data URL) is server-only; snapshots carry a `photoUrl` pointing at `/api/rooms/[pin]/participants/[id]/photo?v=<photoVersion>`. Embedding them made the host roster ~2.9 MiB per snapshot at 150 participants; as URLs it is ~55 KiB.
- The stream sends a named `event: ping` heartbeat (not a `:` comment) so the client watchdog can actually observe liveness, plus an 8-minute self-cap that leans on EventSource auto-reconnect.

**Dependency direction is one-way and must stay that way:** `rooms.ts` imports `bus.ts` (its auto-advance timer broadcasts). `bus.ts` must never import `rooms.ts` — it depends only on the pure layer (`types.ts`, `matching.ts`, `sections.ts`).

### Auth is two opaque cookies

Both are httpOnly and are plain `crypto.randomUUID()` values — unsigned on purpose, because every request already does a stateful in-memory lookup to resolve them.

- `host_token` — admin session. Room *creation* only needs `isLoggedIn(token)`; the per-room routes (`start`/`advance`/`end`) additionally require `room.hostToken === token`, so a valid session can't drive someone else's room.
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
4. **Grouping** (`computeGroups`): greedy male–female pairing first, then leftovers from the surplus sex join the existing group they best fit (capped by `MAX_GROUP_SIZE`), then any true residual — or an all-one-sex room — falls back to same-sex pairing via the shared `pairBySimilarity` helper. Every group carries `formedVia`, and the UI must keep surfacing non-`primary-pair` groups as such (the "จับคู่พิเศษ" badge); silently passing a fallback off as a normal match is a product bug.
5. Near-ties within `TIE_TOLERANCE` are broken by `rng` (injectable, so tests are deterministic). Anyone unplaceable lands in `unmatchedIds` and sees a genuine "unmatched" state — never a fabricated match.

Server-side authority matters here: scores are always computed from stored answers, never accepted from a client.

### Client data flow

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
