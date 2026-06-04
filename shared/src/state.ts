// Room / game state shapes shared between server and client.
// `Public*` shapes are safe to broadcast; `Private*` shapes ship only to the owning player.

import type { Card, PlayableColor } from './cards.js';

export type RoomStatus = 'waiting' | 'playing' | 'round_end' | 'match_end';

// 1 = clockwise, -1 = counter-clockwise.
export type Direction = 1 | -1;

export interface GameSettings {
  // null = timer disabled by host.
  turnTimerSeconds: number | null;
  pointsToWin: number;
  maxPlayers: number;
  w4ChallengeEnabled: boolean;
}

// Broadcastable player view — no hand contents.
export interface PlayerPublic {
  id: string;
  name: string;
  avatar: string;
  isConnected: boolean;
  isSpectator: boolean;
  isHost: boolean;
  score: number;
  cardCount: number;
}

// Private extension — only ever sent to that specific player over `your_hand`.
export interface PlayerPrivate extends PlayerPublic {
  hand: Card[];
}

// Broadcastable game state — never contains hands or the full deck.
export interface PublicGameState {
  topCard: Card;
  currentColor: PlayableColor;
  direction: Direction;
  currentTurnIndex: number;
  // Epoch ms — clients reconcile timer against this + serverTimestamp on turn_start.
  turnStartedAt: number;
  turnTimerSeconds: number | null;
  round: number;
  drawPileCount: number;
  discardPileCount: number;
}

export interface RoomPublic {
  code: string;
  hostId: string;
  status: RoomStatus;
  players: PlayerPublic[];
  spectators: PlayerPublic[];
  settings: GameSettings;
  game: PublicGameState | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  turnTimerSeconds: 30,
  pointsToWin: 500,
  maxPlayers: 8,
  w4ChallengeEnabled: true,
};

// Validation constraints (shared so client + server agree).
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS_HARD = 12;
export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const ROOM_CODE_LEN = 6;
