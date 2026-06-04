// Socket event names + payload types. No validation here — payloads are types only;
// runtime validation lives in the server's socket handlers.

import type { Card, PlayableColor } from './cards.js';
import type { GameSettings, PublicGameState, RoomPublic, PlayerPublic } from './state.js';

// ---------- Client → Server ----------

export const ClientEvents = Object.freeze({
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  START_GAME: 'start_game',
  SET_STARTING_COLOR: 'set_starting_color',
  PLAY_CARD: 'play_card',
  DRAW_CARD: 'draw_card',
  PASS_TURN: 'pass_turn',
  CALL_UNO: 'call_uno',
  CATCH_UNO: 'catch_uno',
  LEAVE_ROOM: 'leave_room',
  UPDATE_SETTINGS: 'update_settings',
  PROMOTE_SPECTATOR: 'promote_spectator',
  KICK_SPECTATOR: 'kick_spectator',
  CHALLENGE_W4: 'challenge_w4',
  NEXT_ROUND: 'next_round',
  PLAY_AGAIN: 'play_again',
} as const);

export type ClientEventName = (typeof ClientEvents)[keyof typeof ClientEvents];

export interface CreateRoomPayload {
  name: string;
  avatar: string;
  settings: Partial<GameSettings>;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  avatar: string;
  // Opaque reconnect token; if present and valid, server rebinds to existing seat.
  playerToken?: string;
}

export type StartGamePayload = Record<string, never>;

export interface SetStartingColorPayload {
  color: PlayableColor;
}

export interface PlayCardPayload {
  cardId: string;
  // Required when the played card is Wild or Wild Draw Four.
  chosenColor?: PlayableColor;
}

export type DrawCardPayload = Record<string, never>;

export type PassTurnPayload = Record<string, never>;

export type CallUnoPayload = Record<string, never>;

export interface CatchUnoPayload {
  targetId: string;
}

export type LeaveRoomPayload = Record<string, never>;

export interface UpdateSettingsPayload {
  settings: Partial<GameSettings>;
}

export interface PromoteSpectatorPayload {
  playerId: string;
}

export interface KickSpectatorPayload {
  playerId: string;
}

export interface ChallengeW4Payload {
  // true = challenge the W4, false/timeout = accept.
  challenge: boolean;
}

export type NextRoundPayload = Record<string, never>;

export type PlayAgainPayload = Record<string, never>;

// ---------- Server → Client ----------

export const ServerEvents = Object.freeze({
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  ROOM_UPDATED: 'room_updated',
  GAME_STARTED: 'game_started',
  GAME_STATE: 'game_state',
  YOUR_HAND: 'your_hand',
  TURN_START: 'turn_start',
  CARD_PLAYED: 'card_played',
  CARD_DRAWN: 'card_drawn',
  UNO_CALLED: 'uno_called',
  UNO_CAUGHT: 'uno_caught',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  ROUND_END: 'round_end',
  MATCH_END: 'match_end',
  ERROR: 'error',
  W4_CHALLENGE_PROMPT: 'w4_challenge_prompt',
  W4_CHALLENGE_RESULT: 'w4_challenge_result',
  PLAYER_TOKEN: 'player_token',
  AWAITING_STARTING_COLOR: 'awaiting_starting_color',
  PLAYABLE_DRAWN: 'playable_drawn',
  GAME_PAUSED: 'game_paused',
  GAME_RESUMED: 'game_resumed',
} as const);

export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];

export interface RoomCreatedPayload {
  roomCode: string;
  roomState: RoomPublic;
}

export interface RoomJoinedPayload {
  roomState: RoomPublic;
}

export interface RoomUpdatedPayload {
  players: PlayerPublic[];
  spectators: PlayerPublic[];
}

export interface GameStartedPayload {
  gameState: PublicGameState;
  yourHand: Card[];
}

export interface GameStatePayload {
  publicState: PublicGameState;
}

export interface YourHandPayload {
  hand: Card[];
}

export interface TurnStartPayload {
  playerId: string;
  timerSeconds: number | null;
  serverTimestamp: number;
}

export interface CardPlayedPayload {
  playerId: string;
  card: Card;
  newTopCard: Card;
  newColor: PlayableColor;
  sideEffect?: 'skip' | 'reverse' | 'draw_two' | 'wild_draw_four';
}

export interface CardDrawnPayload {
  playerId: string;
  // How many cards the player drew — never the cards themselves.
  cardCount: number;
}

export interface UnoCalledPayload {
  playerId: string;
}

export interface UnoCaughtPayload {
  caughtId: string;
  penaltyCards: number;
}

export interface PlayerDisconnectedPayload {
  playerId: string;
}

export interface PlayerReconnectedPayload {
  playerId: string;
}

export interface RoundEndPayload {
  winnerId: string;
  scores: Record<string, number>;
  // Final hands revealed for scoring transparency.
  hands: Record<string, Card[]>;
}

export interface MatchEndPayload {
  winnerId: string;
  finalScores: Record<string, number>;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export interface W4ChallengePromptPayload {
  againstPlayerId: string;
  // Epoch ms after which auto-accept fires.
  deadlineMs: number;
}

export interface W4ChallengeResultPayload {
  winnerId: string;
  loserId: string;
  cardsDrawn: number;
}

export interface PlayerTokenPayload {
  playerToken: string;
}

export interface AwaitingStartingColorPayload {
  hostId: string;
}

export interface PlayableDrawnPayload {
  card: Card;
}

export interface GamePausedPayload {
  reason: 'too_few_connected' | 'all_disconnected';
}

export type GameResumedPayload = Record<string, never>;

// ---------- Error codes ----------

export type ErrorCode =
  | 'not_your_turn'
  | 'illegal_play'
  | 'room_full'
  | 'room_not_found'
  | 'name_taken'
  | 'window_closed'
  | 'invalid_state'
  | 'game_not_started'
  | 'not_host'
  | 'invalid_settings'
  | 'invalid_name'
  | 'already_started'
  | 'not_in_room'
  | 'not_current_player';

// ---------- Payload mapping types (for typed socket wrappers) ----------

export interface ClientPayloadMap {
  [ClientEvents.CREATE_ROOM]: CreateRoomPayload;
  [ClientEvents.JOIN_ROOM]: JoinRoomPayload;
  [ClientEvents.START_GAME]: StartGamePayload;
  [ClientEvents.SET_STARTING_COLOR]: SetStartingColorPayload;
  [ClientEvents.PLAY_CARD]: PlayCardPayload;
  [ClientEvents.DRAW_CARD]: DrawCardPayload;
  [ClientEvents.PASS_TURN]: PassTurnPayload;
  [ClientEvents.CALL_UNO]: CallUnoPayload;
  [ClientEvents.CATCH_UNO]: CatchUnoPayload;
  [ClientEvents.LEAVE_ROOM]: LeaveRoomPayload;
  [ClientEvents.UPDATE_SETTINGS]: UpdateSettingsPayload;
  [ClientEvents.PROMOTE_SPECTATOR]: PromoteSpectatorPayload;
  [ClientEvents.KICK_SPECTATOR]: KickSpectatorPayload;
  [ClientEvents.CHALLENGE_W4]: ChallengeW4Payload;
  [ClientEvents.NEXT_ROUND]: NextRoundPayload;
  [ClientEvents.PLAY_AGAIN]: PlayAgainPayload;
}

export interface ServerPayloadMap {
  [ServerEvents.ROOM_CREATED]: RoomCreatedPayload;
  [ServerEvents.ROOM_JOINED]: RoomJoinedPayload;
  [ServerEvents.ROOM_UPDATED]: RoomUpdatedPayload;
  [ServerEvents.GAME_STARTED]: GameStartedPayload;
  [ServerEvents.GAME_STATE]: GameStatePayload;
  [ServerEvents.YOUR_HAND]: YourHandPayload;
  [ServerEvents.TURN_START]: TurnStartPayload;
  [ServerEvents.CARD_PLAYED]: CardPlayedPayload;
  [ServerEvents.CARD_DRAWN]: CardDrawnPayload;
  [ServerEvents.UNO_CALLED]: UnoCalledPayload;
  [ServerEvents.UNO_CAUGHT]: UnoCaughtPayload;
  [ServerEvents.PLAYER_DISCONNECTED]: PlayerDisconnectedPayload;
  [ServerEvents.PLAYER_RECONNECTED]: PlayerReconnectedPayload;
  [ServerEvents.ROUND_END]: RoundEndPayload;
  [ServerEvents.MATCH_END]: MatchEndPayload;
  [ServerEvents.ERROR]: ErrorPayload;
  [ServerEvents.W4_CHALLENGE_PROMPT]: W4ChallengePromptPayload;
  [ServerEvents.W4_CHALLENGE_RESULT]: W4ChallengeResultPayload;
  [ServerEvents.PLAYER_TOKEN]: PlayerTokenPayload;
  [ServerEvents.AWAITING_STARTING_COLOR]: AwaitingStartingColorPayload;
  [ServerEvents.PLAYABLE_DRAWN]: PlayableDrawnPayload;
  [ServerEvents.GAME_PAUSED]: GamePausedPayload;
  [ServerEvents.GAME_RESUMED]: GameResumedPayload;
}

export type ClientPayloadFor<E extends ClientEventName> = ClientPayloadMap[E];
export type ServerPayloadFor<E extends ServerEventName> = ServerPayloadMap[E];
