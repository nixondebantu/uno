# Build Progress — UNO v1

Plan: `plan/BUILD_PLAN.md`

## Current state
- Active phase: P1
- Last agent: P0-skeleton
- Blockers: none
- Next action: P1a — shared types (`shared/src/{cards,events,state}.ts` per plan §P1a)

## Phases
- [x] P0 — Skeleton
  - [x] pnpm workspace (root + shared + server + client packages)
  - [x] Dockerfile (multi-stage)
  - [x] docker-compose.yml
  - [x] Express + Socket.io boot, serves client dist on :3000
  - [x] Vitest configured in server
  - [x] socket ping/pong verified end-to-end
- [ ] P1a — shared types (`shared/src/{cards,events,state}.ts`)  ← NEXT
- [ ] P1b — game engine (pure fns) + Vitest suite
- [ ] P2a — roomManager
- [ ] P2b — turnController
- [ ] P2c — sockets + reconnect
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
