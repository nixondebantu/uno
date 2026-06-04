# Build Progress — UNO v1

Plan: `plan/BUILD_PLAN.md`

## Current state
- Active phase: P4 → P5
- Last agent: P4b-game-ui
- Blockers: none
- Next action: P5 — fan out P5a (end screens) + P5b (spectator/responsive/a11y) in parallel

## Phases
- [x] P0 — Skeleton
  - [x] pnpm workspace (root + shared + server + client packages)
  - [x] Dockerfile (multi-stage)
  - [x] docker-compose.yml
  - [x] Express + Socket.io boot, serves client dist on :3000
  - [x] Vitest configured in server
  - [x] socket ping/pong verified end-to-end
- [x] P1a — shared types (`shared/src/{cards,events,state}.ts`)
- [x] P1b — game engine (pure fns) + Vitest suite (58 tests passing)
- [x] P2a — roomManager
- [x] P2b — turnController
- [x] P2c — sockets + reconnect
- [x] P3a — client socket/store/router
- [x] P3b — Home + Lobby screens
- [x] P4a — card SVG + Hand + piles
- [x] P4b — game loop UI (timer, UNO button, challenge prompt, color chooser)
- [ ] P5a — round end / match end screens
- [ ] P5b — spectator + responsive + a11y
- [ ] P6 — integration QA

## Agent contract
1. Read `plan/BUILD_PLAN.md` + this file first.
2. Confirm assigned task matches current NEXT (or explicit main-thread direction).
3. Implement; run relevant tests; ensure typecheck passes.
4. Update this file: mark task `[x]`, advance NEXT pointer, append dated note below.
5. Report back: files touched, tests added, blockers.

## Notes
<!-- agents append one line per run: YYYY-MM-DD <phase-id>: <one-line summary> -->
- 2026-06-04 P0: scaffolded pnpm workspace (shared/server/client), strict TS everywhere, Express + Socket.io with ping_test→pong_test echo, Vitest smoke green, Vite+Preact client renders pong reply, multi-stage Dockerfile (pnpm 10 deploy --legacy) builds & runs (image uno:latest, ~143MB) — `/health` returns `{ok:true}`, SPA served from `/app/client/dist` in container.
- 2026-06-04 P1a: shared types — Card/Color/CardType, PlayerPublic/Private, RoomPublic, PublicGameState, all client/server event payloads + ErrorCode union.
- 2026-06-04 P1b: engine — pure fns, injected RNG, 58 tests passing. W4 challenge uses color-match-on-snapshot per official.
- 2026-06-04 P2a: roomManager — code gen + lifecycle + host transfer + GC, 46 tests added.
- 2026-06-04 P2b: turnController — timer + mutex + W4 flow + disconnect skipping + 22 tests added.
- 2026-06-04 P2c: sockets + reconnect — wired all ClientEvents → roomManager/turnController under per-room mutex. TurnEvents fan out to Socket.io (broadcast for public, registry-routed for private hand/error). Added playerToken (UUID v4) reconnect: rejoin with stored token restores seat + replays game_state + your_hand. Minimal turnController.handleDisconnect for no-timer rooms (5s forced auto-draw). Added shared events: set_starting_color, pass_turn, kick_spectator, awaiting_starting_color, playable_drawn, game_paused, game_resumed. Added ErrorCodes: already_started, not_in_room, not_current_player. Periodic 60s GC in index.ts destroys idle rooms + cleans turnController state. 8 socket integration tests added (in-process io.Server + socket.io-client), 134 tests total passing.
- 2026-06-04 P3a: client core — socket singleton (typed `on`/`emit`, auto-injects playerToken into JOIN_ROOM, localStorage persistence), signals store (screen/roomState/myHand/myId/gameState/toasts/awaitingStartingColor/w4ChallengePrompt/playableDrawn/unoCallable[computed]/pendingError/round+matchEnd), `wireServerEvents()` covers all 22 ServerEvents, URL router (`/`, `/room/:CODE` 6-char validated), Vite dev proxy `/socket.io` → :3000, design tokens + global CSS (toast stack + modal overlay), lucide-preact (24 AVATARS, `AvatarIcon` component). Shared: added `ClientPayloadMap`/`ServerPayloadMap`/`ClientPayloadFor`/`ServerPayloadFor` (additive). Placeholder Home/Lobby stubs created — P3b owns the real screens. Typecheck + `vite build` green (67.81 kB JS gzipped 22.96 kB).
- 2026-06-04 P3b: Home + Lobby — Home (name input 2–16 alphanumeric+spaces with live validation + localStorage persistence, 4/6/8-col responsive avatar grid, Create/Join CTAs, inline join panel with 6-char auto-uppercase code input, URL-prefilled when landing on /room/:CODE), Lobby (huge room code with rainbow-gradient text, Copy link, Leave, responsive player grid 1→2→3→4 cols, separated spectator section with host-only Promote/Kick icon buttons, host settings sidebar — radio 15/30/60/Off timer + radio 200/500/1000 points + 2–12 slider + W4 toggle, 250ms debounced UPDATE_SETTINGS, Start Game disabled <2 with tooltip), `PlayerAvatar` (icon card + name + ring='active' pulsing yellow / 'disconnected' grayscale-and-dim, badges slot for crown/eye, actions slot for promote/kick), `ColorChooser` modal (4 large color buttons + Esc-to-cancel + click-overlay-to-cancel), `ToastStack` component projecting `toasts` signal, Game/RoundEnd/MatchEnd placeholders in `main.tsx` switch. Typecheck clean; vite build → 97.89 kB JS gz 31.86 kB + 12.79 kB CSS gz 3.18 kB.
- 2026-06-04 P4a: card visuals — `assets/cardSvg.ts` (pure SVG-string builders per glyph: digit / skip ⊘ / reverse arrows / draw-two with mini-cards + "+2" / 4-quadrant wild pie / W4 = pie + "+4" / face-down back = black + red oval + UNO wordmark), `renderCardSvg` + `cardSvgDataUri`, 2:3 200×300 viewBox, hex colours hard-coded (SVG can't read CSS vars). `Card.tsx` injects via `dangerouslySetInnerHTML` (single-source-of-truth recipe; click/dim/selected handled on wrapper div); props `{card,width?,faceDown?,dim?,selected?,onClick?,className?,ariaLabel?}`. `Hand.tsx` fan-out on desktop (negative-margin overlap) / scroll-snap on <640px, dims unplayable via shared `isPlayable`, opens `ColorChooser` on Wild plays. `DiscardPile` (top card + bottom-right active-colour chip), `DrawPile` (3 stacked backs + `×N` badge, click-to-draw when canDraw), `DirectionIndicator` (12s rotating SVG arc, respects prefers-reduced-motion), `CurrentColorIndicator` (pill swatch+label), `Table.tsx` composes piles + indicators + Hand (replaces P4b's `TablePlaceholder`). Shared: hoisted `isPlayable` into `@uno/shared/cards.ts` (server re-exports for back-compat). `Game.tsx` now wires `<Table />` in place of the placeholder; `Game.css` extended with P4a sections. NO image files — all visuals inline SVG. Client typecheck clean; `vite build` → 116.64 kB JS gz 37.60 kB + 22.62 kB CSS gz 4.83 kB. Server 134/134 tests pass after the shared move.
- 2026-06-04 P4b: game-loop UI — `useGameActions()` hook (playCard/drawCard/passTurn/callUno/catchUno/respondW4/setStartingColor) centralizes emits with optimistic ephemeral-prompt clears. Store additions: `unoCallEmitted` (local "did I press UNO" flag, reset on hand>1 / round_end / game_started), `unoCalledBy: ReadonlySet<string>` (opponents who called UNO this round — added on UNO_CALLED, cleared on UNO_CAUGHT / ROUND_END / GAME_STARTED), `isConnected` (wired from `onConnectionChange`). New components: `OpponentRow` (per-opponent PlayerAvatar with active/disconnected ring, card-count subtitle, hand badge at cardCount===1, overlaid `TurnTimerRing` when active, "Catch!" pill when cardCount===1 && !unoCalledBy.has(id)), `TurnTimerRing` (rAF ~10fps SVG ring, color thresholds green>50% / yellow>20% / red, returns null when totalSeconds<=0), `UnoButton` (pulsing red→yellow gradient pill), `ChallengePrompt` (5s progress bar + Accept/Challenge, server-authoritative auto-decline), `StartingColorPrompt` (host-only wrapper around ColorChooser), `PlayableDrawnPrompt` (Play/Pass; Wild flow chains into ColorChooser), `SelfStatus` (bottom bar — my avatar with active ring + overlaid timer, score subtitle, UnoButton, connection dot), `GameHeader` (Scores button → side ScoreDrawer overlay, round number, room code), `screens/Game.tsx` composes header → OpponentRow → Table (P4a) → SelfStatus + floating overlays, `screens/Game.css` holds P4b styles. Toasts for CARD_DRAWN / UNO_CAUGHT / W4_CHALLENGE_RESULT / disconnect+reconnect already covered by P3a's `wireServerEvents`; "X timed out — auto-drew" toast not feasible client-side (server emits only CARD_DRAWN+TURN_START on expiry, indistinguishable from a manual draw) — deferred. P4a landed in parallel: their `Table.tsx` replaced my `TablePlaceholder` stub (removed) and overrode `screens/Game.tsx` to import it; coordination clean. One unused param in P4a's `cardSvg.ts buildCornerLabel(_color)` prefixed with `_` to unblock strict typecheck. `pnpm -F @uno/client typecheck` clean; `pnpm -F @uno/client build` → 116.64 kB JS gz 37.60 kB + 21.35 kB CSS gz 4.66 kB.
