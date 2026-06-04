// Turn orchestration on top of the pure game engine.
//
// Owns:
//   • Server-authoritative turn timer (Node setTimeout per room).
//   • Per-room async mutex (chained promise) — every state mutation passes
//     through `withRoomLock`. Two concurrent `playCard` calls serialize; the
//     loser sees `not_your_turn`.
//   • Auto-draw on timer expiry + advance to next CONNECTED player.
//   • Disconnect-chain skipping (bounded by playerCount).
//   • Wild Draw Four challenge flow (5s window). Pending state lives HERE
//     in the controller (per task brief — we do NOT mutate EngineGameState
//     with new fields).
//   • UNO catch race window (engine tracks vulnerability; controller closes
//     the window on next-player action).
//   • Scoring → round_end → match_end transitions.
//
// Critical: this module does NOT import socket.io. It dispatches via a
// callback interface (`TurnEvents`) injected at construction. P2c (sockets)
// wires the callbacks to real socket emits.
//
// Identity model: roomManager uses `RoomPlayer.id` as the reconnect TOKEN
// (the opaque value persisted in client localStorage). We follow the same
// convention here — when the brief says "playerToken" we accept the same
// string used as `RoomPlayer.id`, and use it as the engine player id too.

import {
  applyPlay,
  applyDraw,
  advanceTurn,
  isPlayable,
  dealRound,
  setStartingColor,
  scoreRound,
  markUnoVulnerable,
  clearUnoVulnerable,
  isUnoCatchable,
  applyUnoPenalty,
  validateW4Challenge,
  type EngineGameState,
} from './gameEngine.js';
import { setGameState, type RoomPlayer, type RoomRecord } from './roomManager.js';
import type { Card, ErrorCode, PlayableColor } from '@uno/shared';
import { makeSeededRng, type RNG } from './util/shuffle.js';

// ---------------------------------------------------------------------------
// Event sink (pubsub) — P2c implements this.
// ---------------------------------------------------------------------------

export interface TurnEvents {
  turnStart(
    roomCode: string,
    payload: { playerId: string; timerSeconds: number | null; serverTimestamp: number },
  ): void;
  cardPlayed(
    roomCode: string,
    payload: {
      playerId: string;
      card: Card;
      newTopCard: Card;
      newColor: PlayableColor;
      sideEffect?: 'skip' | 'reverse' | 'draw_two' | 'wild_draw_four';
    },
  ): void;
  cardDrawn(roomCode: string, payload: { playerId: string; cardCount: number }): void;
  /** Private hand snapshot — keyed by player TOKEN (= RoomPlayer.id). */
  privateHand(playerToken: string, hand: Card[]): void;
  /**
   * Player went to 1 card without calling UNO. Catch window open until next
   * player action OR `deadlineMs` (engine-tracked fallback).
   */
  unoVulnerable(roomCode: string, payload: { playerId: string; deadlineMs: number }): void;
  unoCalled(roomCode: string, payload: { playerId: string }): void;
  unoCaught(roomCode: string, payload: { caughtId: string; penaltyCards: number }): void;
  /** Drawn card is playable — player must play_card with that id or pass_turn. */
  playableDrawn(playerToken: string, payload: { card: Card }): void;
  /** Starting card was Wild — host must choose color before TURN_START. */
  awaitingStartingColor(roomCode: string, payload: { hostId: string }): void;
  w4ChallengePrompt(
    roomCode: string,
    payload: { againstPlayerId: string; challengerId: string; deadlineMs: number },
  ): void;
  w4ChallengeResult(
    roomCode: string,
    payload: { winnerId: string; loserId: string; cardsDrawn: number },
  ): void;
  roundEnd(
    roomCode: string,
    payload: {
      winnerId: string | null;
      scores: Record<string, number>;
      hands: Record<string, Card[]>;
    },
  ): void;
  matchEnd(
    roomCode: string,
    payload: { winnerId: string; finalScores: Record<string, number> },
  ): void;
  gamePaused(
    roomCode: string,
    payload: { reason: 'too_few_connected' | 'all_disconnected' },
  ): void;
  gameResumed(roomCode: string): void;
  error(
    roomCode: string,
    playerToken: string,
    payload: { code: ErrorCode; message: string },
  ): void;
  /** Generic "broadcast new public state" signal. */
  publicStateChanged(roomCode: string): void;
}

// ---------------------------------------------------------------------------
// Internal pending-action state. Held in the controller, NOT in
// EngineGameState (per brief: keep engine state shape stable).
// ---------------------------------------------------------------------------

interface PendingW4 {
  w4PlayerId: string;
  challengerId: string;
  w4PlayerHandSnapshot: Card[];
  previousColor: PlayableColor;
  /** Effect.advanceBy from the original W4 play (always 2 in v1). */
  baseAdvanceBy: number;
  /** Timeout id for auto-decline at deadline. */
  timeout: NodeJS.Timeout;
  deadlineMs: number;
}

interface PendingPlayableDraw {
  playerId: string;
  cardId: string;
}

interface AwaitingStartingColor {
  hostId: string;
}

// ---------------------------------------------------------------------------
// Turn controller.
// ---------------------------------------------------------------------------

export interface TurnControllerOptions {
  /** W4 challenge prompt window (default 5s). */
  w4ChallengeWindowMs?: number;
  /**
   * UNO catch wall-clock fallback (default 10s). The catch window normally
   * closes when the *next* player takes an action (play/draw) — see the
   * clear-on-next-action logic in playCard/drawCard. This value is only a
   * backstop for when the next player is idle/disconnected, so it must be
   * generous enough for a human to actually click "Catch!" (a 2s cap made the
   * button effectively unusable: render + reaction + round-trip > 2s).
   */
  unoCatchWindowMs?: number;
  /** Used when settings.turnTimerSeconds is null (default 10s). */
  fallbackTimerSeconds?: number;
  /** Forced auto-draw delay when active player disconnects under no-timer settings (default 5s). */
  disconnectGraceMs?: number;
  /** Injectable RNG factory — defaults to seeded Mulberry32 at deal time. */
  rngFactory?: (seed: number) => RNG;
}

export class TurnController {
  private readonly emit: TurnEvents;
  private readonly w4WindowMs: number;
  private readonly unoCatchWindowMs: number;
  private readonly fallbackTimerSeconds: number;
  private readonly disconnectGraceMs: number;
  private readonly rngFactory: (seed: number) => RNG;
  // Per-room "active player disconnected, no turn timer" forced-skip timers.
  private readonly forcedSkipTimers = new Map<string, NodeJS.Timeout>();

  // Per-room mutex chains. Each entry is the tail promise.
  private readonly mutex = new Map<string, Promise<unknown>>();

  // Per-room current-turn timer (auto-draw on expiry).
  private readonly turnTimers = new Map<string, NodeJS.Timeout>();

  // Per-room pending W4 challenge state.
  private readonly pendingW4 = new Map<string, PendingW4>();

  // Per-room awaiting starting color (Wild flipped as opener).
  private readonly awaitingColor = new Map<string, AwaitingStartingColor>();

  // Per-room playable-drawn state — set when player drew a playable card
  // and must choose: play it, or pass_turn.
  private readonly pendingPlayableDraw = new Map<string, PendingPlayableDraw>();

  // Per-room set of players who pre-called UNO before vulnerability opens.
  // When markUnoVulnerable would fire for such a player, we suppress it.
  private readonly preCalledUno = new Map<string, Set<string>>();

  constructor(emit: TurnEvents, opts: TurnControllerOptions = {}) {
    this.emit = emit;
    this.w4WindowMs = opts.w4ChallengeWindowMs ?? 5000;
    this.unoCatchWindowMs = opts.unoCatchWindowMs ?? 10000;
    this.fallbackTimerSeconds = opts.fallbackTimerSeconds ?? 10;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? 5000;
    this.rngFactory = opts.rngFactory ?? makeSeededRng;
  }

  // -------------------------------------------------------------------------
  // Mutex.
  // -------------------------------------------------------------------------

  /**
   * Serialize all mutations on `roomCode`. Errors propagate to callers; the
   * mutex tail catches separately so a thrown op doesn't poison future ops.
   */
  withRoomLock<T>(roomCode: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.mutex.get(roomCode) ?? Promise.resolve();
    const next = prev.then(
      () => fn(),
      () => fn(),
    );
    // Store the *swallowed* tail so subsequent callers wait but don't see the
    // prior error.
    const tail: Promise<unknown> = next.catch(() => undefined);
    this.mutex.set(roomCode, tail);
    tail.then(() => {
      if (this.mutex.get(roomCode) === tail) {
        this.mutex.delete(roomCode);
      }
    });
    return next;
  }

  // -------------------------------------------------------------------------
  // Public API — game lifecycle.
  // -------------------------------------------------------------------------

  /**
   * Deal a fresh round and dispatch the first TURN_START — or
   * `awaitingStartingColor` when the starting card is a non-W4 Wild.
   */
  startGame(
    room: RoomRecord,
    startingColor: PlayableColor | undefined,
    now: number,
  ): void {
    // RNG seeded from `now` + room code so equivalent test seeds reproduce.
    const seed = (now ^ (room.code.charCodeAt(0) || 1)) >>> 0;
    const rng = this.rngFactory(seed || 1);
    const playerIds = room.players.map((p) => p.id);
    let state = dealRound(playerIds, rng, now);

    setGameState(room, state, 'playing');
    room.lastActivityAt = now;

    // Clear any per-room pending state from a prior round.
    this.cancelTimer(room.code);
    this.awaitingColor.delete(room.code);
    this.pendingPlayableDraw.delete(room.code);
    this.preCalledUno.delete(room.code);
    const oldW4 = this.pendingW4.get(room.code);
    if (oldW4) clearTimeout(oldW4.timeout);
    this.pendingW4.delete(room.code);

    const top = state.discardPile[state.discardPile.length - 1] as Card;

    if (top.color === 'wild' && top.type === 'wild') {
      if (startingColor) {
        state = setStartingColor(state, startingColor);
        setGameState(room, state, 'playing');
        this.broadcastHands(room);
        this.emit.publicStateChanged(room.code);
        this.emitTurnStart(room, now);
      } else {
        const host = room.players.find((p) => p.isHost) ?? room.players[0];
        if (host) {
          this.awaitingColor.set(room.code, { hostId: host.id });
          this.emit.awaitingStartingColor(room.code, { hostId: host.id });
        }
        this.broadcastHands(room);
        this.emit.publicStateChanged(room.code);
      }
      return;
    }

    this.broadcastHands(room);
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  /**
   * Host picks the opening color (only valid when `awaitingStartingColor` is
   * set for this room).
   */
  setStartingColor(
    room: RoomRecord,
    requesterToken: string,
    color: PlayableColor,
    now: number,
  ): void {
    const awaiting = this.awaitingColor.get(room.code);
    if (!awaiting) {
      this.emit.error(room.code, requesterToken, {
        code: 'invalid_state',
        message: 'not awaiting starting color',
      });
      return;
    }
    if (requesterToken !== awaiting.hostId) {
      this.emit.error(room.code, requesterToken, {
        code: 'not_host',
        message: 'only host can choose starting color',
      });
      return;
    }
    if (!room.game) return;
    setGameState(room, setStartingColor(room.game, color), 'playing');
    this.awaitingColor.delete(room.code);
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  // -------------------------------------------------------------------------
  // Public API — turn actions.
  // -------------------------------------------------------------------------

  async playCard(
    room: RoomRecord,
    playerToken: string,
    cardId: string,
    chosenColor: PlayableColor | undefined,
    now: number,
  ): Promise<void> {
    return this.withRoomLock(room.code, () => {
      this.playCardLocked(room, playerToken, cardId, chosenColor, now);
    });
  }

  private playCardLocked(
    room: RoomRecord,
    playerToken: string,
    cardId: string,
    chosenColor: PlayableColor | undefined,
    now: number,
  ): void {
    if (room.status !== 'playing' || !room.game) {
      this.emit.error(room.code, playerToken, {
        code: 'game_not_started',
        message: 'game not in playing state',
      });
      return;
    }
    if (this.awaitingColor.has(room.code)) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'awaiting starting color',
      });
      return;
    }
    if (this.pendingW4.has(room.code)) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'awaiting W4 challenge response',
      });
      return;
    }

    const playerRecord = room.players.find((p) => p.id === playerToken);
    if (!playerRecord) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'player not seated',
      });
      return;
    }
    if (!playerRecord.isConnected) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'player disconnected',
      });
      return;
    }

    const state = room.game;
    const playerIdx = state.players.findIndex((p) => p.id === playerRecord.id);
    if (playerIdx === -1) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'player not seated in game',
      });
      return;
    }
    if (state.currentTurnIndex !== playerIdx) {
      this.emit.error(room.code, playerToken, {
        code: 'not_your_turn',
        message: "it's not your turn",
      });
      return;
    }

    // Drew-a-playable hold: only the held card may be played.
    const pendingDraw = this.pendingPlayableDraw.get(room.code);
    if (
      pendingDraw &&
      pendingDraw.playerId === playerRecord.id &&
      pendingDraw.cardId !== cardId
    ) {
      this.emit.error(room.code, playerToken, {
        code: 'illegal_play',
        message: 'must play the just-drawn card or pass',
      });
      return;
    }

    let result;
    try {
      result = applyPlay(state, playerIdx, cardId, chosenColor, state.players.length, now);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'illegal_play';
      const code: ErrorCode =
        msg === 'card_not_in_hand' || msg === 'illegal_play' || msg === 'color_required'
          ? 'illegal_play'
          : 'invalid_state';
      this.emit.error(room.code, playerToken, { code, message: msg });
      return;
    }

    this.pendingPlayableDraw.delete(room.code);

    let newState = result.state;
    const effect = result.effect;
    const playedCard = newState.discardPile[newState.discardPile.length - 1] as Card;

    // Cancel the active turn timer — we're transitioning.
    this.cancelTimer(room.code);

    // Closing UNO catch window for a *different* previously-vulnerable player
    // (this player's own action counts as the next-player action relative to
    // whoever was at 1 card).
    if (newState.unoVulnerable && newState.unoVulnerable.playerId !== playerRecord.id) {
      newState = clearUnoVulnerable(newState);
    }

    const sideEffect: 'skip' | 'reverse' | 'draw_two' | 'wild_draw_four' | undefined =
      effect.type === 'normal' || effect.type === 'wild' ? undefined : effect.type;
    this.emit.cardPlayed(room.code, {
      playerId: playerRecord.id,
      card: playedCard,
      newTopCard: playedCard,
      newColor: newState.currentColor,
      ...(sideEffect ? { sideEffect } : {}),
    });

    setGameState(room, newState, 'playing');
    room.lastActivityAt = now;

    this.emit.privateHand(playerRecord.id, this.handFor(newState, playerRecord.id));

    // Round end (hand empty)?
    if (this.handLen(newState, playerRecord.id) === 0) {
      this.endRound(room, playerIdx, now);
      return;
    }

    // UNO vulnerability: hand at 1 without pre-call. preCalledUno inoculates.
    if (this.handLen(newState, playerRecord.id) === 1) {
      const pre = this.preCalledUno.get(room.code);
      if (pre?.has(playerRecord.id)) {
        pre.delete(playerRecord.id);
        this.emit.unoCalled(room.code, { playerId: playerRecord.id });
      } else {
        const deadlineMs = now + this.unoCatchWindowMs;
        newState = markUnoVulnerable(newState, playerRecord.id, now);
        setGameState(room, newState, 'playing');
        this.emit.unoVulnerable(room.code, {
          playerId: playerRecord.id,
          deadlineMs,
        });
      }
    }

    // Wild Draw Four → open challenge window; do NOT advance yet.
    if (effect.type === 'wild_draw_four' && effect.w4Context) {
      const nextIdx = this.computeNextSeat(newState, 1);
      const challenger = newState.players[nextIdx];
      if (!challenger) return;
      // Host disabled challenges → auto-resolve as decline (challenger draws 4).
      if (!room.settings.w4ChallengeEnabled) {
        this.resolveW4(room, {
          w4PlayerId: effect.w4Context.w4PlayerId,
          challengerId: challenger.id,
          w4PlayerHandSnapshot: effect.w4Context.w4PlayerHandSnapshot,
          previousColor: effect.w4Context.previousColor,
          baseAdvanceBy: effect.advanceBy,
          accept: false,
          now,
        });
        return;
      }
      const deadlineMs = now + this.w4WindowMs;
      const timeout = setTimeout(() => {
        void this.withRoomLock(room.code, () => {
          this.handleW4Timeout(room, Date.now());
        });
      }, this.w4WindowMs);
      this.pendingW4.set(room.code, {
        w4PlayerId: effect.w4Context.w4PlayerId,
        challengerId: challenger.id,
        w4PlayerHandSnapshot: effect.w4Context.w4PlayerHandSnapshot,
        previousColor: effect.w4Context.previousColor,
        baseAdvanceBy: effect.advanceBy,
        timeout,
        deadlineMs,
      });
      this.emit.w4ChallengePrompt(room.code, {
        againstPlayerId: effect.w4Context.w4PlayerId,
        challengerId: challenger.id,
        deadlineMs,
      });
      this.emit.publicStateChanged(room.code);
      return;
    }

    // Non-W4 forced draw (Draw Two), then advance turn.
    if (effect.nextPlayerDraws > 0) {
      const nextIdx = this.computeNextSeat(newState, 1);
      const drawResult = applyDraw(newState, nextIdx, effect.nextPlayerDraws, now);
      if (drawResult.drawnCards.length < effect.nextPlayerDraws) {
        this.handleDeadlock(room, now);
        return;
      }
      newState = drawResult.state;
      const target = newState.players[nextIdx];
      if (target) {
        this.emit.cardDrawn(room.code, {
          playerId: target.id,
          cardCount: drawResult.drawnCards.length,
        });
        this.emit.privateHand(target.id, this.handFor(newState, target.id));
      }
    }

    newState = advanceTurn(newState, newState.players.length, effect.advanceBy);
    setGameState(room, newState, 'playing');
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  async drawCard(room: RoomRecord, playerToken: string, now: number): Promise<void> {
    return this.withRoomLock(room.code, () => {
      this.drawCardLocked(room, playerToken, now);
    });
  }

  private drawCardLocked(room: RoomRecord, playerToken: string, now: number): void {
    if (room.status !== 'playing' || !room.game) {
      this.emit.error(room.code, playerToken, {
        code: 'game_not_started',
        message: 'game not in playing state',
      });
      return;
    }
    if (this.awaitingColor.has(room.code) || this.pendingW4.has(room.code)) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'awaiting prior action',
      });
      return;
    }
    if (this.pendingPlayableDraw.has(room.code)) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'already drew this turn',
      });
      return;
    }

    const playerRecord = room.players.find((p) => p.id === playerToken);
    if (!playerRecord || !playerRecord.isConnected) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'player not connected',
      });
      return;
    }
    const state = room.game;
    const playerIdx = state.players.findIndex((p) => p.id === playerRecord.id);
    if (playerIdx === -1 || state.currentTurnIndex !== playerIdx) {
      this.emit.error(room.code, playerToken, {
        code: 'not_your_turn',
        message: "it's not your turn",
      });
      return;
    }

    const drawResult = applyDraw(state, playerIdx, 1, now);
    if (drawResult.drawnCards.length < 1) {
      this.handleDeadlock(room, now);
      return;
    }
    let newState = drawResult.state;
    setGameState(room, newState, 'playing');
    room.lastActivityAt = now;

    // Close any other player's UNO catch window — drawing is a "next-player
    // action" from their POV.
    if (newState.unoVulnerable && newState.unoVulnerable.playerId !== playerRecord.id) {
      newState = clearUnoVulnerable(newState);
      setGameState(room, newState, 'playing');
    }

    const drawn = drawResult.drawnCards[0] as Card;
    this.emit.cardDrawn(room.code, { playerId: playerRecord.id, cardCount: 1 });
    this.emit.privateHand(playerRecord.id, this.handFor(newState, playerRecord.id));

    const topCard = newState.discardPile[newState.discardPile.length - 1] as Card;
    const drawnPlayable = isPlayable(drawn, topCard, newState.currentColor);

    this.cancelTimer(room.code);

    if (drawnPlayable) {
      this.pendingPlayableDraw.set(room.code, {
        playerId: playerRecord.id,
        cardId: drawn.id,
      });
      this.emit.playableDrawn(playerRecord.id, { card: drawn });
      this.emit.publicStateChanged(room.code);
      this.armTurnTimer(room, now);
      return;
    }

    // Not playable → auto-pass.
    newState = advanceTurn(newState, newState.players.length, 1);
    setGameState(room, newState, 'playing');
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  async passTurn(room: RoomRecord, playerToken: string, now: number): Promise<void> {
    return this.withRoomLock(room.code, () => {
      this.passTurnLocked(room, playerToken, now);
    });
  }

  private passTurnLocked(room: RoomRecord, playerToken: string, now: number): void {
    if (room.status !== 'playing' || !room.game) return;
    const pending = this.pendingPlayableDraw.get(room.code);
    const playerRecord = room.players.find((p) => p.id === playerToken);
    if (!playerRecord) return;
    if (!pending || pending.playerId !== playerRecord.id) {
      this.emit.error(room.code, playerToken, {
        code: 'invalid_state',
        message: 'no playable drawn card to pass',
      });
      return;
    }
    this.pendingPlayableDraw.delete(room.code);
    this.cancelTimer(room.code);
    const advanced = advanceTurn(room.game, room.game.players.length, 1);
    setGameState(room, advanced, 'playing');
    room.lastActivityAt = now;
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  async callUno(room: RoomRecord, playerToken: string, now: number): Promise<void> {
    return this.withRoomLock(room.code, () => {
      const playerRecord = room.players.find((p) => p.id === playerToken);
      if (!playerRecord) return;
      const state = room.game;
      if (!state) return;
      // Already vulnerable → inoculate.
      if (state.unoVulnerable && state.unoVulnerable.playerId === playerRecord.id) {
        setGameState(room, clearUnoVulnerable(state), 'playing');
        this.emit.unoCalled(room.code, { playerId: playerRecord.id });
        this.emit.publicStateChanged(room.code);
        return;
      }
      // Pre-call: record intent. markUnoVulnerable would-be will be suppressed.
      let set = this.preCalledUno.get(room.code);
      if (!set) {
        set = new Set();
        this.preCalledUno.set(room.code, set);
      }
      set.add(playerRecord.id);
      this.emit.unoCalled(room.code, { playerId: playerRecord.id });
      void now;
    });
  }

  async catchUno(
    room: RoomRecord,
    callerToken: string,
    targetId: string,
    now: number,
  ): Promise<void> {
    return this.withRoomLock(room.code, () => {
      if (!room.game) return;
      const state = room.game;
      if (!isUnoCatchable(state, targetId, now, this.unoCatchWindowMs)) {
        this.emit.error(room.code, callerToken, {
          code: 'window_closed',
          message: 'UNO catch window closed',
        });
        return;
      }
      const targetIdx = state.players.findIndex((p) => p.id === targetId);
      if (targetIdx === -1) {
        this.emit.error(room.code, callerToken, {
          code: 'invalid_state',
          message: 'target not in game',
        });
        return;
      }
      const penalty = applyUnoPenalty(state, targetIdx, now);
      setGameState(room, penalty.state, room.status);
      this.emit.unoCaught(room.code, {
        caughtId: targetId,
        penaltyCards: penalty.drawnCards.length,
      });
      this.emit.privateHand(targetId, this.handFor(penalty.state, targetId));
      this.emit.publicStateChanged(room.code);
      if (penalty.drawnCards.length < 2) {
        this.handleDeadlock(room, now);
      }
    });
  }

  async respondToW4Challenge(
    room: RoomRecord,
    challengerToken: string,
    accept: boolean,
    now: number,
  ): Promise<void> {
    return this.withRoomLock(room.code, () => {
      const pending = this.pendingW4.get(room.code);
      if (!pending) {
        this.emit.error(room.code, challengerToken, {
          code: 'invalid_state',
          message: 'no W4 challenge pending',
        });
        return;
      }
      if (challengerToken !== pending.challengerId) {
        this.emit.error(room.code, challengerToken, {
          code: 'invalid_state',
          message: 'you are not the challenger',
        });
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingW4.delete(room.code);
      this.resolveW4(room, {
        w4PlayerId: pending.w4PlayerId,
        challengerId: pending.challengerId,
        w4PlayerHandSnapshot: pending.w4PlayerHandSnapshot,
        previousColor: pending.previousColor,
        baseAdvanceBy: pending.baseAdvanceBy,
        accept,
        now,
      });
    });
  }

  private handleW4Timeout(room: RoomRecord, now: number): void {
    const pending = this.pendingW4.get(room.code);
    if (!pending) return;
    this.pendingW4.delete(room.code);
    this.resolveW4(room, {
      w4PlayerId: pending.w4PlayerId,
      challengerId: pending.challengerId,
      w4PlayerHandSnapshot: pending.w4PlayerHandSnapshot,
      previousColor: pending.previousColor,
      baseAdvanceBy: pending.baseAdvanceBy,
      // Timeout = treat as no challenge (challenger draws 4 + skip).
      accept: false,
      now,
    });
  }

  private resolveW4(
    room: RoomRecord,
    args: {
      w4PlayerId: string;
      challengerId: string;
      w4PlayerHandSnapshot: Card[];
      previousColor: PlayableColor;
      baseAdvanceBy: number;
      accept: boolean;
      now: number;
    },
  ): void {
    if (!room.game) return;
    let state = room.game;
    const w4Idx = state.players.findIndex((p) => p.id === args.w4PlayerId);
    const challIdx = state.players.findIndex((p) => p.id === args.challengerId);
    if (w4Idx === -1 || challIdx === -1) return;

    let drawIdx: number;
    let cardsToDraw: number;
    let winnerId: string;
    let loserId: string;
    let challengeSucceeded = false;

    if (args.accept) {
      const { legal } = validateW4Challenge(args.w4PlayerHandSnapshot, args.previousColor);
      if (legal) {
        // Challenger loses → 4 + 2 = 6.
        drawIdx = challIdx;
        cardsToDraw = 6;
        winnerId = args.w4PlayerId;
        loserId = args.challengerId;
      } else {
        // W4 player loses → 4. Challenger plays next (no skip).
        drawIdx = w4Idx;
        cardsToDraw = 4;
        winnerId = args.challengerId;
        loserId = args.w4PlayerId;
        challengeSucceeded = true;
      }
    } else {
      // Decline / auto-decline: challenger draws 4 + skip.
      drawIdx = challIdx;
      cardsToDraw = 4;
      winnerId = args.w4PlayerId;
      loserId = args.challengerId;
    }

    const drawResult = applyDraw(state, drawIdx, cardsToDraw, args.now);
    if (drawResult.drawnCards.length < cardsToDraw) {
      setGameState(room, drawResult.state, room.status);
      this.emit.w4ChallengeResult(room.code, {
        winnerId,
        loserId,
        cardsDrawn: drawResult.drawnCards.length,
      });
      this.handleDeadlock(room, args.now);
      return;
    }
    state = drawResult.state;

    const drawer = state.players[drawIdx];
    if (drawer) {
      this.emit.cardDrawn(room.code, {
        playerId: drawer.id,
        cardCount: drawResult.drawnCards.length,
      });
      this.emit.privateHand(drawer.id, this.handFor(state, drawer.id));
    }

    this.emit.w4ChallengeResult(room.code, {
      winnerId,
      loserId,
      cardsDrawn: cardsToDraw,
    });

    // Challenger-succeeds → challenger is the next player (advance 1).
    // Else → challenger skipped (advance by base = 2).
    const advBy = challengeSucceeded ? 1 : args.baseAdvanceBy;
    state = advanceTurn(state, state.players.length, advBy);
    setGameState(room, state, 'playing');
    room.lastActivityAt = args.now;
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, args.now);
  }

  // -------------------------------------------------------------------------
  // Round end / match end / next round.
  // -------------------------------------------------------------------------

  endRound(room: RoomRecord, winnerIdx: number, now: number): void {
    if (!room.game) return;
    const state = room.game;

    this.cancelTimer(room.code);
    const pw4 = this.pendingW4.get(room.code);
    if (pw4) clearTimeout(pw4.timeout);
    this.pendingW4.delete(room.code);
    this.pendingPlayableDraw.delete(room.code);
    this.preCalledUno.delete(room.code);
    this.awaitingColor.delete(room.code);

    let winnerId: string | null = null;
    if (winnerIdx >= 0) {
      const result = scoreRound(state.players, winnerIdx);
      winnerId = result.winnerId;
      const winnerRecord = room.players.find((p) => p.id === result.winnerId);
      if (winnerRecord) winnerRecord.score += result.points;
    }

    const hands: Record<string, Card[]> = {};
    for (const p of state.players) hands[p.id] = p.hand.slice();

    const cumulativeScores: Record<string, number> = {};
    for (const p of room.players) cumulativeScores[p.id] = p.score;

    setGameState(room, state, 'round_end');
    room.lastActivityAt = now;
    this.emit.roundEnd(room.code, {
      winnerId,
      scores: cumulativeScores,
      hands,
    });

    const reached = room.players.find((p) => p.score >= room.settings.pointsToWin);
    if (reached) {
      room.status = 'match_end';
      const finalScores: Record<string, number> = {};
      for (const p of room.players) finalScores[p.id] = p.score;
      this.emit.matchEnd(room.code, { winnerId: reached.id, finalScores });
    }
    this.emit.publicStateChanged(room.code);
  }

  startNextRound(room: RoomRecord, requesterToken: string, now: number): void {
    if (room.status !== 'round_end') {
      this.emit.error(room.code, requesterToken, {
        code: 'invalid_state',
        message: 'not in round_end',
      });
      return;
    }
    const requester = room.players.find((p) => p.id === requesterToken);
    if (!requester || !requester.isHost) {
      this.emit.error(room.code, requesterToken, {
        code: 'not_host',
        message: 'only host can start next round',
      });
      return;
    }
    const previousRound = room.game?.round ?? 0;
    this.startGame(room, undefined, now);
    if (room.game) {
      room.game = { ...room.game, round: previousRound + 1 };
    }
    this.emit.publicStateChanged(room.code);
  }

  cleanup(roomCode: string): void {
    this.cancelTimer(roomCode);
    const pw4 = this.pendingW4.get(roomCode);
    if (pw4) clearTimeout(pw4.timeout);
    this.pendingW4.delete(roomCode);
    this.pendingPlayableDraw.delete(roomCode);
    this.preCalledUno.delete(roomCode);
    this.awaitingColor.delete(roomCode);
    this.mutex.delete(roomCode);
    const forced = this.forcedSkipTimers.get(roomCode);
    if (forced) {
      clearTimeout(forced);
      this.forcedSkipTimers.delete(roomCode);
    }
  }

  /**
   * Called by sockets layer when a player disconnects. If the disconnected
   * player has the active turn AND no turn timer is configured (settings
   * turnTimerSeconds === null), schedule a 5-second forced auto-draw + advance
   * so the room doesn't deadlock. When the timer IS configured, the existing
   * turn timer already handles auto-draw on expiry.
   *
   * Idempotent across repeat disconnects on the same turn.
   */
  handleDisconnect(room: RoomRecord, playerToken: string, now: number): void {
    void playerToken;
    void now;
    if (room.status !== 'playing' || !room.game) return;
    if (room.settings.turnTimerSeconds !== null) return; // existing timer covers it
    const idx = room.game.currentTurnIndex;
    const enginePlayer = room.game.players[idx];
    if (!enginePlayer) return;
    const record = room.players.find((p) => p.id === enginePlayer.id);
    if (!record || record.isConnected) return; // not the disconnected player
    if (this.forcedSkipTimers.has(room.code)) return;
    if (this.pendingW4.has(room.code)) return; // W4 has its own timeout
    const handle = setTimeout(() => {
      this.forcedSkipTimers.delete(room.code);
      void this.withRoomLock(room.code, () => {
        this.onTimerExpiry(room, Date.now());
      });
    }, this.disconnectGraceMs);
    this.forcedSkipTimers.set(room.code, handle);
  }

  // -------------------------------------------------------------------------
  // Timer + turn-start sequencing.
  // -------------------------------------------------------------------------

  private armTurnTimer(room: RoomRecord, now: number): void {
    this.cancelTimer(room.code);
    const seconds = room.settings.turnTimerSeconds ?? this.fallbackTimerSeconds;
    if (seconds === null) return;
    const handle = setTimeout(() => {
      void this.withRoomLock(room.code, () => {
        this.onTimerExpiry(room, Date.now());
      });
    }, seconds * 1000);
    this.turnTimers.set(room.code, handle);
    void now;
  }

  private cancelTimer(roomCode: string): void {
    const h = this.turnTimers.get(roomCode);
    if (h) {
      clearTimeout(h);
      this.turnTimers.delete(roomCode);
    }
  }

  /**
   * Timer expired on the active player's turn: auto-draw 1 + advance.
   * The disconnect-skipping path is handled by `emitTurnStart` which is
   * called from here.
   */
  private onTimerExpiry(room: RoomRecord, now: number): void {
    if (!room.game || room.status !== 'playing') return;
    if (this.pendingW4.has(room.code)) return; // W4 has its own timeout
    this.pendingPlayableDraw.delete(room.code);

    const state = room.game;
    const playerIdx = state.currentTurnIndex;
    const player = state.players[playerIdx];
    if (!player) return;

    const drawRes = applyDraw(state, playerIdx, 1, now);
    if (drawRes.drawnCards.length < 1) {
      this.handleDeadlock(room, now);
      return;
    }
    let newState = drawRes.state;
    setGameState(room, newState, 'playing');
    this.emit.cardDrawn(room.code, { playerId: player.id, cardCount: 1 });
    this.emit.privateHand(player.id, this.handFor(newState, player.id));

    newState = advanceTurn(newState, newState.players.length, 1);
    setGameState(room, newState, 'playing');
    this.emit.publicStateChanged(room.code);
    this.emitTurnStart(room, now);
  }

  private computeNextSeat(state: EngineGameState, advanceBy: number): number {
    const n = state.players.length;
    const delta = advanceBy * state.direction;
    return ((state.currentTurnIndex + delta) % n + n) % n;
  }

  /**
   * Emit `turnStart`. If the active player is disconnected, auto-draw on
   * their behalf and re-advance — up to N attempts. Pause the game if too
   * few players are connected to continue.
   */
  private emitTurnStart(room: RoomRecord, now: number): void {
    if (!room.game) return;
    const n = room.game.players.length;
    for (let attempt = 0; attempt < n; attempt++) {
      const connectedSeatedCount = room.players.filter(
        (p) => p.isConnected && !p.isSpectator,
      ).length;
      if (connectedSeatedCount === 0) {
        this.emit.gamePaused(room.code, { reason: 'all_disconnected' });
        return;
      }
      if (connectedSeatedCount < 2) {
        this.emit.gamePaused(room.code, { reason: 'too_few_connected' });
        return;
      }
      const idx = room.game.currentTurnIndex;
      const enginePlayer = room.game.players[idx];
      if (!enginePlayer) return;
      const record = room.players.find((p) => p.id === enginePlayer.id);
      if (record && record.isConnected) {
        const stamped: EngineGameState = { ...room.game, turnStartedAt: now };
        setGameState(room, stamped, 'playing');
        this.armTurnTimer(room, now);
        this.emit.turnStart(room.code, {
          playerId: record.id,
          timerSeconds: room.settings.turnTimerSeconds,
          serverTimestamp: now,
        });
        return;
      }
      // Disconnected: auto-draw 1 + advance.
      const drawRes = applyDraw(room.game, idx, 1, now);
      if (drawRes.drawnCards.length < 1) {
        this.handleDeadlock(room, now);
        return;
      }
      const advanced = advanceTurn(drawRes.state, n, 1);
      setGameState(room, advanced, 'playing');
      this.emit.cardDrawn(room.code, { playerId: enginePlayer.id, cardCount: 1 });
    }
    this.emit.gamePaused(room.code, { reason: 'all_disconnected' });
  }

  private handleDeadlock(room: RoomRecord, now: number): void {
    this.endRound(room, -1, now);
  }

  // -------------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------------

  private handFor(state: EngineGameState, playerId: string): Card[] {
    const p = state.players.find((x) => x.id === playerId);
    return p ? p.hand.slice() : [];
  }

  private handLen(state: EngineGameState, playerId: string): number {
    const p = state.players.find((x) => x.id === playerId);
    return p ? p.hand.length : 0;
  }

  private broadcastHands(room: RoomRecord): void {
    if (!room.game) return;
    for (const ep of room.game.players) {
      this.emit.privateHand(ep.id, ep.hand.slice());
    }
  }
}

// Re-export room types for downstream callers (P2c).
export type { RoomPlayer, RoomRecord };
