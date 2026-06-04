# UNO Multiplayer

Real-time multiplayer UNO in the browser. Server-authoritative rules, in-memory
state, Docker-shippable, ngrok-shareable. 2–12 players (house extension over
the official 2–10), classic ruleset audited against unorules.com.

## Quickstart

```bash
docker compose up --build
# in another terminal:
ngrok http 3000
```

Open the ngrok URL on any device. The host creates a room and shares the link;
everyone else joins via the same URL.

## Local development

```bash
pnpm install
pnpm -F @uno/shared build         # build shared types once (re-run after edits)
pnpm -F @uno/server dev           # http://localhost:3000
pnpm -F @uno/client dev           # http://localhost:5173 (proxies /socket.io to :3000)
```

## Tests

```bash
pnpm -F @uno/server test          # vitest, 141 tests (engine + room + turn + sockets)
pnpm typecheck                    # strict TS across all packages
```

## Stack

TypeScript end-to-end. Server: Node 20 + Express + Socket.io. Client: Vite +
Preact + signals, inline SVG cards (no images). Shared types package via pnpm
workspaces. Single multi-stage Docker image (~143 MB).

## Plan + spec

- Build plan: [`plan/BUILD_PLAN.md`](./plan/BUILD_PLAN.md)
- Product spec: [`docs/UNO_Multiplayer_PRD.md`](./docs/UNO_Multiplayer_PRD.md)

## Known limitations

- No persistence — server restart drops all rooms and in-flight games.
- 12-player support is a documented house extension over official 2–10.
- ngrok free tier rotates the URL on each restart; host must re-share.
- No bots — minimum 2 humans per room.
