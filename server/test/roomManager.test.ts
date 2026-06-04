import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetForTests,
  createRoom,
  destroyRoom,
  getRoom,
  joinRoom,
  kickSpectator,
  leaveRoom,
  listRooms,
  markConnected,
  markDisconnected,
  promoteSpectator,
  RoomError,
  runGc,
  setGameState,
  toPublicGameState,
  toPublicRoom,
  updateSettings,
  validateName,
  validateSettings,
  type RoomRecord,
} from '../src/roomManager.js';
import { DEFAULT_SETTINGS, ROOM_CODE_LEN } from '@uno/shared';

const T0 = 1_700_000_000_000;

function host(name = 'Alice', token = 'tok-a'): {
  name: string;
  avatar: string;
  playerToken: string;
} {
  return { name, avatar: 'fox', playerToken: token };
}

function guest(name: string, token: string): {
  name: string;
  avatar: string;
  playerToken: string;
} {
  return { name, avatar: 'cat', playerToken: token };
}

beforeEach(() => {
  _resetForTests();
});

// ---------------------------------------------------------------------------
// validateName / validateSettings
// ---------------------------------------------------------------------------

describe('validateName', () => {
  it('accepts 2–16 alphanumeric + spaces', () => {
    expect(() => validateName('Al')).not.toThrow();
    expect(() => validateName('Alice Smith 12')).not.toThrow();
    expect(() => validateName('A123456789012345')).not.toThrow();
  });

  it('rejects too short', () => {
    expect(() => validateName('A')).toThrow(RoomError);
  });

  it('rejects too long', () => {
    expect(() => validateName('A12345678901234567')).toThrow(RoomError);
  });

  it('rejects punctuation', () => {
    expect(() => validateName('Al!ce')).toThrow(RoomError);
    expect(() => validateName('Al_ce')).toThrow(RoomError);
    expect(() => validateName('Al-ce')).toThrow(RoomError);
  });

  it('rejects leading/trailing whitespace', () => {
    expect(() => validateName(' Alice')).toThrow(RoomError);
    expect(() => validateName('Alice ')).toThrow(RoomError);
  });
});

describe('validateSettings', () => {
  it('accepts allowed values', () => {
    expect(() =>
      validateSettings({
        turnTimerSeconds: 30,
        pointsToWin: 500,
        maxPlayers: 8,
        w4ChallengeEnabled: true,
      }),
    ).not.toThrow();
    expect(() => validateSettings({ turnTimerSeconds: null })).not.toThrow();
  });

  it('rejects bad timer', () => {
    expect(() => validateSettings({ turnTimerSeconds: 45 })).toThrow(RoomError);
  });

  it('rejects bad pointsToWin', () => {
    expect(() => validateSettings({ pointsToWin: 0 })).toThrow(RoomError);
    expect(() => validateSettings({ pointsToWin: -5 })).toThrow(RoomError);
  });

  it('rejects bad maxPlayers', () => {
    expect(() => validateSettings({ maxPlayers: 1 })).toThrow(RoomError);
    expect(() => validateSettings({ maxPlayers: 13 })).toThrow(RoomError);
  });

  it('rejects non-boolean w4ChallengeEnabled', () => {
    // @ts-expect-error intentional bad type
    expect(() => validateSettings({ w4ChallengeEnabled: 'yes' })).toThrow(
      RoomError,
    );
  });
});

// ---------------------------------------------------------------------------
// createRoom / getRoom
// ---------------------------------------------------------------------------

describe('createRoom + getRoom', () => {
  it('creates a room with host seated and default settings', () => {
    const room = createRoom(host(), {}, T0);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]?.isHost).toBe(true);
    expect(room.players[0]?.isConnected).toBe(true);
    expect(room.status).toBe('waiting');
    expect(room.settings).toEqual(DEFAULT_SETTINGS);
    expect(room.createdAt).toBe(T0);
    expect(room.lastActivityAt).toBe(T0);
    expect(room.allDisconnectedAt).toBeNull();
  });

  it('merges partial settings over defaults', () => {
    const room = createRoom(host(), { pointsToWin: 200 }, T0);
    expect(room.settings.pointsToWin).toBe(200);
    expect(room.settings.maxPlayers).toBe(DEFAULT_SETTINGS.maxPlayers);
  });

  it('generated code is 6 chars, uppercase A–Z 0–9', () => {
    const room = createRoom(host(), {}, T0);
    expect(room.code).toHaveLength(ROOM_CODE_LEN);
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('getRoom is case-insensitive', () => {
    const room = createRoom(host(), {}, T0);
    expect(getRoom(room.code)).toBe(room);
    expect(getRoom(room.code.toLowerCase())).toBe(room);
    expect(getRoom('does-not-exist')).toBeNull();
  });

  it('rejects invalid host name', () => {
    expect(() => createRoom(host('!!'), {}, T0)).toThrow(RoomError);
  });

  it('rejects invalid settings', () => {
    expect(() =>
      createRoom(host(), { turnTimerSeconds: 42 }, T0),
    ).toThrow(RoomError);
  });
});

// ---------------------------------------------------------------------------
// joinRoom
// ---------------------------------------------------------------------------

describe('joinRoom', () => {
  it('seats a player when status==="waiting" and room not full', () => {
    const room = createRoom(host(), {}, T0);
    const { joinedAs, room: r } = joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    expect(joinedAs).toBe('player');
    expect(r.players).toHaveLength(2);
    expect(r.players[1]?.name).toBe('Bob');
  });

  it('appends "2" when name collides; "3" on a second collision', () => {
    const room = createRoom(host('Alice'), {}, T0);
    const j1 = joinRoom(room.code, guest('Alice', 'tok-b'), T0 + 1);
    expect(j1.room.players[1]?.name).toBe('Alice2');
    const j2 = joinRoom(room.code, guest('Alice', 'tok-c'), T0 + 2);
    expect(j2.room.players[2]?.name).toBe('Alice3');
  });

  it('joins as spectator when room full', () => {
    const room = createRoom(host(), { maxPlayers: 2 }, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    const { joinedAs, room: r } = joinRoom(
      room.code,
      guest('Cara', 'tok-c'),
      T0 + 2,
    );
    expect(joinedAs).toBe('spectator');
    expect(r.spectators).toHaveLength(1);
    expect(r.spectators[0]?.isSpectator).toBe(true);
  });

  it('joins as spectator when status==="playing"', () => {
    const room = createRoom(host(), {}, T0);
    setGameState(room, null, 'playing');
    const { joinedAs } = joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    expect(joinedAs).toBe('spectator');
  });

  it('rebinds same record on reconnect by playerToken', () => {
    const room = createRoom(host(), {}, T0);
    const j1 = joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    expect(j1.room.players).toHaveLength(2);
    const seatedBob = j1.room.players[1];

    // Simulate disconnect, then rejoin with same token.
    markDisconnected(j1.room, 'tok-b', T0 + 5);
    expect(seatedBob?.isConnected).toBe(false);

    const j2 = joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 10);
    expect(j2.joinedAs).toBe('player');
    expect(j2.room.players).toHaveLength(2);
    // Same record reference (mutated).
    expect(j2.room.players[1]).toBe(seatedBob);
    expect(seatedBob?.isConnected).toBe(true);
    expect(seatedBob?.disconnectedAt).toBeNull();
  });

  it('throws room_not_found for unknown code', () => {
    expect(() => joinRoom('NOPE12', guest('Bob', 'tok-b'), T0)).toThrow(
      RoomError,
    );
  });
});

// ---------------------------------------------------------------------------
// leaveRoom
// ---------------------------------------------------------------------------

describe('leaveRoom', () => {
  it('transfers host to next connected player when host leaves', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    joinRoom(room.code, guest('Cara', 'tok-c'), T0 + 2);

    const { transferredHost, destroyed } = leaveRoom(room, 'tok-a', T0 + 5);
    expect(destroyed).toBe(false);
    expect(transferredHost).toBe('tok-b');
    expect(room.players[0]?.isHost).toBe(true);
    expect(room.players[0]?.id).toBe('tok-b');
  });

  it('skips disconnected seats when transferring host', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    joinRoom(room.code, guest('Cara', 'tok-c'), T0 + 2);
    markDisconnected(room, 'tok-b', T0 + 3);

    const { transferredHost } = leaveRoom(room, 'tok-a', T0 + 5);
    expect(transferredHost).toBe('tok-c');
  });

  it('returns destroyed=true when last record leaves', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    const res = leaveRoom(room, 'tok-a', T0 + 5);
    expect(res.destroyed).toBe(true);
    expect(res.transferredHost).toBeNull();
  });

  it('removes spectator without host transfer', () => {
    const room = createRoom(host(), { maxPlayers: 2 }, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    joinRoom(room.code, guest('Cara', 'tok-c'), T0 + 2); // spectator
    expect(room.spectators).toHaveLength(1);
    const res = leaveRoom(room, 'tok-c', T0 + 5);
    expect(res.destroyed).toBe(false);
    expect(res.transferredHost).toBeNull();
    expect(room.spectators).toHaveLength(0);
  });

  it('no-ops on unknown token', () => {
    const room = createRoom(host(), {}, T0);
    const res = leaveRoom(room, 'tok-x', T0 + 5);
    expect(res.destroyed).toBe(false);
    expect(res.transferredHost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markDisconnected / markConnected
// ---------------------------------------------------------------------------

describe('markDisconnected + markConnected', () => {
  it('sets allDisconnectedAt when last connected player drops', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    markDisconnected(room, 'tok-a', T0 + 2);
    expect(room.allDisconnectedAt).toBeNull(); // Bob still connected
    markDisconnected(room, 'tok-b', T0 + 3);
    expect(room.allDisconnectedAt).toBe(T0 + 3);
  });

  it('clears allDisconnectedAt on reconnect', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    markDisconnected(room, 'tok-a', T0 + 1);
    expect(room.allDisconnectedAt).toBe(T0 + 1);
    markConnected(room, 'tok-a', 'sock-1', T0 + 2);
    expect(room.allDisconnectedAt).toBeNull();
    expect(room.players[0]?.isConnected).toBe(true);
    expect(room.players[0]?.socketId).toBe('sock-1');
  });

  it('is a silent no-op for unknown token', () => {
    const room = createRoom(host(), {}, T0);
    expect(() => markDisconnected(room, 'tok-x', T0 + 1)).not.toThrow();
    expect(() => markConnected(room, 'tok-x', 'sock-x', T0 + 1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// promoteSpectator / kickSpectator
// ---------------------------------------------------------------------------

describe('promoteSpectator', () => {
  function setup(): RoomRecord {
    const room = createRoom(host('Alice', 'tok-a'), { maxPlayers: 2 }, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    joinRoom(room.code, guest('Cara', 'tok-c'), T0 + 2); // spectator
    return room;
  }

  it('requires host requester', () => {
    const room = setup();
    expect(() => promoteSpectator(room, 'tok-c', 'tok-b')).toThrow(RoomError);
  });

  it('refuses when status==="playing"', () => {
    const room = setup();
    setGameState(room, null, 'playing');
    // Make room for the promotion or it'll throw room_full first.
    room.settings.maxPlayers = 3;
    expect(() => promoteSpectator(room, 'tok-c', 'tok-a')).toThrow(RoomError);
  });

  it('allows in waiting / round_end', () => {
    const room = setup();
    room.settings.maxPlayers = 3;
    promoteSpectator(room, 'tok-c', 'tok-a');
    expect(room.players).toHaveLength(3);
    expect(room.spectators).toHaveLength(0);
    expect(room.players[2]?.isSpectator).toBe(false);
  });

  it('rejects when room is full', () => {
    const room = setup();
    // maxPlayers=2 here, players already 2 → promoting Cara should fail.
    expect(() => promoteSpectator(room, 'tok-c', 'tok-a')).toThrow(RoomError);
  });
});

describe('kickSpectator', () => {
  it('host-only spectator removal', () => {
    const room = createRoom(host('Alice', 'tok-a'), { maxPlayers: 2 }, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    joinRoom(room.code, guest('Cara', 'tok-c'), T0 + 2);
    expect(() => kickSpectator(room, 'tok-c', 'tok-b')).toThrow(RoomError);
    kickSpectator(room, 'tok-c', 'tok-a');
    expect(room.spectators).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe('updateSettings', () => {
  it('host only', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    joinRoom(room.code, guest('Bob', 'tok-b'), T0 + 1);
    expect(() =>
      updateSettings(room, { pointsToWin: 200 }, 'tok-b'),
    ).toThrow(RoomError);
  });

  it('waiting only', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    setGameState(room, null, 'playing');
    expect(() =>
      updateSettings(room, { pointsToWin: 200 }, 'tok-a'),
    ).toThrow(RoomError);
  });

  it('validates fields', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    expect(() =>
      updateSettings(room, { pointsToWin: 0 }, 'tok-a'),
    ).toThrow(RoomError);
  });

  it('merges valid partials', () => {
    const room = createRoom(host('Alice', 'tok-a'), {}, T0);
    updateSettings(
      room,
      { pointsToWin: 1000, turnTimerSeconds: null },
      'tok-a',
    );
    expect(room.settings.pointsToWin).toBe(1000);
    expect(room.settings.turnTimerSeconds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toPublicRoom / toPublicGameState
// ---------------------------------------------------------------------------

describe('toPublicRoom / toPublicGameState', () => {
  it('strips socketIds and includes cardCount = 0 when no game', () => {
    const room = createRoom(host(), {}, T0);
    const pub = toPublicRoom(room);
    expect(pub.players[0]?.cardCount).toBe(0);
    expect(pub.game).toBeNull();
    // No socketId field on PlayerPublic.
    expect((pub.players[0] as Record<string, unknown>).socketId).toBeUndefined();
  });

  it('toPublicGameState null when no game', () => {
    expect(toPublicGameState(null, 30)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runGc
// ---------------------------------------------------------------------------

describe('runGc', () => {
  it('destroys rooms idle past inactivityMs', () => {
    const room = createRoom(host(), {}, T0);
    const code = room.code;
    const destroyed = runGc(T0 + 31 * 60_000, {
      inactivityMs: 30 * 60_000,
      allDisconnectedGraceMs: 5 * 60_000,
    });
    expect(destroyed).toContain(code);
    expect(getRoom(code)).toBeNull();
  });

  it('destroys rooms past all-disconnected grace', () => {
    const room = createRoom(host(), {}, T0);
    const code = room.code;
    markDisconnected(room, room.players[0]!.id, T0 + 1000);
    expect(room.allDisconnectedAt).toBe(T0 + 1000);
    const destroyed = runGc(T0 + 1000 + 6 * 60_000, {
      inactivityMs: 30 * 60_000,
      allDisconnectedGraceMs: 5 * 60_000,
    });
    expect(destroyed).toContain(code);
  });

  it('keeps healthy rooms', () => {
    const room = createRoom(host(), {}, T0);
    const code = room.code;
    const destroyed = runGc(T0 + 10_000, {
      inactivityMs: 30 * 60_000,
      allDisconnectedGraceMs: 5 * 60_000,
    });
    expect(destroyed).not.toContain(code);
    expect(getRoom(code)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// destroyRoom / listRooms
// ---------------------------------------------------------------------------

describe('destroyRoom + listRooms', () => {
  it('destroyRoom is case-insensitive', () => {
    const room = createRoom(host(), {}, T0);
    destroyRoom(room.code.toLowerCase());
    expect(getRoom(room.code)).toBeNull();
  });

  it('listRooms returns all live rooms', () => {
    createRoom(host('Al', 'tok-1'), {}, T0);
    createRoom(host('Bo', 'tok-2'), {}, T0);
    expect(listRooms()).toHaveLength(2);
  });
});
