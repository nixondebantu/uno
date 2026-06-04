# Build Progress — UNO v1

Plan: `plan/BUILD_PLAN.md`

## Current state
- Active phase: P2 → P3
- Last agent: P2c-sockets
- Blockers: none
- Next action: P3 — fan out P3a (client core) + P3b (Home/Lobby) in parallel

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
- [ ] P3a — client socket/store/router
- [ ] P3b — Home + Lobby screens
- [ ] P4a — card SVG + Hand + piles
- [ ] P4b — game loop UI (timer, UNO button, challenge prompt, color chooser)
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
