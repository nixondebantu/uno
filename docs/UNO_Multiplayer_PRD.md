# Product Requirements Document
## Real-Time Multiplayer UNO — Browser Based
**Version:** 1.0 (Classic UNO)
**Last Updated:** June 2026
**Status:** Draft

---

## 1. Executive Summary

A browser-based, real-time multiplayer UNO game supporting up to 12 players per room. The game runs entirely inside a single Docker container, making it trivially deployable on any machine and shareable over the internet via ngrok. Version 1 ships Classic UNO. Future versions will introduce game variants (No Mercy, Flip, etc.) within the same infrastructure.

---

## 2. Goals

| Goal | Description |
|---|---|
| **G1** | Playable by 2–12 players in a single room with no account registration |
| **G2** | Full Classic UNO ruleset, server-enforced |
| **G3** | Single `docker compose up` to launch the entire stack |
| **G4** | Shareable via a room code or link over ngrok |
| **G5** | Graceful handling of player disconnections and idle turns |
| **G6** | Extensible architecture to support game variants in v2+ |

## 2.1 Non-Goals (v1)

- No user accounts, login, or persistent profiles
- No leaderboards or cross-session stats
- No mobile native app (browser responsive UI is acceptable)
- No AI/bot players
- No real-money or in-app purchases
- No No-Mercy or other variants (planned for v2)

---

## 3. User Personas

### 3.1 The Host
A player who spins up the Docker container on their machine, exposes it via ngrok, creates a room, and shares the code/link with friends. Technically comfortable enough to run a terminal command.

### 3.2 The Guest Player
Receives a link or room code, opens it in a browser, enters a display name and picks an avatar, and starts playing. Zero setup required.

### 3.3 The Spectator
Joins a room that is already in progress (or full). Can watch the game — sees the discard pile, turn order, player card counts — but cannot play.

---

## 4. Game Rules — Classic UNO

### 4.1 Deck Composition (108 cards)

| Type | Count | Description |
|---|---|---|
| Number cards (0) | 4 | One per color |
| Number cards (1–9) | 72 | Two per color per number |
| Draw Two | 8 | Two per color — next player draws 2 and loses turn |
| Skip | 8 | Two per color — next player loses their turn |
| Reverse | 8 | Two per color — reverses direction of play |
| Wild | 4 | Declare any color |
| Wild Draw Four | 4 | Declare any color + next player draws 4 and loses turn |

### 4.2 Setup
- Each player is dealt **7 cards**.
- Remaining cards form the **draw pile** (face-down).
- Top card of draw pile is flipped to start the **discard pile**.
- If the starting card is a Wild Draw Four, it is buried back and a new card is flipped.
- If the starting card is a Wild, the host (first player) chooses the opening color.
- If the starting card is an action card (Skip, Reverse, Draw Two), its effect applies immediately before the first turn.

### 4.3 Turn Flow
1. It is Player A's turn.
2. Player A **must** play a card matching the top discard card's **color**, **number/symbol**, OR play a Wild/Wild Draw 4.
3. If Player A cannot play, they **draw one card** from the draw pile.
   - If the drawn card is playable, they may play it immediately or keep it.
4. Play passes to the next player (clockwise by default).

### 4.4 Action Card Effects

| Card | Effect on Next Player |
|---|---|
| Skip | Loses their turn |
| Reverse | Reverses direction; with 2 players, acts as a Skip |
| Draw Two | Draws 2 cards and loses their turn |
| Wild | Current player declares a new color |
| Wild Draw Four | Current player declares a new color; next player draws 4 and loses their turn |

### 4.5 UNO Call Rule
- When a player plays their **second-to-last card**, they must click **"UNO!"** before or at the moment of playing it.
- Any other player may press **"Catch!"** within a 2-second window after the card is played.
- If caught, the player who failed to call UNO draws **2 penalty cards**.
- If not caught within 2 seconds, the penalty window closes.

### 4.6 Win Condition
- First player to empty their hand wins the **round**.
- **Scoring:** The winner earns points equal to the sum of all other players' remaining cards.
  - Number cards = face value
  - Draw Two, Skip, Reverse = 20 points each
  - Wild, Wild Draw Four = 50 points each
- **Match win:** First to reach **500 points** across rounds wins the match. (Configurable by host.)

### 4.7 Draw Pile Exhaustion
- When the draw pile is empty, the discard pile (except the top card) is shuffled and becomes the new draw pile.

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Docker Container                   │
│                                                         │
│   ┌─────────────────┐       ┌──────────────────────┐   │
│   │   Static Assets  │       │   Node.js Game Server │   │
│   │  (HTML/CSS/JS)  │       │   Express + Socket.io │   │
│   │  served by      │◄─────►│                       │   │
│   │  Express static │       │  - Room Manager       │   │
│   └─────────────────┘       │  - Game State Engine  │   │
│                              │  - Turn Timer         │   │
│                              │  - Reconnect Handler  │   │
│                              └──────────────────────┘   │
│                                        │                 │
│                              ┌─────────▼──────────┐     │
│                              │   In-Memory Store   │     │
│                              │  (rooms, game state │     │
│                              │   player sessions)  │     │
│                              └────────────────────┘     │
│                                                         │
│   Exposed Port: 3000                                    │
└────────────────────────────┬────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │      ngrok      │
                    │  (HTTP tunnel)  │
                    │  WebSocket-safe │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Players' Brow- │
                    │  sers (any OS)  │
                    └─────────────────┘
```

### 5.1 Why In-Memory (No Database)
For a private-use, session-scoped game, an in-memory store is the correct choice:
- Zero external dependencies = single container deploy
- Game state is ephemeral by nature (session ends, state is gone)
- Sub-millisecond state reads/writes with no I/O overhead
- Sufficient for 12 players × N simultaneous rooms on any modern machine

---

## 6. Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js 20 (LTS) | Non-blocking I/O, huge ecosystem, ideal for real-time event-driven apps |
| **HTTP Server** | Express.js | Lightweight, serves static files + REST endpoints for room setup |
| **Real-time** | Socket.io 4.x | WebSocket with automatic fallback, built-in rooms, reconnection support |
| **Frontend** | Vanilla HTML5 + CSS + JS | No build step, loads instantly, zero framework overhead for a card game |
| **State Store** | In-memory JS Map | No database needed; state lives in the server process |
| **Containerization** | Docker + Docker Compose | Single-command spin-up, zero host dependencies |
| **Tunnel** | ngrok (external) | Free tier supports WebSocket traffic; user runs it separately |

---

## 7. Feature Specifications

### 7.1 Room Management

#### 7.1.1 Creating a Room
- The host opens the app, enters a display name, selects an avatar (from a preset set of 20+).
- Clicks **"Create Room"**.
- Server generates a unique 6-character alphanumeric **Room Code** (e.g., `K9FX2P`).
- Host is taken to the **Lobby Screen** showing:
  - Room code (large, copyable)
  - Shareable link: `http://<ngrok-url>/room/K9FX2P`
  - Player list (just the host for now)
  - Game settings panel (see §7.1.3)
  - **"Start Game"** button (disabled until ≥ 2 players)

#### 7.1.2 Joining a Room
- Guests open the link or go to the app root, enter the room code.
- Enter display name + pick avatar.
- If room is in **LOBBY** state: player joins the player list.
- If room is in **PLAYING** state: player joins as a **Spectator** and may be promoted to player if a slot opens.
- If room is full (12 players): player can only spectate.
- Room codes are **case-insensitive**.

#### 7.1.3 Host Game Settings (Lobby Screen)
| Setting | Default | Options |
|---|---|---|
| Turn timer | 30 seconds | 15s / 30s / 60s / Off |
| Points to win | 500 | 200 / 500 / 1000 |
| Draw pile on Wild Draw 4 | Standard (challenge allowed) | Standard / No challenge |
| Max players | 8 | 2–12 |

#### 7.1.4 Room Lifecycle
```
WAITING → PLAYING → ROUND_END → PLAYING (next round) → MATCH_END → WAITING (rematch)
```
- Room persists for **30 minutes of inactivity**, then is destroyed.
- Host can disband the room at any time from the lobby.
- If the host disconnects during the game, **host role is transferred** to the next connected player in the list.

---

### 7.2 Game State Machine

```
                  ┌─────────────┐
                  │   WAITING   │  ← Lobby, waiting for players
                  └──────┬──────┘
                         │ host clicks Start (≥2 players)
                  ┌──────▼──────┐
                  │   DEALING   │  ← Server deals 7 cards, flips top card
                  └──────┬──────┘
                         │ dealing complete
                  ┌──────▼──────┐
             ┌───►│   PLAYING   │  ← Turn-by-turn game loop
             │    └──────┬──────┘
             │           │ a player empties their hand
             │    ┌──────▼──────┐
             │    │  ROUND_END  │  ← Score tallied, shown to all
             │    └──────┬──────┘
             │           │ nobody has reached win score
             └───────────┘
                         │ someone has reached win score
                  ┌──────▼──────┐
                  │  MATCH_END  │  ← Winner declared
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  WAITING    │  ← Rematch / new game
                  └─────────────┘
```

### 7.3 Turn State (within PLAYING)

Each player's turn follows this sub-flow server-side:
```
TURN_START → [timer begins]
    ├─► Player plays a card → validate → apply effect → TURN_END
    ├─► Player draws a card → may optionally play drawn card → TURN_END
    └─► Timer expires → auto-draw 1 card → TURN_END
```

---

### 7.4 Player Management

#### 7.4.1 Display Names & Avatars
- Display name: 2–16 characters, alphanumeric + spaces.
- Avatar: chosen from a fixed set of 24 illustrated icons (animals, emojis, etc.). No image uploads.
- Names must be **unique within a room** (server enforces, suggests `Name2` on conflict).

#### 7.4.2 Player Object (Server-Side)
```js
{
  id: "socket-id",
  name: "Alice",
  avatar: "fox",
  hand: [Card, ...],         // only sent to that player
  isConnected: true,
  isSpectator: false,
  score: 0,                  // cumulative across rounds
  disconnectedAt: null       // timestamp if disconnected
}
```

---

### 7.5 Disconnection Handling

| Scenario | Behaviour |
|---|---|
| Player disconnects during their turn | Turn timer immediately kicks in (or auto-skip if timer is Off) |
| Player disconnects on another player's turn | No interruption; their turn will be auto-skipped when it arrives |
| Player reconnects before their turn | Resumes normally, receives full game state snapshot |
| Player disconnects for > 10 minutes | Prompted to rejoin; if room still active they re-enter as spectator and can reclaim their seat if it's still open |
| Player explicitly leaves (closes tab) | Treated identically to a disconnect (no distinction possible) |
| All players disconnect | Room enters a 5-minute grace period before being destroyed |

Disconnected players are shown with a **greyed-out avatar and "⚡ Reconnecting"** badge to all other players.

---

### 7.6 Turn Timer

- A circular countdown ring is displayed around the **active player's avatar** on all clients.
- Timer starts the moment `TURN_START` is emitted by the server.
- If the timer reaches 0:
  - Server automatically draws 1 card for the player.
  - Turn passes to the next player.
  - All clients see a toast: `"[Name]'s turn timed out."`
- Timer is **server-authoritative** (client shows a visual countdown synced to server timestamp to avoid drift).

---

### 7.7 Spectator Mode

- Spectators see the full game board: discard pile, card counts per player, turn order, scores.
- Spectators **cannot** see any player's hand.
- Spectators see a sidebar with a read-only **spectator list**.
- A small label `👁 Watching` distinguishes spectators in the room.
- Host can **kick spectators** from the lobby settings if desired.
- If a playing slot opens (player permanently leaves), host can **promote a spectator** to player between rounds.

---

## 8. Socket Event API

### 8.1 Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `create_room` | `{ name, avatar, settings }` | Host creates a new room |
| `join_room` | `{ roomCode, name, avatar }` | Guest joins existing room |
| `start_game` | `{}` | Host starts the game (lobby only) |
| `play_card` | `{ cardId, chosenColor? }` | Active player plays a card |
| `draw_card` | `{}` | Active player draws from deck |
| `call_uno` | `{}` | Player declares UNO on their penultimate play |
| `catch_uno` | `{ targetId }` | Player catches another for not calling UNO |
| `leave_room` | `{}` | Explicit leave |
| `update_settings` | `{ settings }` | Host updates game settings in lobby |
| `promote_spectator` | `{ playerId }` | Host promotes a spectator to player |

### 8.2 Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `room_created` | `{ roomCode, roomState }` | Sent to host after room creation |
| `room_joined` | `{ roomState }` | Sent to joining player |
| `room_updated` | `{ players, spectators }` | Broadcast when lobby changes |
| `game_started` | `{ gameState, yourHand }` | Broadcast at game start; `yourHand` is private |
| `game_state` | `{ publicState }` | Public state update (discard, direction, turn, card counts) |
| `your_hand` | `{ hand }` | Private: sent only to the relevant player when their hand changes |
| `turn_start` | `{ playerId, timerSeconds, serverTimestamp }` | New turn begins |
| `card_played` | `{ playerId, card, newTopCard, newColor }` | A card was played |
| `card_drawn` | `{ playerId, cardCount }` | A player drew card(s) (count only, not the card) |
| `uno_called` | `{ playerId }` | A player called UNO |
| `uno_caught` | `{ caughtId, penaltyCards }` | A player was caught not calling UNO |
| `player_disconnected` | `{ playerId }` | Player lost connection |
| `player_reconnected` | `{ playerId }` | Player is back |
| `round_end` | `{ winnerId, scores, hands }` | Round over; hands revealed for scoring |
| `match_end` | `{ winnerId, finalScores }` | Match over |
| `error` | `{ code, message }` | Validation error (illegal move, etc.) |

---

## 9. Data Models

### 9.1 Card
```js
{
  id: "r-draw2-1",     // unique id (color-type-index)
  color: "red",        // red | blue | green | yellow | wild
  type: "draw_two",    // 0-9 | skip | reverse | draw_two | wild | wild_draw_four
  value: 20            // point value
}
```

### 9.2 Room
```js
{
  code: "K9FX2P",
  hostId: "socket-id",
  status: "waiting",           // waiting | playing | round_end | match_end
  players: [Player],           // ordered — index = seat
  spectators: [Player],
  settings: {
    turnTimerSeconds: 30,
    pointsToWin: 500,
    maxPlayers: 8
  },
  game: GameState | null,
  createdAt: Date,
  lastActivityAt: Date
}
```

### 9.3 GameState
```js
{
  deck: [Card],                // face-down draw pile
  discardPile: [Card],         // face-up; top is current card
  currentColor: "red",         // may differ from top card's color after a Wild
  direction: 1,                // 1 = clockwise, -1 = counter-clockwise
  currentTurnIndex: 2,         // index into room.players
  turnStartedAt: Date,
  round: 1
}
```

---

## 10. UI Screens

### 10.1 Home Screen
- Enter display name
- Pick avatar
- Two CTAs: **"Create Room"** and **"Join Room"** (input for code)

### 10.2 Lobby Screen
- Room code displayed prominently with a **Copy Link** button
- Player grid showing all joined players + their avatars
- Host settings panel (right sidebar or modal)
- Spectator count badge
- **"Start Game"** button (host only, enabled when ≥ 2 players)

### 10.3 Game Screen (Player)
```
┌─────────────────────────────────────────────────────┐
│  [Opponents row — names, avatars, card counts]      │
│                                                     │
│         [Discard Pile]    [Draw Pile]               │
│         [Current Color indicator]                   │
│         [Direction indicator ↻/↺]                  │
│                                                     │
│  [YOUR HAND — scrollable card row]                  │
│                                                     │
│  [UNO Button]              [Score / Round info]     │
└─────────────────────────────────────────────────────┘
```
- Active player's avatar has the **turn timer ring**.
- Cards in hand that are **not playable** are visually dimmed.
- Wild card play opens a **color chooser modal**.

### 10.4 Game Screen (Spectator)
- Same layout but hand area shows `👁 You are spectating`.
- Player card counts shown numerically on each player's avatar.

### 10.5 Round End Screen (Modal overlay)
- Winner announced with animation.
- Hands revealed (all cards shown).
- Score breakdown table.
- CTA: **"Next Round"** (host triggers) or countdown timer.

### 10.6 Match End Screen
- Winner confetti animation.
- Full score history across rounds.
- CTA: **"Play Again"** (returns to lobby) / **"New Game"** (resets room).

---

## 11. Docker & Deployment

### 11.1 Container Structure
```
uno-game/
├── Dockerfile
├── docker-compose.yml
├── server/
│   ├── index.js          (Express + Socket.io server)
│   ├── gameEngine.js     (UNO rules, state machine)
│   ├── roomManager.js    (room CRUD, lifecycle)
│   └── package.json
└── client/
    ├── index.html
    ├── game.html
    ├── app.js
    └── style.css
```

### 11.2 Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server/index.js"]
```

### 11.3 docker-compose.yml
```yaml
version: "3.9"
services:
  uno-game:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
```

### 11.4 Running Locally
```bash
# Start the game server
docker compose up --build

# In a second terminal — expose via ngrok
ngrok http 3000
```

### 11.5 ngrok Considerations
- ngrok HTTP tunnels forward WebSocket `Upgrade` headers natively — no special config needed.
- The server must set `cors: { origin: "*" }` in Socket.io options (or trust the ngrok domain).
- ngrok free tier provides a randomly assigned URL per session; host must reshare the URL if ngrok restarts.
- The shareable link should be the ngrok URL: `https://xxxx.ngrok-free.app/room/K9FX2P`.

---

## 12. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Player tries to play an illegal card | Server rejects with `error` event; card snaps back on client |
| Two players submit an action simultaneously | Server processes first received, rejects duplicate with `error` |
| Draw pile and discard pile both exhausted | Extremely unlikely; game logs warning, reshuffles discard pile |
| Room code collision | Regenerate until unique (collision rate negligible at 6 chars) |
| Host leaves mid-game | Host role auto-transferred to next player in seat order |
| < 2 players remain (others disconnect) | Game pauses with a 5-minute reconnect window; if not resolved, round is cancelled |
| Wild Draw 4 challenge | Server validates: if current player held a matching color card, challenger wins; otherwise challenger draws 6 |

---

## 13. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Max latency (LAN/local) | < 50ms round-trip |
| Max latency (ngrok tunnel) | < 300ms (ngrok adds ~100–200ms) |
| Concurrent rooms | 20+ rooms on a standard laptop |
| Memory per room | ~1–2 MB (cards + player state) |
| Browser support | Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ |
| Mobile responsiveness | Playable on 375px wide screens |

---

## 14. Versioning & Future Roadmap

### v1.0 — Classic UNO (this document)
All features above.

### v2.0 — No Mercy UNO
- Stack Draw 2s and Draw 4s indefinitely until someone can't counter.
- No challenging Wild Draw 4.
- Swap Hands card, Discard All of One Color card.
- Configurable as a room setting.

### v2.x — Additional Variants
- **UNO Flip** — double-sided deck, flip card switches to dark side rules.
- **UNO Dos** — two discard piles, match two cards at once.
- **House Rules mode** — menu of toggleable rules (stacking, jump-in, 7-swap, 0-rotate).

### v3.0 — Quality of Life
- Persistent scores across sessions (optional SQLite volume mount).
- Animated card dealing and play effects.
- Sound effects (toggleable).
- Mobile PWA manifest for "Add to Home Screen".

---

## 15. Development Milestones

| Phase | Deliverable | Est. Effort |
|---|---|---|
| **P0 — Skeleton** | Docker + Express + Socket.io hello world, room create/join | 1–2 days |
| **P1 — Game Engine** | Full UNO rules engine (server-side), deck, deal, turn loop | 3–4 days |
| **P2 — Basic UI** | Lobby screen, game screen (playable but minimal styling) | 3–4 days |
| **P3 — Edge Cases** | Disconnect handling, timer, UNO call/catch, host transfer | 2–3 days |
| **P4 — Polish** | Spectator mode, round/match end screens, avatars, animations | 2–3 days |
| **P5 — QA** | 12-player stress test, ngrok tunnel validation, mobile test | 1–2 days |
| **Total** | | ~2–3 weeks |

---

*End of PRD v1.0*
