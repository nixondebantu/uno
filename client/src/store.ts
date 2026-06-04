// App-wide reactive store backed by Preact signals.
//
// One source of truth for screen routing, room state, your hand, ephemeral
// prompts (W4 challenge, starting color, playable-drawn), and toast queue.
// `wireServerEvents()` plugs the socket transport into these signals — call
// exactly once at boot.

import { signal, computed, type ReadonlySignal } from '@preact/signals';
import {
  ServerEvents,
  type Card,
  type PublicGameState,
  type RoomPublic,
  type ErrorCode,
} from '@uno/shared';

import { on, setPlayerToken } from './socket.js';
import { navigate } from './router.js';

// ---------- Screen routing ----------

export type Screen = 'home' | 'lobby' | 'game' | 'round_end' | 'match_end';

export const screen = signal<Screen>('home');

// ---------- Core room/game state ----------

export const roomState = signal<RoomPublic | null>(null);
export const myHand = signal<Card[]>([]);
export const myId = signal<string | null>(null);
export const gameState = signal<PublicGameState | null>(null);

// ---------- Ephemeral UI prompts ----------

export const awaitingStartingColor = signal<boolean>(false);

export interface W4ChallengePromptState {
  againstPlayerId: string;
  deadlineMs: number;
}
export const w4ChallengePrompt = signal<W4ChallengePromptState | null>(null);

// Card the server told you that you just drew and may play right now.
export const playableDrawn = signal<Card | null>(null);

// Latest server error (e.g. illegal_play) — components can read + clear.
export interface PendingError {
  code: ErrorCode;
  message: string;
}
export const pendingError = signal<PendingError | null>(null);

// ---------- UNO call state ----------

// Derived: you're at 1 card AND you haven't yet been recorded as having
// called UNO. The actual "did I call" tracking is server-authoritative; we
// surface a button as long as the player has exactly one card left.
export const unoCallable: ReadonlySignal<boolean> = computed(
  () => myHand.value.length === 1,
);

// ---------- Round/match end payloads ----------

export interface RoundEndState {
  winnerId: string;
  scores: Record<string, number>;
  hands: Record<string, Card[]>;
}
export const roundEndState = signal<RoundEndState | null>(null);

export interface MatchEndState {
  winnerId: string;
  finalScores: Record<string, number>;
}
export const matchEndState = signal<MatchEndState | null>(null);

// ---------- Toasts ----------

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  expiresAt: number;
}

export const toasts = signal<Toast[]>([]);

let toastCounter = 0;
function nextToastId(): string {
  toastCounter += 1;
  return `t${toastCounter}_${Date.now()}`;
}

export function pushToast(
  kind: ToastKind,
  message: string,
  ttlMs = 3000,
): string {
  const id = nextToastId();
  const expiresAt = Date.now() + ttlMs;
  toasts.value = [...toasts.value, { id, kind, message, expiresAt }];
  if (ttlMs > 0) {
    window.setTimeout(() => dismissToast(id), ttlMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// ---------- Helpers ----------

function findPlayerName(id: string): string {
  const room = roomState.value;
  if (!room) return id;
  const inPlayers = room.players.find((p) => p.id === id);
  if (inPlayers) return inPlayers.name;
  const inSpectators = room.spectators.find((p) => p.id === id);
  return inSpectators ? inSpectators.name : id;
}

function navigateForRoom(room: RoomPublic): void {
  // Keep URL in sync with room code so a refresh lands you back in the room.
  const expectedPath = `/room/${room.code}`;
  if (window.location.pathname !== expectedPath) {
    navigate(expectedPath, { replace: true });
  }
  // Screen follows room status. Round/match end screens are layered when their
  // specific events fire — ROOM_UPDATED alone keeps the player in lobby/game.
  if (room.status === 'waiting') {
    screen.value = 'lobby';
  } else if (room.status === 'playing') {
    screen.value = 'game';
  } else if (room.status === 'round_end') {
    screen.value = 'round_end';
  } else if (room.status === 'match_end') {
    screen.value = 'match_end';
  }
}

// ---------- Server event wiring ----------

let wired = false;

/**
 * Subscribe every server event to its corresponding signal mutation. Safe to
 * call multiple times — second+ calls are no-ops.
 */
export function wireServerEvents(): void {
  if (wired) return;
  wired = true;

  on(ServerEvents.PLAYER_TOKEN, (payload) => {
    setPlayerToken(payload.playerToken);
    myId.value = payload.playerToken;
  });

  on(ServerEvents.ROOM_CREATED, (payload) => {
    roomState.value = payload.roomState;
    gameState.value = payload.roomState.game;
    navigateForRoom(payload.roomState);
  });

  on(ServerEvents.ROOM_JOINED, (payload) => {
    roomState.value = payload.roomState;
    gameState.value = payload.roomState.game;
    navigateForRoom(payload.roomState);
  });

  on(ServerEvents.ROOM_UPDATED, (payload) => {
    const prev = roomState.value;
    if (!prev) {
      // No baseline room — can't reconstruct shape; ignore (server will resend
      // a full ROOM_JOINED on reconnect).
      return;
    }
    roomState.value = {
      ...prev,
      players: payload.players,
      spectators: payload.spectators,
    };
  });

  on(ServerEvents.GAME_STARTED, (payload) => {
    gameState.value = payload.gameState;
    myHand.value = payload.yourHand;
    const prev = roomState.value;
    if (prev) {
      const next: RoomPublic = {
        ...prev,
        status: 'playing',
        game: payload.gameState,
      };
      roomState.value = next;
      navigateForRoom(next);
    } else {
      screen.value = 'game';
    }
    // Clear any stale round/match end state from a previous game.
    roundEndState.value = null;
    matchEndState.value = null;
  });

  on(ServerEvents.GAME_STATE, (payload) => {
    gameState.value = payload.publicState;
    const prev = roomState.value;
    if (prev) {
      roomState.value = { ...prev, game: payload.publicState };
    }
  });

  on(ServerEvents.YOUR_HAND, (payload) => {
    myHand.value = payload.hand;
  });

  on(ServerEvents.TURN_START, (payload) => {
    // Clear ephemeral prompts each turn — they're scoped to a single action.
    w4ChallengePrompt.value = null;
    playableDrawn.value = null;
    const prev = gameState.value;
    if (prev) {
      const playerIndex = roomState.value?.players.findIndex(
        (p) => p.id === payload.playerId,
      );
      gameState.value = {
        ...prev,
        currentTurnIndex:
          typeof playerIndex === 'number' && playerIndex >= 0
            ? playerIndex
            : prev.currentTurnIndex,
        turnStartedAt: payload.serverTimestamp,
        turnTimerSeconds: payload.timerSeconds,
      };
    }
    if (payload.playerId !== myId.value) {
      pushToast('info', `${findPlayerName(payload.playerId)}'s turn`, 1800);
    }
  });

  on(ServerEvents.CARD_PLAYED, (payload) => {
    if (payload.playerId !== myId.value) {
      pushToast(
        'info',
        `${findPlayerName(payload.playerId)} played ${payload.card.color} ${payload.card.type}`,
        2200,
      );
    }
  });

  on(ServerEvents.CARD_DRAWN, (payload) => {
    if (payload.playerId !== myId.value) {
      const count = payload.cardCount;
      pushToast(
        'info',
        `${findPlayerName(payload.playerId)} drew ${count} card${count === 1 ? '' : 's'}`,
        2000,
      );
    }
  });

  on(ServerEvents.UNO_CALLED, (payload) => {
    pushToast('success', `${findPlayerName(payload.playerId)} called UNO!`);
  });

  on(ServerEvents.UNO_CAUGHT, (payload) => {
    pushToast(
      'warn',
      `${findPlayerName(payload.caughtId)} forgot UNO — +${payload.penaltyCards}`,
      3500,
    );
  });

  on(ServerEvents.W4_CHALLENGE_PROMPT, (payload) => {
    // Server addresses this private event only to the would-be challenger; if
    // it ever fans out, we still guard by checking our id.
    w4ChallengePrompt.value = {
      againstPlayerId: payload.againstPlayerId,
      deadlineMs: payload.deadlineMs,
    };
  });

  on(ServerEvents.W4_CHALLENGE_RESULT, (payload) => {
    w4ChallengePrompt.value = null;
    const winnerName = findPlayerName(payload.winnerId);
    const loserName = findPlayerName(payload.loserId);
    pushToast(
      'info',
      `Challenge: ${winnerName} won, ${loserName} draws ${payload.cardsDrawn}`,
      3500,
    );
  });

  on(ServerEvents.PLAYABLE_DRAWN, (payload) => {
    playableDrawn.value = payload.card;
  });

  on(ServerEvents.PLAYER_DISCONNECTED, (payload) => {
    pushToast('warn', `${findPlayerName(payload.playerId)} disconnected`);
  });

  on(ServerEvents.PLAYER_RECONNECTED, (payload) => {
    pushToast('success', `${findPlayerName(payload.playerId)} reconnected`);
  });

  on(ServerEvents.ROUND_END, (payload) => {
    roundEndState.value = {
      winnerId: payload.winnerId,
      scores: payload.scores,
      hands: payload.hands,
    };
    screen.value = 'round_end';
    const prev = roomState.value;
    if (prev) {
      roomState.value = { ...prev, status: 'round_end' };
    }
  });

  on(ServerEvents.MATCH_END, (payload) => {
    matchEndState.value = {
      winnerId: payload.winnerId,
      finalScores: payload.finalScores,
    };
    screen.value = 'match_end';
    const prev = roomState.value;
    if (prev) {
      roomState.value = { ...prev, status: 'match_end' };
    }
  });

  on(ServerEvents.GAME_PAUSED, (payload) => {
    pushToast(
      'warn',
      payload.reason === 'all_disconnected'
        ? 'Game paused — all players disconnected'
        : 'Game paused — waiting for players',
      4000,
    );
  });

  on(ServerEvents.GAME_RESUMED, () => {
    pushToast('success', 'Game resumed');
  });

  on(ServerEvents.AWAITING_STARTING_COLOR, (payload) => {
    // Host UI only — the prompt is meaningful when *you* are the host.
    awaitingStartingColor.value = payload.hostId === myId.value;
  });

  on(ServerEvents.ERROR, (payload) => {
    pendingError.value = { code: payload.code, message: payload.message };
    pushToast('error', payload.message, 3500);
  });
}
