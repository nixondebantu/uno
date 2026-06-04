# Plan — Real-Time Multiplayer UNO (Browser, Docker)

## Context

Build full v1 of Classic UNO per `docs/UNO_Multiplayer_PRD.md`, audited against the official ruleset at https://www.unorules.com/. Target: 2–12 players, single Docker container, ngrok-shareable, in-memory state, server-authoritative rules. Repo is empty (only PRDs in `docs/`). Work is split into phases, executed by subagents in sequence with parallel fan-out within phases. A `PROGRESS.md` checkpoint file at repo root lets any agent (or a fresh session after interruption) resume cleanly.

## Rules audit vs unorules.com (Classic)

| Topic | Official rule (unorules.com) | PRD says | Plan resolution |
|---|---|---|---|
| Deck | 108 cards: 76 number + 24 action (2/color × 3) + 4 Wild + 4 W4 | Same | Match official exactly |
| Player count | 2–10 | 2–12 | **House extension to 12.** Deck still fits (12×7=84 dealt, 24 remain). Document in README. |
| Hand size | 7 | 7 | ✓ |
| Direction | Clockwise default | Same | ✓ |
| Legal play | Match color, number, or symbol; or Wild | Same | ✓ |
| Wild | Player declares color | Same | ✓ |
| Wild Draw 4 legality | Only legal if W4 holder has no matching-color card to current top | PRD §12 references via challenge | **Engine never blocks W4 play; legality is decided by challenge outcome.** |
| W4 challenge | Challenger wins → W4 player draws 4. Challenge fails → challenger draws 6 (= 4 + 2 penalty) | Same | ✓ — engine validates by inspecting W4 player's hand against **previous** current color (not the chosen new color) |
| Stacking Draw 2/Draw 4 | **Prohibited** in Classic | Not in v1 (v2 No Mercy) | ✓ no stacking in v1 engine |
| Jump-in | Not in official Classic | Not in v1 | ✓ excluded |
| UNO call | Must yell "UNO" the moment you have 1 card left | "Second-to-last card, before/at the moment of playing" | Same event — when you play your penultimate card, you go to 1 card. ✓ |
| UNO catch window | Until next player has taken their turn (played or drawn) | Fixed 2-second window | **Fix: align to official.** Window opens when player goes to 1 card, closes when the next player takes any action (play/draw). 2s timeout is the absolute upper bound only if the next player is idle/disconnected. |
| UNO penalty | Draw 2 | Draw 2 | ✓ |
| Starting card = action | Effect applies to first player | Same | ✓ — Skip skips first player; Reverse flips direction (with 2 players, acts as Skip); Draw 2 first player draws 2 + skips |
| Starting card = Wild | First player chooses color | Same | ✓ |
| Starting card = W4 | Re-bury, draw new starting card | Same | ✓ |
| Reverse with 2 players | Acts as Skip | Same | ✓ |
| Draw pile empty | Shuffle discard (except top) → new draw pile | Same | ✓ |
| Win round | First to empty hand | Same | ✓ |
| Scoring | Numbers face value; Skip/Reverse/Draw2 = 20; Wild/W4 = 50 | Same | ✓ |
| Points to win | Default 500 | Default 500 (configurable) | ✓ |

**Online-specific extensions** (not in official rules, justified by remote multiplayer context):
- Turn timer (host-configurable; 30s default)
- Reconnection grace periods
- Spectator mode
- Custom 5s W4 challenge prompt window (otherwise it would block forever)
- Host setting to disable W4 challenge (per PRD §7.1.3)

## Decisions (locked from clarifying Q&A)

| Area | Choice |
|---|---|
| Stack | TS everywhere — Node + Socket.io server, Vite + Preact + signals client, shared types package |
| Tests | Vitest unit tests on engine only; manual QA for UI/socket |
| Progress tracking | `PROGRESS.md` markdown checkpoint at repo root |
| Orchestration | Phase-sequential, parallel within phase, main thread coordinates |
| UNO catch race | First server-received catch within window wins |
| Wild Draw 4 | Challenge mechanic implemented, configurable in host settings |
| Reconnect | Opaque `playerToken` in localStorage, server-side seat reservation |
| Mobile | Responsive down to 375px |
| Assets | No images — icons via lucide-icons; custom inline SVG for cards |

## Repo layout

```
uno/
├── Dockerfile
├── docker-compose.yml
├── package.json              (workspace root)
├── pnpm-workspace.yaml
├── PROGRESS.md               ← checkpoint, updated each agent run
├── plan/
│   └── BUILD_PLAN.md         ← copy of this plan (added post plan-mode exit)
├── shared/
│   ├── package.json
│   └── src/
│       ├── cards.ts          (Card, Color, CardType, deck factory)
│       ├── events.ts         (socket event name constants + payload types)
│       └── state.ts          (Room, Player, GameState, public/private split)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          (Express boot + Socket.io wiring)
│   │   ├── roomManager.ts    (room CRUD, code gen, lifecycle, host transfer)
│   │   ├── gameEngine.ts     (pure rules — deck, deal, play, draw, scoring)
│   │   ├── turnController.ts (timer, auto-draw, turn advancement, deadlock guards)
│   │   ├── unoCallTracker.ts (UNO-call window, catch race resolution)
│   │   ├── sockets.ts        (event handlers, validation, broadcast helpers)
│   │   ├── reconnect.ts      (playerToken issue/verify, seat reservation)
│   │   └── util/
│   │       ├── shuffle.ts    (Fisher–Yates, deterministic with injected seed)
│   │       └── logger.ts
│   └── test/
│       ├── deck.test.ts
│       ├── gameEngine.test.ts
│       ├── turnController.test.ts
│       ├── unoCallTracker.test.ts
│       └── scoring.test.ts
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── socket.ts         (Socket.io client, reconnect logic)
    │   ├── store.ts          (Preact signals — roomState, hand, ui)
    │   ├── screens/
    │   │   ├── Home.tsx
    │   │   ├── Lobby.tsx
    │   │   ├── Game.tsx
    │   │   ├── RoundEnd.tsx
    │   │   └── MatchEnd.tsx
    │   ├── components/
    │   │   ├── Card.tsx              (inline SVG renderer)
    │   │   ├── Hand.tsx
    │   │   ├── DiscardPile.tsx
    │   │   ├── DrawPile.tsx
    │   │   ├── OpponentRow.tsx
    │   │   ├── PlayerAvatar.tsx      (lucide icon + color ring)
    │   │   ├── TurnTimerRing.tsx     (SVG circular countdown, server-synced)
    │   │   ├── ColorChooser.tsx
    │   │   ├── ChallengePrompt.tsx
    │   │   └── UnoButton.tsx
    │   ├── assets/
    │   │   └── cardSvg.ts            (programmatic SVG per card type/color)
    │   └── styles/
    │       ├── global.css
    │       └── tokens.css            (color, spacing, breakpoints)
    └── public/
        └── favicon.svg
```

## Phases

Each phase has a fixed entry in `PROGRESS.md`. Subagents read it first, mark their task IN_PROGRESS at start, DONE at end, and append a one-line note. Main thread fans out parallel agents only where listed.

### P0 — Skeleton (1 agent)
- Init pnpm workspace, three packages (`shared`, `server`, `client`).
- Dockerfile (multi-stage: build client → copy dist + server → run).
- `docker-compose.yml`, port 3000.
- Express serves `/` (client dist), Socket.io mounted at default path with `cors: { origin: "*" }`.
- Hello-world socket ping/pong end-to-end.
- Vitest configured in server.
- Verify: `docker compose up --build` → open `http://localhost:3000` → console logs round-trip.

### P1 — Shared types + Game engine (1 agent, then 1 agent)
**P1a — `shared/`**
- `Card` (id, color, type, value), `Color`, `CardType` unions.
- Event name constants + payload interfaces for every event in PRD §8.
- `PublicGameState` (no hands) vs `PrivateHand` split.

**P1b — `server/src/gameEngine.ts` (pure functions, no I/O)**
- `buildDeck()` → exact 108-card composition (76 number + 24 action + 4 Wild + 4 W4).
- `deal(playerCount, rng)` → 7/player, top card flipped (re-flip on starting W4).
- `isPlayable(card, top, currentColor)` — color, number/symbol, or Wild.
- `applyPlay(state, playerIdx, card, chosenColor?)` → new state + side-effects descriptor (skip, reverse, draw N for next).
- `drawCards(state, n)` → reshuffle-from-discard when empty.
- `scoreRound(players, winnerIdx)` → per PRD §4.6.
- `validateW4Challenge(w4PlayerHandBeforePlay, previousCurrentColor)` → returns `{ legal: boolean }`. Challenger wins iff `!legal`.
- Pure, deterministic; injectable RNG.
- Reverse with exactly 2 players → applied as Skip.
- Starting action card: effect applied to first player before TURN_START.
- Vitest covers: starting-card edge cases, reverse-with-2-players-acts-as-skip, no-stacking enforcement, W4 challenge truth table, score math, draw-pile exhaustion + reshuffle, deck-and-discard-both-empty failsafe (warn + cancel round), starting W4 re-flip.

### P2 — Room manager + Turn controller + Socket layer (3 parallel agents)
**P2a — `roomManager.ts`**
- 6-char code generator with collision check, case-insensitive lookup.
- Player join/leave/promote/kick, host transfer to next connected.
- Room lifecycle states (`waiting | playing | round_end | match_end`).
- 30-min inactivity GC, 5-min all-disconnected grace.

**P2b — `turnController.ts`**
- Server-authoritative timer with `turnStartedAt` timestamp.
- On expiry: auto-draw 1, advance turn.
- Skip disconnected players when their turn arrives.
- Direction + index advancement.
- Per-room async mutex around all state mutations.
- Deadlock guards (see §"Deadlock & edge cases" below).

**P2c — `sockets.ts` + `reconnect.ts`**
- One handler per client event; all mutations go through engine/roomManager under the room mutex.
- Issue `playerToken` (UUID) on join; on `connection` with token, rebind socket to existing player slot.
- Private `your_hand` emits only to the player's current socket id.
- Validation errors → `error` event (illegal play, not your turn, etc.).
- **UNO call/catch implementation**:
  - When `play_card` reduces hand to 1, open the catch window. Close on the next player's first action (`play_card` or `draw_card`) OR after 2s wall-clock fallback (covers idle/disconnected next player).
  - `call_uno` from the at-risk player before the catch window closes inoculates them.
  - `catch_uno`: first server-received catch within the window applies +2 penalty to target; later catches receive `error: window_closed`.

### P3 — Client foundation + Home/Lobby (2 parallel agents)
**P3a — `client/src/socket.ts` + `store.ts` + `main.tsx`**
- Socket client wrapper with `playerToken` persistence.
- Preact signals: `roomState`, `hand`, `screen`, `toasts`.
- Router: `/`, `/room/:code` (URL-driven).

**P3b — `screens/Home.tsx`, `screens/Lobby.tsx`, components: `PlayerAvatar`, `ColorChooser` (scaffold)**
- Home: name input (2–16 chars, alphanumeric+spaces), avatar grid (24 lucide icons), Create/Join CTAs.
- Lobby: room code (large, copy button), shareable URL, player grid, host settings panel (timer / points / max players / W4 challenge on/off), Start Game (disabled <2).

### P4 — Game screen (2 parallel agents)
**P4a — Card rendering + Hand + piles**
- `cardSvg.ts`: programmatic SVG per (color, type). Number cards = colored rounded rect + big digit + small corner digit. Action cards = symbol (⊘ skip, ⟲ reverse, +2, ★ wild, +4). Wild = 4-quadrant rainbow.
- `Hand` horizontal scroll, fan-out on desktop, dim non-playable cards.
- `DiscardPile`, `DrawPile`, current-color indicator, direction indicator.

**P4b — Game loop UI**
- `OpponentRow` (avatar + name + card count + active indicator).
- `TurnTimerRing` synced to `serverTimestamp + timerSeconds`.
- `UnoButton`, `ChallengePrompt` (5s overlay on W4 receipt).
- Color chooser modal on wild plays.
- Toasts for: timeout, UNO call, UNO caught, challenge result, disconnect/reconnect.

### P5 — Round end / Match end / Spectator / Polish (2 parallel agents)
**P5a — End screens + scoring**
- `RoundEnd` modal: winner, revealed hands, score table, Next Round (host) / auto-countdown.
- `MatchEnd`: confetti (CSS keyframes, no lib), full history, Play Again / New Game.

**P5b — Spectator mode + responsive + a11y pass**
- Spectator view: hand area replaced with watching banner, opponent cards as counts only.
- Host can kick/promote from lobby.
- 375px breakpoint: hand becomes horizontal scroll, opponents collapse to compact row, modals full-screen.
- Keyboard: Tab through cards, Enter to play, Esc to close modals.

### P6 — Integration test + QA (1 agent)
- Manual scripted run: 2-player → 4-player → 12-player simulated tabs.
- Verify reconnect (close tab mid-turn, reopen).
- Verify host disconnect → host transfer.
- Verify draw-pile exhaustion path.
- Verify UNO catch race: two clients spam catch on same target; only first registered wins.
- Verify W4 challenge truth table in live play.
- ngrok validation: `ngrok http 3000` and play across two networks.
- Update `PROGRESS.md` with final state.

## Deadlock & edge cases (engine must handle)

| Scenario | Handling |
|---|---|
| Draw pile empty, discard ≤ 1 card | If <2 cards remain in play across all piles, log warn + end round in draw (no winner, no score) |
| Player disconnects on own turn, timer Off | Force 5s grace then auto-draw + advance (override "Off" for disconnected players only) |
| All players disconnect | 5-min grace; on reconnect of any, resume; otherwise destroy room |
| < 2 connected players mid-round | Pause game, show "Waiting for players" overlay, 5-min reconnect window, then cancel round |
| Two `play_card` events arrive same tick | Per-room async mutex; second event gets `error: not_your_turn` |
| Catch event after window closes | Drop with `error: window_closed` |
| Promotion of spectator mid-round | Reject — only between rounds (PRD §7.7) |
| W4 challenge: challenger's own hand contents | Irrelevant — only the W4 player's hand vs previous color is evaluated |
| Reverse with 2 players | Acts as Skip (official) |
| Starting card is action | Effect applies to first player before TURN_START |
| Starting card is W4 | Bury back into deck and re-flip |
| Starting card is Wild (non-W4) | Host (first player) chooses opening color |
| Reconnecting player's seat already taken (e.g., promoted spectator) | Refuse rebind, route to spectator |
| W4 challenge prompt never answered (idle) | Auto-accept after 5s = no challenge, next player draws 4 + skips |
| 12 players + many high-value cards in play | Deck math holds (108 − 84 dealt = 24 in piles); engine still validates reshuffle path |

## Progress tracking — `PROGRESS.md` contract

Lives at repo root, owned by the main thread, updated by every subagent before exit.

```markdown
# Build Progress — UNO v1

## Current state
- Active phase: P2
- Last agent: P2b (turnController)
- Blockers: none
- Next action: spawn P3a + P3b in parallel

## Phases
- [x] P0 — Skeleton
  - [x] pnpm workspace
  - [x] Dockerfile + compose
  - [x] socket ping/pong verified
- [x] P1a — shared types
- [x] P1b — game engine + tests (47 passing)
- [~] P2 — server runtime (2/3 done)
  - [x] P2a roomManager
  - [x] P2b turnController
  - [ ] P2c sockets+reconnect  ← NEXT
- [ ] P3 — client foundation
- [ ] P4 — game screen
- [ ] P5 — end screens / spectator / responsive
- [ ] P6 — QA

## Notes
- 2026-06-04 P1b: engine pure-functional, RNG injected via param. Reshuffle path covered.
- 2026-06-04 P2a: room codes uppercase A–Z 0–9, regenerated on collision (negligible).
```

**Agent contract per run:**
1. Read `PROGRESS.md` + this plan file first.
2. Confirm task matches the `NEXT` marker (or explicit instruction from main).
3. Implement; run relevant tests; ensure typecheck passes.
4. Update `PROGRESS.md`: mark task done, advance NEXT pointer, append dated note.
5. Report back: files touched, tests added, blockers.

## Verification (end-to-end)

1. `docker compose up --build` — server boots on :3000, client served.
2. `pnpm -C server test` — all engine tests green.
3. Open two browser tabs at `http://localhost:3000`:
   - Tab A creates room, copies code.
   - Tab B joins with code.
   - Start game; play through a full round.
4. Verify each PRD-mandated behavior:
   - Turn timer countdown + auto-draw on expiry
   - UNO call → catch → penalty (window closes on next player's first action)
   - W4 challenge → result toast (correct truth table)
   - Disconnect (close tab B) → greyed avatar → reopen → seat reclaimed
   - Round end → scores → next round → match end at points-to-win
5. Open third tab mid-game → joins as spectator → sees board, not hands.
6. `ngrok http 3000` → share URL → connect from second device → full game.
7. Resize browser to 375px → confirm playable.

## Risks / explicit non-goals

- No persistence — server restart drops all rooms (acceptable per PRD §5.1).
- No bots — needs ≥2 humans.
- No stacking/jump-in/7-0 in v1 — v2 scope.
- 12-player support is a documented house extension over official 2–10.
- ngrok URL rotates on restart (free tier) — host must re-share.
