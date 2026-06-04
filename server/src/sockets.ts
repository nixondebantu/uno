// Socket.io wiring — the glue layer between client events and the
// roomManager + turnController state machines.
//
// Hard contracts (BUILD_PLAN.md §P2c):
//   • Handlers are THIN. All mutations route through roomManager and
//     turnController; this file only validates payload shapes, resolves
//     the caller's playerToken, dispatches, and translates exceptions
//     into `ServerEvents.ERROR` emits.
//   • Event names are the constants from @uno/shared. No magic strings.
//   • Private hand data is sent only to the owning socket; everything
//     else is broadcast to the room channel `room.code`.
//   • Reconnects rely on a stable playerToken passed back by the client.

import type { Server, Socket } from 'socket.io';
import {
  ClientEvents,
  ServerEvents,
  type CallUnoPayload,
  type Card,
  type CatchUnoPayload,
  type ChallengeW4Payload,
  type CreateRoomPayload,
  type DrawCardPayload,
  type ErrorCode,
  type GameSettings,
  type JoinRoomPayload,
  type KickSpectatorPayload,
  type LeaveRoomPayload,
  type PassTurnPayload,
  type PlayCardPayload,
  type PlayableColor,
  type PromoteSpectatorPayload,
  type SetStartingColorPayload,
  type StartGamePayload,
  type UpdateSettingsPayload,
} from '@uno/shared';

import {
  RoomError,
  createRoom,
  destroyRoom,
  getRoom,
  joinRoom,
  kickSpectator,
  leaveRoom,
  markConnected,
  markDisconnected,
  promoteSpectator,
  resetMatchScores,
  toPublicGameState,
  toPublicRoom,
  updateSettings,
  type RoomRecord,
} from './roomManager.js';
import type { TurnController, TurnEvents } from './turnController.js';
import { issueToken, type SocketRegistry } from './reconnect.js';

// ---------------------------------------------------------------------------
// Public bootstrap.
// ---------------------------------------------------------------------------

export interface SocketDeps {
  rooms: {
    createRoom: typeof createRoom;
    joinRoom: typeof joinRoom;
    leaveRoom: typeof leaveRoom;
    getRoom: typeof getRoom;
    destroyRoom: typeof destroyRoom;
    markDisconnected: typeof markDisconnected;
    markConnected: typeof markConnected;
    promoteSpectator: typeof promoteSpectator;
    kickSpectator: typeof kickSpectator;
    updateSettings: typeof updateSettings;
    resetMatchScores: typeof resetMatchScores;
    toPublicRoom: typeof toPublicRoom;
    toPublicGameState: typeof toPublicGameState;
  };
  turn: TurnController;
  registry: SocketRegistry;
}

/**
 * Build the standard rooms-module facade. Convenience for callers that just
 * want the live module-singleton API.
 */
export function defaultRoomsDeps(): SocketDeps['rooms'] {
  return {
    createRoom,
    joinRoom,
    leaveRoom,
    getRoom,
    destroyRoom,
    markDisconnected,
    markConnected,
    promoteSpectator,
    kickSpectator,
    updateSettings,
    resetMatchScores,
    toPublicRoom,
    toPublicGameState,
  };
}

/**
 * Build a TurnEvents implementation that fans events out via the given
 * Socket.io server. Private events (privateHand, error) only reach the
 * owning socket via the registry; broadcasts hit the entire room channel.
 */
export function buildTurnEvents(
  io: Server,
  rooms: SocketDeps['rooms'],
  registry: SocketRegistry,
): TurnEvents {
  function emitToToken(token: string, event: string, payload: unknown): void {
    const sid = registry.socketFor(token);
    if (sid) io.to(sid).emit(event, payload);
  }
  function broadcastPublic(roomCode: string): void {
    const room = rooms.getRoom(roomCode);
    if (!room) return;
    io.in(roomCode).emit(ServerEvents.ROOM_UPDATED, {
      players: rooms.toPublicRoom(room).players,
      spectators: rooms.toPublicRoom(room).spectators,
    });
    io.in(roomCode).emit(ServerEvents.GAME_STATE, {
      publicState: rooms.toPublicGameState(room.game, room.settings.turnTimerSeconds),
    });
  }

  return {
    turnStart(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.TURN_START, payload);
    },
    cardPlayed(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.CARD_PLAYED, payload);
    },
    cardDrawn(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.CARD_DRAWN, payload);
    },
    privateHand(playerToken, hand) {
      emitToToken(playerToken, ServerEvents.YOUR_HAND, { hand });
    },
    unoVulnerable(_roomCode, _payload) {
      // No public broadcast — at-risk player learns via privateHand + count.
      // Catch resolution happens via catch_uno from any other player.
      void _roomCode;
      void _payload;
    },
    unoCalled(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.UNO_CALLED, payload);
    },
    unoCaught(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.UNO_CAUGHT, payload);
    },
    playableDrawn(playerToken, payload) {
      emitToToken(playerToken, ServerEvents.PLAYABLE_DRAWN, payload);
    },
    awaitingStartingColor(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.AWAITING_STARTING_COLOR, payload);
    },
    w4ChallengePrompt(roomCode, payload) {
      // Broadcast to room — clients gate by `challengerId === ourToken`.
      io.in(roomCode).emit(ServerEvents.W4_CHALLENGE_PROMPT, payload);
    },
    w4ChallengeResult(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.W4_CHALLENGE_RESULT, payload);
    },
    roundEnd(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.ROUND_END, payload);
    },
    matchEnd(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.MATCH_END, payload);
    },
    gamePaused(roomCode, payload) {
      io.in(roomCode).emit(ServerEvents.GAME_PAUSED, payload);
    },
    gameResumed(roomCode) {
      io.in(roomCode).emit(ServerEvents.GAME_RESUMED, {});
    },
    error(_roomCode, playerToken, payload) {
      emitToToken(playerToken, ServerEvents.ERROR, payload);
    },
    publicStateChanged(roomCode) {
      broadcastPublic(roomCode);
    },
  };
}

// ---------------------------------------------------------------------------
// Per-room/player resolution helpers.
// ---------------------------------------------------------------------------

interface CallerContext {
  token: string;
  room: RoomRecord;
}

function emitError(socket: Socket, code: ErrorCode, message: string): void {
  socket.emit(ServerEvents.ERROR, { code, message });
}

/**
 * Resolve the caller's playerToken from the registry. Returns null + emits
 * an error if not bound.
 */
function requireToken(socket: Socket, registry: SocketRegistry): string | null {
  const token = registry.tokenFor(socket.id);
  if (!token) {
    emitError(socket, 'not_in_room', 'socket not bound to a player');
    return null;
  }
  return token;
}

/**
 * Resolve (token, room) for the caller. Returns null + emits the
 * appropriate error if the binding is missing or the room is gone.
 */
function requireContext(
  socket: Socket,
  registry: SocketRegistry,
  rooms: SocketDeps['rooms'],
  roomCode?: string,
): CallerContext | null {
  const token = requireToken(socket, registry);
  if (!token) return null;
  // Iterate socket's joined rooms to find a known room code.
  let target: RoomRecord | null = null;
  if (roomCode) {
    target = rooms.getRoom(roomCode);
  } else {
    for (const code of socket.rooms) {
      if (code === socket.id) continue;
      const r = rooms.getRoom(code);
      if (r) {
        target = r;
        break;
      }
    }
  }
  if (!target) {
    emitError(socket, 'not_in_room', 'socket not joined to any room');
    return null;
  }
  return { token, room: target };
}

// ---------------------------------------------------------------------------
// Payload validation helpers.
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asSettings(v: unknown): Partial<GameSettings> {
  if (!isObject(v)) return {};
  const out: Partial<GameSettings> = {};
  if ('turnTimerSeconds' in v) {
    const t = v['turnTimerSeconds'];
    if (t === null || typeof t === 'number') out.turnTimerSeconds = t as number | null;
  }
  if (typeof v['pointsToWin'] === 'number') out.pointsToWin = v['pointsToWin'] as number;
  if (typeof v['maxPlayers'] === 'number') out.maxPlayers = v['maxPlayers'] as number;
  if (typeof v['w4ChallengeEnabled'] === 'boolean') {
    out.w4ChallengeEnabled = v['w4ChallengeEnabled'] as boolean;
  }
  return out;
}

const PLAYABLE_COLOR_SET = new Set<PlayableColor>(['red', 'blue', 'green', 'yellow']);
function asPlayableColor(v: unknown): PlayableColor | null {
  if (typeof v !== 'string') return null;
  return PLAYABLE_COLOR_SET.has(v as PlayableColor) ? (v as PlayableColor) : null;
}

// ---------------------------------------------------------------------------
// Main wiring.
// ---------------------------------------------------------------------------

export function wireSockets(io: Server, deps: SocketDeps): void {
  const { rooms, turn, registry } = deps;

  io.on('connection', (socket: Socket) => {
    // ---- CREATE_ROOM -----------------------------------------------------
    socket.on(ClientEvents.CREATE_ROOM, (raw: unknown) => {
      try {
        if (!isObject(raw)) {
          emitError(socket, 'invalid_name', 'invalid create_room payload');
          return;
        }
        const p = raw as Partial<CreateRoomPayload>;
        const name = asString(p.name);
        const avatar = asString(p.avatar);
        if (name === null || avatar === null) {
          emitError(socket, 'invalid_name', 'name + avatar required');
          return;
        }
        const settings = asSettings(p.settings);
        const token = issueToken();
        const room = rooms.createRoom(
          { name, avatar, playerToken: token },
          settings,
          Date.now(),
        );
        // Bind socket → token + join Socket.io room channel.
        registry.bind(token, socket.id);
        rooms.markConnected(room, token, socket.id, Date.now());
        void socket.join(room.code);
        socket.emit(ServerEvents.PLAYER_TOKEN, { playerToken: token });
        socket.emit(ServerEvents.ROOM_CREATED, {
          roomCode: room.code,
          roomState: rooms.toPublicRoom(room),
        });
        // Broadcast (room of 1 — host only — but keeps the contract uniform).
        const pub = rooms.toPublicRoom(room);
        io.in(room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- JOIN_ROOM -------------------------------------------------------
    socket.on(ClientEvents.JOIN_ROOM, (raw: unknown) => {
      try {
        if (!isObject(raw)) {
          emitError(socket, 'invalid_name', 'invalid join_room payload');
          return;
        }
        const p = raw as Partial<JoinRoomPayload>;
        const roomCode = asString(p.roomCode);
        const name = asString(p.name);
        const avatar = asString(p.avatar);
        if (!roomCode || name === null || avatar === null) {
          emitError(socket, 'invalid_name', 'roomCode + name + avatar required');
          return;
        }
        // Reconnect with provided token, else issue new.
        const provided = asString(p.playerToken);
        const token = provided ?? issueToken();
        const now = Date.now();

        // Detect a true reconnect: peek before joinRoom mutates `isConnected`.
        let isReconnectIntoGame = false;
        if (provided) {
          const peek = rooms.getRoom(roomCode);
          if (peek && peek.status === 'playing') {
            const existing =
              peek.players.find((pl) => pl.id === provided) ?? null;
            if (existing && !existing.isConnected) {
              isReconnectIntoGame = true;
            }
          }
        }

        const result = rooms.joinRoom(roomCode, { name, avatar, playerToken: token }, now);
        const room = result.room;

        registry.bind(token, socket.id);
        rooms.markConnected(room, token, socket.id, now);
        void socket.join(room.code);

        socket.emit(ServerEvents.PLAYER_TOKEN, { playerToken: token });
        socket.emit(ServerEvents.ROOM_JOINED, {
          roomState: rooms.toPublicRoom(room),
        });
        const pub = rooms.toPublicRoom(room);
        io.in(room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });

        if (isReconnectIntoGame) {
          io.in(room.code).emit(ServerEvents.PLAYER_RECONNECTED, {
            playerId: token,
          });
          socket.emit(ServerEvents.GAME_STATE, {
            publicState: rooms.toPublicGameState(
              room.game,
              room.settings.turnTimerSeconds,
            ),
          });
          if (room.game) {
            const enginePlayer = room.game.players.find((ep) => ep.id === token);
            if (enginePlayer) {
              const hand: Card[] = enginePlayer.hand.slice();
              socket.emit(ServerEvents.YOUR_HAND, { hand });
            }
          }
        }
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- START_GAME ------------------------------------------------------
    socket.on(ClientEvents.START_GAME, (_raw: StartGamePayload) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        const host = ctx.room.players.find((p) => p.isHost);
        if (!host || host.id !== ctx.token) {
          emitError(socket, 'not_host', 'only host can start the game');
          return;
        }
        if (ctx.room.status !== 'waiting') {
          emitError(socket, 'already_started', 'game already started');
          return;
        }
        if (ctx.room.players.length < 2) {
          emitError(socket, 'invalid_state', 'need at least 2 players');
          return;
        }
        turn.startGame(ctx.room, undefined, Date.now());
        // Send GAME_STARTED with current public state + per-player hand.
        const pub = rooms.toPublicRoom(ctx.room);
        const publicState = pub.game;
        if (publicState && ctx.room.game) {
          for (const ep of ctx.room.game.players) {
            const sid = registry.socketFor(ep.id);
            if (sid) {
              io.to(sid).emit(ServerEvents.GAME_STARTED, {
                gameState: publicState,
                yourHand: ep.hand.slice(),
              });
            }
          }
        }
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- SET_STARTING_COLOR ---------------------------------------------
    socket.on(ClientEvents.SET_STARTING_COLOR, (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<SetStartingColorPayload>;
      const color = asPlayableColor(p.color);
      if (!color) {
        emitError(socket, 'invalid_state', 'invalid color');
        return;
      }
      try {
        turn.setStartingColor(ctx.room, ctx.token, color, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- PLAY_CARD -------------------------------------------------------
    socket.on(ClientEvents.PLAY_CARD, async (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<PlayCardPayload>;
      const cardId = asString(p.cardId);
      if (!cardId) {
        emitError(socket, 'illegal_play', 'cardId required');
        return;
      }
      const chosenColor = p.chosenColor ? asPlayableColor(p.chosenColor) : undefined;
      try {
        await turn.playCard(
          ctx.room,
          ctx.token,
          cardId,
          chosenColor ?? undefined,
          Date.now(),
        );
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- DRAW_CARD -------------------------------------------------------
    socket.on(ClientEvents.DRAW_CARD, async (_raw: DrawCardPayload) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        await turn.drawCard(ctx.room, ctx.token, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- PASS_TURN -------------------------------------------------------
    socket.on(ClientEvents.PASS_TURN, async (_raw: PassTurnPayload) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        await turn.passTurn(ctx.room, ctx.token, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- CALL_UNO --------------------------------------------------------
    socket.on(ClientEvents.CALL_UNO, async (_raw: CallUnoPayload) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        await turn.callUno(ctx.room, ctx.token, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- CATCH_UNO -------------------------------------------------------
    socket.on(ClientEvents.CATCH_UNO, async (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<CatchUnoPayload>;
      const targetId = asString(p.targetId);
      if (!targetId) {
        emitError(socket, 'invalid_state', 'targetId required');
        return;
      }
      try {
        await turn.catchUno(ctx.room, ctx.token, targetId, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- CHALLENGE_W4 ----------------------------------------------------
    socket.on(ClientEvents.CHALLENGE_W4, async (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<ChallengeW4Payload>;
      if (typeof p.challenge !== 'boolean') {
        emitError(socket, 'invalid_state', 'challenge boolean required');
        return;
      }
      try {
        await turn.respondToW4Challenge(ctx.room, ctx.token, p.challenge, Date.now());
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- NEXT_ROUND ------------------------------------------------------
    socket.on(ClientEvents.NEXT_ROUND, (_raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        const host = ctx.room.players.find((p) => p.isHost);
        if (!host || host.id !== ctx.token) {
          emitError(socket, 'not_host', 'only host can start next round');
          return;
        }
        if (ctx.room.status !== 'round_end') {
          emitError(socket, 'invalid_state', 'not in round_end');
          return;
        }
        turn.startNextRound(ctx.room, ctx.token, Date.now());
        // Mirror START_GAME: emit GAME_STARTED to each connected player so
        // they receive their fresh hand alongside the new public state.
        const pub = rooms.toPublicRoom(ctx.room);
        const publicState = pub.game;
        if (publicState && ctx.room.game) {
          for (const ep of ctx.room.game.players) {
            const sid = registry.socketFor(ep.id);
            if (sid) {
              io.to(sid).emit(ServerEvents.GAME_STARTED, {
                gameState: publicState,
                yourHand: ep.hand.slice(),
              });
            }
          }
        }
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- PLAY_AGAIN ------------------------------------------------------
    socket.on(ClientEvents.PLAY_AGAIN, (_raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        // resetMatchScores enforces host-only + status===match_end.
        rooms.resetMatchScores(ctx.room, ctx.token);
        // Drop any lingering controller state for this room.
        turn.cleanup(ctx.room.code);
        const pub = rooms.toPublicRoom(ctx.room);
        io.in(ctx.room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });
        // Send full RoomPublic so clients pick up status='waiting' + cleared
        // game state — same pattern as UPDATE_SETTINGS.
        io.in(ctx.room.code).emit(ServerEvents.ROOM_JOINED, {
          roomState: pub,
        });
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- LEAVE_ROOM ------------------------------------------------------
    socket.on(ClientEvents.LEAVE_ROOM, (_raw: LeaveRoomPayload) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      try {
        handleLeave(io, ctx.room, ctx.token, deps, socket);
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- UPDATE_SETTINGS -------------------------------------------------
    socket.on(ClientEvents.UPDATE_SETTINGS, (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<UpdateSettingsPayload>;
      const settings = asSettings(p.settings);
      try {
        rooms.updateSettings(ctx.room, settings, ctx.token);
        const pub = rooms.toPublicRoom(ctx.room);
        io.in(ctx.room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });
        // Settings live on RoomPublic; clients also need them. Re-emit via
        // ROOM_JOINED-style update would change the contract — keep it
        // minimal: send full RoomPublic to the room.
        io.in(ctx.room.code).emit(ServerEvents.ROOM_JOINED, {
          roomState: pub,
        });
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- PROMOTE_SPECTATOR ----------------------------------------------
    socket.on(ClientEvents.PROMOTE_SPECTATOR, (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<PromoteSpectatorPayload>;
      const playerId = asString(p.playerId);
      if (!playerId) {
        emitError(socket, 'invalid_state', 'playerId required');
        return;
      }
      try {
        rooms.promoteSpectator(ctx.room, playerId, ctx.token);
        const pub = rooms.toPublicRoom(ctx.room);
        io.in(ctx.room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- KICK_SPECTATOR -------------------------------------------------
    socket.on(ClientEvents.KICK_SPECTATOR, (raw: unknown) => {
      const ctx = requireContext(socket, registry, rooms);
      if (!ctx) return;
      const p = (isObject(raw) ? raw : {}) as Partial<KickSpectatorPayload>;
      const playerId = asString(p.playerId);
      if (!playerId) {
        emitError(socket, 'invalid_state', 'playerId required');
        return;
      }
      try {
        rooms.kickSpectator(ctx.room, playerId, ctx.token);
        // Disconnect the kicked socket from the room channel if bound.
        const kickedSocketId = registry.socketFor(playerId);
        if (kickedSocketId) {
          const s = io.sockets.sockets.get(kickedSocketId);
          if (s) void s.leave(ctx.room.code);
        }
        const pub = rooms.toPublicRoom(ctx.room);
        io.in(ctx.room.code).emit(ServerEvents.ROOM_UPDATED, {
          players: pub.players,
          spectators: pub.spectators,
        });
      } catch (err) {
        handleRoomError(socket, err);
      }
    });

    // ---- DISCONNECT -----------------------------------------------------
    socket.on('disconnect', () => {
      const token = registry.unbind(socket.id);
      if (!token) return;
      // socket.rooms is empty here — scan all rooms we might be in by trying
      // to find a room whose player id matches our token.
      // We don't have a token→room map; iterate the room manager via the
      // injected facade. Use Array.from(socket.rooms) snapshot taken earlier
      // is unavailable post-disconnect. Resort to a lookup by listing rooms.
      const room = findRoomByPlayerToken(token, rooms);
      if (!room) return;
      const now = Date.now();
      rooms.markDisconnected(room, token, now);
      io.in(room.code).emit(ServerEvents.PLAYER_DISCONNECTED, { playerId: token });
      const pub = rooms.toPublicRoom(room);
      io.in(room.code).emit(ServerEvents.ROOM_UPDATED, {
        players: pub.players,
        spectators: pub.spectators,
      });
      // Forced-skip if it's their turn and no timer is set.
      turn.handleDisconnect(room, token, now);
      // If a host left mid-lobby, joinRoom keeps their seat for grace; no
      // automatic host transfer here — they may reconnect. GC handles cleanup.
    });
  });
}

// ---------------------------------------------------------------------------
// Shared error mapping.
// ---------------------------------------------------------------------------

function handleRoomError(socket: Socket, err: unknown): void {
  if (err instanceof RoomError) {
    socket.emit(ServerEvents.ERROR, { code: err.code, message: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : 'unknown error';
  socket.emit(ServerEvents.ERROR, { code: 'invalid_state', message: msg });
}

// ---------------------------------------------------------------------------
// Leave + cleanup.
// ---------------------------------------------------------------------------

function handleLeave(
  io: Server,
  room: RoomRecord,
  token: string,
  deps: SocketDeps,
  socket: Socket,
): void {
  const { rooms, turn, registry } = deps;
  const code = room.code;
  const result = rooms.leaveRoom(room, token, Date.now());
  registry.unbind(socket.id);
  void socket.leave(code);

  if (result.destroyed) {
    rooms.destroyRoom(code);
    turn.cleanup(code);
    io.in(code).socketsLeave(code);
    return;
  }
  const pub = rooms.toPublicRoom(result.room);
  io.in(code).emit(ServerEvents.ROOM_UPDATED, {
    players: pub.players,
    spectators: pub.spectators,
  });
  if (result.transferredHost) {
    io.in(code).emit(ServerEvents.ROOM_JOINED, {
      roomState: pub,
    });
  }
}

// ---------------------------------------------------------------------------
// Token → room scan.
//
// The room manager does not expose a token→room index. Scanning is O(N rooms)
// which is acceptable for v1 (single-process, modest room counts). We use
// the listRooms export via getRoom indirection: callers pass the facade,
// so we re-import listRooms locally for the disconnect path only.
// ---------------------------------------------------------------------------

import { listRooms } from './roomManager.js';

function findRoomByPlayerToken(
  token: string,
  _rooms: SocketDeps['rooms'],
): RoomRecord | null {
  for (const room of listRooms()) {
    for (const p of room.players) if (p.id === token) return room;
    for (const s of room.spectators) if (s.id === token) return room;
  }
  return null;
}
