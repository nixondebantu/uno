// Socket.io integration tests for P2c — exercise the live event handlers
// against an in-process io.Server + multiple socket.io-client connections.
//
// Each test boots a fresh server on an ephemeral port. Uses an EventLog
// helper to collect emitted events from the moment a client connects, so
// we never race against events emitted before `once()` registers.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';

import { ClientEvents, ServerEvents } from '@uno/shared';
import { TurnController } from '../src/turnController.js';
import { SocketRegistry } from '../src/reconnect.js';
import {
  buildTurnEvents,
  defaultRoomsDeps,
  wireSockets,
} from '../src/sockets.js';
import { _resetForTests as resetRooms } from '../src/roomManager.js';

interface Harness {
  httpServer: HttpServer;
  io: SocketIOServer;
  port: number;
  turn: TurnController;
  registry: SocketRegistry;
}

const ALL_SERVER_EVENTS: string[] = Object.values(ServerEvents);

class EventLog {
  private readonly log: { event: string; payload: unknown }[] = [];
  constructor(private readonly c: ClientSocket) {
    for (const ev of ALL_SERVER_EVENTS) {
      c.on(ev, (payload: unknown) => {
        this.log.push({ event: ev, payload });
      });
    }
  }
  async waitFor<T = unknown>(event: string, timeoutMs = 2000): Promise<T> {
    // Drain existing.
    const existing = this.log.find((e) => e.event === event);
    if (existing) {
      this.consume(event);
      return existing.payload as T;
    }
    return new Promise<T>((resolve, reject) => {
      const tid = setTimeout(() => reject(new Error(`waitFor ${event} timed out`)), timeoutMs);
      const handler = (payload: T): void => {
        clearTimeout(tid);
        resolve(payload);
      };
      this.c.once(event, handler);
    });
  }
  consume(event: string): void {
    const idx = this.log.findIndex((e) => e.event === event);
    if (idx !== -1) this.log.splice(idx, 1);
  }
  collected(event: string): unknown[] {
    return this.log.filter((e) => e.event === event).map((e) => e.payload);
  }
}

async function bootHarness(): Promise<Harness> {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
  const registry = new SocketRegistry();
  const rooms = defaultRoomsDeps();
  const turnEvents = buildTurnEvents(io, rooms, registry);
  const turn = new TurnController(turnEvents, {
    w4ChallengeWindowMs: 50,
    unoCatchWindowMs: 50,
    disconnectGraceMs: 50,
  });
  wireSockets(io, { rooms, turn, registry });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return { httpServer, io, port, turn, registry };
}

async function shutdownHarness(h: Harness): Promise<void> {
  // Disconnect any open sockets server-side.
  h.io.disconnectSockets(true);
  await new Promise<void>((resolve) => h.io.close(() => resolve()));
  await new Promise<void>((resolve) => h.httpServer.close(() => resolve()));
  resetRooms();
}

function makeClient(port: number): ClientSocket {
  return Client(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

function waitConnect(c: ClientSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error('connect timed out')), 2000);
    c.once('connect', () => {
      clearTimeout(tid);
      resolve();
    });
    c.once('connect_error', (err: Error) => {
      clearTimeout(tid);
      reject(err);
    });
  });
}

describe('sockets', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootHarness();
  });
  afterEach(async () => {
    await shutdownHarness(h);
  });

  it('create_room → room_created emitted with code + player_token', async () => {
    const a = makeClient(h.port);
    const logA = new EventLog(a);
    await waitConnect(a);
    a.emit(ClientEvents.CREATE_ROOM, {
      name: 'Alice',
      avatar: 'cat',
      settings: { turnTimerSeconds: null },
    });
    const tok = await logA.waitFor<{ playerToken: string }>(ServerEvents.PLAYER_TOKEN);
    const created = await logA.waitFor<{ roomCode: string; roomState: { code: string } }>(
      ServerEvents.ROOM_CREATED,
    );
    expect(typeof tok.playerToken).toBe('string');
    expect(tok.playerToken.length).toBeGreaterThan(8);
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.roomState.code).toBe(created.roomCode);
    a.disconnect();
  });

  it('join_room → both clients see room_updated; joiner gets room_joined', async () => {
    const a = makeClient(h.port);
    const b = makeClient(h.port);
    const logA = new EventLog(a);
    const logB = new EventLog(b);
    await Promise.all([waitConnect(a), waitConnect(b)]);

    a.emit(ClientEvents.CREATE_ROOM, {
      name: 'Alice',
      avatar: 'cat',
      settings: { turnTimerSeconds: null },
    });
    const created = await logA.waitFor<{ roomCode: string }>(ServerEvents.ROOM_CREATED);
    // Drain the create-time room_updated so we wait for the join-time one.
    await logA.waitFor(ServerEvents.ROOM_UPDATED);

    b.emit(ClientEvents.JOIN_ROOM, {
      roomCode: created.roomCode,
      name: 'Bob',
      avatar: 'dog',
    });
    const bJoined = await logB.waitFor<{ roomState: { code: string } }>(
      ServerEvents.ROOM_JOINED,
    );
    const aUpdate = await logA.waitFor<{ players: { name: string }[] }>(
      ServerEvents.ROOM_UPDATED,
    );
    expect(bJoined.roomState.code).toBe(created.roomCode);
    expect(aUpdate.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

    a.disconnect();
    b.disconnect();
  });

  it('leave_room → room_updated reflects departure; host transfers', async () => {
    const { code, a, b, logA, logB } = await setupTwoPlayers(h);
    void code;

    // Alice (host) leaves.
    a.emit(ClientEvents.LEAVE_ROOM, {});
    const upd = await logB.waitFor<{ players: { name: string; isHost: boolean }[] }>(
      ServerEvents.ROOM_UPDATED,
    );
    expect(upd.players).toHaveLength(1);
    expect(upd.players[0]?.name).toBe('Bob');
    expect(upd.players[0]?.isHost).toBe(true);
    void logA;

    a.disconnect();
    b.disconnect();
  });

  it('start_game from non-host → error', async () => {
    const { a, b, logB } = await setupTwoPlayers(h);
    b.emit(ClientEvents.START_GAME, {});
    const err = await logB.waitFor<{ code: string }>(ServerEvents.ERROR);
    expect(err.code).toBe('not_host');
    a.disconnect();
    b.disconnect();
  });

  it('start_game from host → both players get private your_hand', async () => {
    const { a, b, logA, logB } = await setupTwoPlayers(h);
    a.emit(ClientEvents.START_GAME, {});
    const [aGame, bGame] = await Promise.all([
      logA.waitFor<{ yourHand: { id: string }[] }>(ServerEvents.GAME_STARTED),
      logB.waitFor<{ yourHand: { id: string }[] }>(ServerEvents.GAME_STARTED),
    ]);
    expect(aGame.yourHand).toHaveLength(7);
    expect(bGame.yourHand).toHaveLength(7);
    const aIds = new Set(aGame.yourHand.map((c) => c.id));
    for (const c of bGame.yourHand) expect(aIds.has(c.id)).toBe(false);
    a.disconnect();
    b.disconnect();
  });

  it('play_card with unknown cardId → error event on both clients', async () => {
    const { a, b, logA, logB } = await setupTwoPlayers(h, {
      settings: { turnTimerSeconds: null, w4ChallengeEnabled: false },
    });
    a.emit(ClientEvents.START_GAME, {});
    await Promise.all([
      logA.waitFor(ServerEvents.GAME_STARTED),
      logB.waitFor(ServerEvents.GAME_STARTED),
    ]);
    // Try invalid plays from both. Depending on starting card the current
    // player gets illegal_play and the other not_your_turn, OR if the
    // starting card is Wild both get invalid_state (awaiting starting color).
    a.emit(ClientEvents.PLAY_CARD, { cardId: 'nonexistent' });
    b.emit(ClientEvents.PLAY_CARD, { cardId: 'nonexistent' });
    const eA = await logA.waitFor<{ code: string }>(ServerEvents.ERROR);
    const eB = await logB.waitFor<{ code: string }>(ServerEvents.ERROR);
    const allowed = new Set(['illegal_play', 'not_your_turn', 'invalid_state']);
    expect(allowed.has(eA.code)).toBe(true);
    expect(allowed.has(eB.code)).toBe(true);
    a.disconnect();
    b.disconnect();
  });

  it('disconnect → other clients see player_disconnected', async () => {
    const { a, b, logA, bToken } = await setupTwoPlayers(h);
    b.disconnect();
    const disc = await logA.waitFor<{ playerId: string }>(
      ServerEvents.PLAYER_DISCONNECTED,
    );
    expect(disc.playerId).toBe(bToken);
    a.disconnect();
  });

  it('reconnect with stored token → player_reconnected + game_state + your_hand', async () => {
    const { code, a, b, logA, logB, bToken } = await setupTwoPlayers(h, {
      settings: { turnTimerSeconds: null, w4ChallengeEnabled: false },
    });
    a.emit(ClientEvents.START_GAME, {});
    await Promise.all([
      logA.waitFor(ServerEvents.GAME_STARTED),
      logB.waitFor(ServerEvents.GAME_STARTED),
    ]);

    b.disconnect();
    await logA.waitFor(ServerEvents.PLAYER_DISCONNECTED);

    const b2 = makeClient(h.port);
    const logB2 = new EventLog(b2);
    await waitConnect(b2);
    b2.emit(ClientEvents.JOIN_ROOM, {
      roomCode: code,
      name: 'Bob',
      avatar: 'dog',
      playerToken: bToken,
    });
    const recon = await logA.waitFor<{ playerId: string }>(
      ServerEvents.PLAYER_RECONNECTED,
    );
    const gs = await logB2.waitFor<{ publicState: unknown }>(ServerEvents.GAME_STATE);
    const hand = await logB2.waitFor<{ hand: { id: string }[] }>(ServerEvents.YOUR_HAND);
    expect(recon.playerId).toBe(bToken);
    expect(gs.publicState).toBeTruthy();
    expect(hand.hand.length).toBeGreaterThanOrEqual(7);

    a.disconnect();
    b2.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

interface SetupResult {
  code: string;
  a: ClientSocket;
  b: ClientSocket;
  logA: EventLog;
  logB: EventLog;
  aToken: string;
  bToken: string;
}

async function setupTwoPlayers(
  h: Harness,
  opts: { settings?: Record<string, unknown> } = {},
): Promise<SetupResult> {
  const a = makeClient(h.port);
  const b = makeClient(h.port);
  const logA = new EventLog(a);
  const logB = new EventLog(b);
  await Promise.all([waitConnect(a), waitConnect(b)]);

  a.emit(ClientEvents.CREATE_ROOM, {
    name: 'Alice',
    avatar: 'cat',
    settings: opts.settings ?? { turnTimerSeconds: null },
  });
  const aTokenPayload = await logA.waitFor<{ playerToken: string }>(
    ServerEvents.PLAYER_TOKEN,
  );
  const created = await logA.waitFor<{ roomCode: string }>(ServerEvents.ROOM_CREATED);
  // Drain the create-time room_updated.
  await logA.waitFor(ServerEvents.ROOM_UPDATED);

  b.emit(ClientEvents.JOIN_ROOM, {
    roomCode: created.roomCode,
    name: 'Bob',
    avatar: 'dog',
  });
  const bTokenPayload = await logB.waitFor<{ playerToken: string }>(
    ServerEvents.PLAYER_TOKEN,
  );
  await logB.waitFor(ServerEvents.ROOM_JOINED);
  // Both should see room_updated after join — drain on both sides so tests
  // start from a clean baseline.
  await logA.waitFor(ServerEvents.ROOM_UPDATED);
  await logB.waitFor(ServerEvents.ROOM_UPDATED);

  return {
    code: created.roomCode,
    a,
    b,
    logA,
    logB,
    aToken: aTokenPayload.playerToken,
    bToken: bTokenPayload.playerToken,
  };
}
