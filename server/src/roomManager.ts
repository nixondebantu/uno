// In-memory room registry — CRUD + lifecycle.
//
// Pure module: no Socket.io, no Date.now() (caller supplies `now`), no I/O.
// State lives in a module-private `Map<roomCode, RoomRecord>`; everything else
// either returns new values or mutates the passed `RoomRecord` (each function
// documents which). Concurrency control (per-room mutex) is the caller's job.
//
// References: plan/BUILD_PLAN.md §P2a, PRD §7.1, §7.4, §7.5, §7.7.

import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS_HARD,
  MIN_PLAYERS,
  NAME_MAX,
  NAME_MIN,
  ROOM_CODE_LEN,
  type ErrorCode,
  type GameSettings,
  type PlayerPublic,
  type PublicGameState,
  type RoomPublic,
  type RoomStatus,
} from '@uno/shared';
import type { EngineGameState } from './gameEngine.js';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export interface RoomPlayer {
  /** Stable opaque token persisted in client localStorage; survives reconnects. */
  id: string;
  /** Current socket id (null when disconnected or before first bind). */
  socketId: string | null;
  name: string;
  avatar: string;
  isHost: boolean;
  isSpectator: boolean;
  isConnected: boolean;
  disconnectedAt: number | null;
  score: number;
}

export interface RoomRecord {
  code: string;
  status: RoomStatus;
  settings: GameSettings;
  /** Ordered seating; index = seat number. Mutated in place by manager fns. */
  players: RoomPlayer[];
  spectators: RoomPlayer[];
  game: EngineGameState | null;
  createdAt: number;
  lastActivityAt: number;
  /** Set when every player record is disconnected; cleared on any reconnect. */
  allDisconnectedAt: number | null;
}

export interface CreateHostInput {
  name: string;
  avatar: string;
  playerToken: string;
}

export interface JoinPlayerInput {
  name: string;
  avatar: string;
  playerToken: string;
}

export interface JoinResult {
  room: RoomRecord;
  joinedAs: 'player' | 'spectator';
}

export interface LeaveResult {
  room: RoomRecord;
  /** id of the new host if host changed; else null. */
  transferredHost: string | null;
  /** True iff the room was emptied by this leave and the caller should destroy it. */
  destroyed: boolean;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/** Manager-level error with a stable `code` mapping to ErrorCode (events.ts). */
export class RoomError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RoomError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal store.
// ---------------------------------------------------------------------------

const rooms = new Map<string, RoomRecord>();

/** Test-only escape hatch. Not part of the public contract. */
export function _resetForTests(): void {
  rooms.clear();
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

const NAME_REGEX = /^[A-Za-z0-9 ]+$/;
const ALLOWED_TIMERS: ReadonlyArray<number | null> = [15, 30, 60, null];

export function validateName(name: string): void {
  if (typeof name !== 'string') throw new RoomError('invalid_name');
  // No leading/trailing whitespace surprises.
  if (name !== name.trim()) throw new RoomError('invalid_name');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new RoomError('invalid_name');
  }
  if (!NAME_REGEX.test(name)) throw new RoomError('invalid_name');
}

export function validateSettings(s: Partial<GameSettings>): void {
  if (s.turnTimerSeconds !== undefined) {
    if (!ALLOWED_TIMERS.includes(s.turnTimerSeconds)) {
      throw new RoomError('invalid_settings', 'invalid turnTimerSeconds');
    }
  }
  if (s.pointsToWin !== undefined) {
    if (!Number.isInteger(s.pointsToWin) || s.pointsToWin <= 0) {
      throw new RoomError('invalid_settings', 'invalid pointsToWin');
    }
  }
  if (s.maxPlayers !== undefined) {
    if (
      !Number.isInteger(s.maxPlayers) ||
      s.maxPlayers < MIN_PLAYERS ||
      s.maxPlayers > MAX_PLAYERS_HARD
    ) {
      throw new RoomError('invalid_settings', 'invalid maxPlayers');
    }
  }
  if (s.w4ChallengeEnabled !== undefined) {
    if (typeof s.w4ChallengeEnabled !== 'boolean') {
      throw new RoomError('invalid_settings', 'invalid w4ChallengeEnabled');
    }
  }
}

// ---------------------------------------------------------------------------
// Room code generation.
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    s += CODE_ALPHABET.charAt(idx);
  }
  return s;
}

function generateUniqueCode(): string {
  for (let attempts = 0; attempts < 50; attempts++) {
    const code = generateCode();
    if (!rooms.has(code)) return code;
  }
  throw new RoomError('invalid_state', 'room code generation exhausted');
}

// ---------------------------------------------------------------------------
// Name uniqueness.
// ---------------------------------------------------------------------------

function uniquifyName(desired: string, room: RoomRecord): string {
  const taken = new Set<string>();
  for (const p of room.players) taken.add(p.name);
  for (const s of room.spectators) taken.add(s.name);
  if (!taken.has(desired)) return desired;
  // Append 2, 3, ... until free. Keep within NAME_MAX by trimming the root.
  for (let n = 2; n <= 9999; n++) {
    const suffix = String(n);
    const rootLen = Math.max(1, NAME_MAX - suffix.length);
    const root = desired.slice(0, rootLen);
    const candidate = `${root}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new RoomError('name_taken');
}

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

/** Case-insensitive lookup. Returns null when missing. */
export function getRoom(code: string): RoomRecord | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  return rooms.get(code.toUpperCase()) ?? null;
}

export function listRooms(): RoomRecord[] {
  return Array.from(rooms.values());
}

export function destroyRoom(code: string): void {
  rooms.delete(code.toUpperCase());
}

function findPlayerByToken(
  room: RoomRecord,
  token: string,
): { player: RoomPlayer; bucket: 'players' | 'spectators' } | null {
  for (const p of room.players) {
    if (p.id === token) return { player: p, bucket: 'players' };
  }
  for (const p of room.spectators) {
    if (p.id === token) return { player: p, bucket: 'spectators' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// CRUD.
// ---------------------------------------------------------------------------

/**
 * Create a new room with the host as the first (and only) seated player.
 * Registers the room in the internal map and returns the new RoomRecord.
 *
 * Throws RoomError on invalid name/settings or code-generation exhaustion.
 */
export function createRoom(
  host: CreateHostInput,
  settings: Partial<GameSettings>,
  now: number,
): RoomRecord {
  validateName(host.name);
  validateSettings(settings);

  const finalSettings: GameSettings = { ...DEFAULT_SETTINGS, ...settings };

  const code = generateUniqueCode();
  const hostPlayer: RoomPlayer = {
    id: host.playerToken,
    socketId: null,
    name: host.name,
    avatar: host.avatar,
    isHost: true,
    isSpectator: false,
    isConnected: true,
    disconnectedAt: null,
    score: 0,
  };

  const room: RoomRecord = {
    code,
    status: 'waiting',
    settings: finalSettings,
    players: [hostPlayer],
    spectators: [],
    game: null,
    createdAt: now,
    lastActivityAt: now,
    allDisconnectedAt: null,
  };
  rooms.set(code, room);
  return room;
}

/**
 * Join an existing room (by code, case-insensitive) or reconnect a known
 * player by token. Mutates the room and returns it along with the seating
 * verdict.
 *
 * Behavior:
 *   • Existing token → reconnect: mark connected, clear disconnectedAt,
 *     keep the original seat / spectator slot. Name is NOT changed.
 *   • Else if `status === 'waiting'` AND `players.length < maxPlayers` →
 *     seated as player.
 *   • Else → added as spectator.
 *
 * Throws RoomError('room_not_found' | 'invalid_name').
 */
export function joinRoom(
  code: string,
  player: JoinPlayerInput,
  now: number,
): JoinResult {
  const room = getRoom(code);
  if (!room) throw new RoomError('room_not_found');
  validateName(player.name);

  // Reconnect path: existing token wins regardless of name collisions.
  const existing = findPlayerByToken(room, player.playerToken);
  if (existing) {
    existing.player.isConnected = true;
    existing.player.disconnectedAt = null;
    room.allDisconnectedAt = null;
    room.lastActivityAt = now;
    return {
      room,
      joinedAs: existing.bucket === 'players' ? 'player' : 'spectator',
    };
  }

  const finalName = uniquifyName(player.name, room);

  const asSpectator =
    room.status !== 'waiting' || room.players.length >= room.settings.maxPlayers;

  const record: RoomPlayer = {
    id: player.playerToken,
    socketId: null,
    name: finalName,
    avatar: player.avatar,
    isHost: false,
    isSpectator: asSpectator,
    isConnected: true,
    disconnectedAt: null,
    score: 0,
  };

  if (asSpectator) {
    room.spectators.push(record);
  } else {
    room.players.push(record);
  }
  room.lastActivityAt = now;
  room.allDisconnectedAt = null;

  return { room, joinedAs: asSpectator ? 'spectator' : 'player' };
}

/**
 * Remove a player or spectator from the room. If the leaver was host, transfer
 * host role to the next still-connected player (falling back to the first
 * remaining seat). Mutates the room.
 *
 * Returns:
 *   transferredHost: new host id when a transfer occurred, else null.
 *   destroyed: true iff the room is now empty across both buckets. The caller
 *              should call `destroyRoom(code)`. The 5-minute grace period for
 *              still-present but all-disconnected records is handled by
 *              `runGc`, not here.
 */
export function leaveRoom(
  room: RoomRecord,
  playerToken: string,
  now: number,
): LeaveResult {
  let wasHost = false;
  let removed = false;

  const playerIdx = room.players.findIndex((p) => p.id === playerToken);
  if (playerIdx !== -1) {
    const p = room.players[playerIdx] as RoomPlayer;
    wasHost = p.isHost;
    room.players.splice(playerIdx, 1);
    removed = true;
  } else {
    const specIdx = room.spectators.findIndex((p) => p.id === playerToken);
    if (specIdx !== -1) {
      room.spectators.splice(specIdx, 1);
      removed = true;
    }
  }

  if (!removed) {
    return { room, transferredHost: null, destroyed: false };
  }

  room.lastActivityAt = now;

  let transferredHost: string | null = null;
  if (wasHost && room.players.length > 0) {
    const next =
      room.players.find((p) => p.isConnected) ?? (room.players[0] as RoomPlayer);
    next.isHost = true;
    transferredHost = next.id;
  }

  // Recompute allDisconnectedAt: if no connected player remains, set it.
  const anyPlayerConnected = room.players.some((p) => p.isConnected);
  if (room.players.length > 0 && !anyPlayerConnected && room.allDisconnectedAt === null) {
    room.allDisconnectedAt = now;
  } else if (anyPlayerConnected) {
    room.allDisconnectedAt = null;
  }

  const destroyed = room.players.length === 0 && room.spectators.length === 0;
  return { room, transferredHost, destroyed };
}

// ---------------------------------------------------------------------------
// Connection lifecycle.
// ---------------------------------------------------------------------------

/**
 * Mark the named player as disconnected. Sets `allDisconnectedAt` when this
 * was the last connected member of the players bucket (spectators don't keep
 * the grace timer alive). Mutates the room. No-op if the token is unknown.
 */
export function markDisconnected(
  room: RoomRecord,
  playerToken: string,
  now: number,
): void {
  const hit = findPlayerByToken(room, playerToken);
  if (!hit) return;
  hit.player.isConnected = false;
  hit.player.disconnectedAt = now;
  room.lastActivityAt = now;

  const anyPlayerConnected = room.players.some((p) => p.isConnected);
  if (!anyPlayerConnected && room.allDisconnectedAt === null) {
    room.allDisconnectedAt = now;
  }
}

/**
 * Rebind the named player's socket id, mark them connected, clear stale
 * timestamps. Mutates the room. No-op if the token is unknown.
 */
export function markConnected(
  room: RoomRecord,
  playerToken: string,
  socketId: string,
  now: number,
): void {
  const hit = findPlayerByToken(room, playerToken);
  if (!hit) return;
  hit.player.isConnected = true;
  hit.player.disconnectedAt = null;
  hit.player.socketId = socketId;
  room.lastActivityAt = now;
  room.allDisconnectedAt = null;
}

// ---------------------------------------------------------------------------
// Host operations.
// ---------------------------------------------------------------------------

function assertHost(room: RoomRecord, requesterToken: string): void {
  const requester = room.players.find((p) => p.id === requesterToken);
  if (!requester || !requester.isHost) {
    throw new RoomError('not_host');
  }
}

/**
 * Move a spectator into the players bucket. Host-only. Allowed only between
 * rounds (status === 'waiting' or 'round_end') per PRD §7.7. Mutates room
 * and returns it.
 */
export function promoteSpectator(
  room: RoomRecord,
  playerToken: string,
  requesterToken: string,
): RoomRecord {
  assertHost(room, requesterToken);
  if (room.status !== 'waiting' && room.status !== 'round_end') {
    throw new RoomError('invalid_state');
  }
  if (room.players.length >= room.settings.maxPlayers) {
    throw new RoomError('room_full');
  }
  const specIdx = room.spectators.findIndex((s) => s.id === playerToken);
  if (specIdx === -1) throw new RoomError('invalid_state', 'not a spectator');
  const spec = room.spectators[specIdx] as RoomPlayer;
  room.spectators.splice(specIdx, 1);
  spec.isSpectator = false;
  room.players.push(spec);
  return room;
}

/** Host-only spectator removal. Mutates the room. */
export function kickSpectator(
  room: RoomRecord,
  playerToken: string,
  requesterToken: string,
): RoomRecord {
  assertHost(room, requesterToken);
  const specIdx = room.spectators.findIndex((s) => s.id === playerToken);
  if (specIdx === -1) throw new RoomError('invalid_state', 'not a spectator');
  room.spectators.splice(specIdx, 1);
  return room;
}

/**
 * Update settings — host only, lobby (`waiting`) only. Each field is validated
 * against allowed values; an invalid field aborts the whole update with
 * RoomError('invalid_settings'). Mutates the room.
 */
export function updateSettings(
  room: RoomRecord,
  settings: Partial<GameSettings>,
  requesterToken: string,
): RoomRecord {
  assertHost(room, requesterToken);
  if (room.status !== 'waiting') throw new RoomError('invalid_state');
  validateSettings(settings);
  room.settings = { ...room.settings, ...settings };
  return room;
}

/**
 * Reset cumulative scores and return the room to lobby. Host-only; allowed
 * only after a completed match (status === 'match_end'). Mutates the room.
 */
export function resetMatchScores(
  room: RoomRecord,
  requesterToken: string,
): RoomRecord {
  assertHost(room, requesterToken);
  if (room.status !== 'match_end') {
    throw new RoomError('invalid_state', 'match has not ended');
  }
  for (const p of room.players) p.score = 0;
  room.game = null;
  room.status = 'waiting';
  return room;
}

/**
 * Inject engine state and status into the room. Used by turnController to
 * push the authoritative game state after each mutation. Mutates the room.
 */
export function setGameState(
  room: RoomRecord,
  game: EngineGameState | null,
  status: RoomStatus,
): RoomRecord {
  room.game = game;
  room.status = status;
  return room;
}

// ---------------------------------------------------------------------------
// Public-state projection (strips socketIds / hand contents).
// ---------------------------------------------------------------------------

function toPublicPlayer(p: RoomPlayer, cardCount: number): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    isConnected: p.isConnected,
    isSpectator: p.isSpectator,
    isHost: p.isHost,
    score: p.score,
    cardCount,
  };
}

/**
 * Build the broadcast-safe RoomPublic snapshot. Card counts come from the
 * engine state (matched by player id) when available; 0 otherwise. Pure.
 */
export function toPublicRoom(room: RoomRecord): RoomPublic {
  const handByPlayerId = new Map<string, number>();
  if (room.game) {
    for (const ep of room.game.players) {
      handByPlayerId.set(ep.id, ep.hand.length);
    }
  }
  const host = room.players.find((p) => p.isHost);
  const hostId = host ? host.id : (room.players[0]?.id ?? '');

  return {
    code: room.code,
    hostId,
    status: room.status,
    players: room.players.map((p) =>
      toPublicPlayer(p, handByPlayerId.get(p.id) ?? 0),
    ),
    spectators: room.spectators.map((p) => toPublicPlayer(p, 0)),
    settings: { ...room.settings },
    game: toPublicGameState(room.game, room.settings.turnTimerSeconds),
  };
}

/**
 * Project engine state to the broadcast-safe shape. `turnTimerSeconds` comes
 * from the room settings (caller responsibility — kept as a parameter so this
 * stays a pure projection without re-reading the room map). Null when no
 * active game.
 */
export function toPublicGameState(
  game: EngineGameState | null,
  turnTimerSeconds: number | null,
): PublicGameState | null {
  if (!game) return null;
  const topCard = game.discardPile[game.discardPile.length - 1];
  if (!topCard) return null;
  return {
    topCard,
    currentColor: game.currentColor,
    direction: game.direction,
    currentTurnIndex: game.currentTurnIndex,
    turnStartedAt: game.turnStartedAt,
    turnTimerSeconds,
    round: game.round,
    drawPileCount: game.deck.length,
    discardPileCount: game.discardPile.length,
  };
}

// ---------------------------------------------------------------------------
// Garbage collection.
// ---------------------------------------------------------------------------

export interface GcOptions {
  /** Destroy rooms where `now - lastActivityAt > inactivityMs`. */
  inactivityMs: number;
  /** Destroy rooms where `allDisconnectedAt + grace < now`. */
  allDisconnectedGraceMs: number;
}

/**
 * Sweep the room map. Destroys rooms that have:
 *   • been inactive longer than `inactivityMs`, OR
 *   • had all players disconnected longer than `allDisconnectedGraceMs`.
 *
 * Returns the destroyed room codes. Caller broadcasts as desired.
 */
export function runGc(now: number, opts: GcOptions): string[] {
  const destroyed: string[] = [];
  for (const [code, room] of rooms) {
    const inactive = now - room.lastActivityAt > opts.inactivityMs;
    const graceExpired =
      room.allDisconnectedAt !== null &&
      now - room.allDisconnectedAt > opts.allDisconnectedGraceMs;
    if (inactive || graceExpired) {
      rooms.delete(code);
      destroyed.push(code);
    }
  }
  return destroyed;
}
