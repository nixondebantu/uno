// UNO Classic — pure-functional game engine.
//
// Rules: PRD §4, audited against https://www.unorules.com/ (see plan/BUILD_PLAN.md
// §"Rules audit"). All functions are pure: they take state + inputs and return
// new state. No mutation of inputs, no Date.now(), no I/O. Callers pass `now`
// (epoch ms) and a deterministic RNG when randomness is needed.

import {
  CARD_VALUES,
  PLAYABLE_COLORS,
  type Card,
  type CardType,
  type Color,
  type PlayableColor,
} from '@uno/shared';
import type { Direction } from '@uno/shared';
import { shuffle, type RNG } from './util/shuffle.js';

// ---------------------------------------------------------------------------
// Engine state shape (private; superset of PublicGameState).
// ---------------------------------------------------------------------------

export interface EnginePlayer {
  id: string;
  hand: Card[];
  score: number;
}

export interface EngineGameState {
  deck: Card[]; // face-down draw pile; index 0 = top
  discardPile: Card[]; // face-up; last index = top
  currentColor: PlayableColor; // colour the next play must match (Wild family resets this)
  direction: Direction;
  currentTurnIndex: number;
  turnStartedAt: number;
  round: number;
  /**
   * Accumulated forced-draw count surfaced via play effects. v1 Classic does
   * NOT stack Draw2/W4 — this field is reserved for transient bookkeeping and
   * is reset between plays. It is always 0 at rest.
   */
  pendingDraw: number;
  players: EnginePlayer[];
  /**
   * Set when the *previous* play left a player at exactly 1 card without them
   * calling UNO. Cleared once the catch window closes (handled by caller via
   * `clearUnoVulnerable`) or once a successful catch lands.
   */
  unoVulnerable: { playerId: string; openedAt: number } | null;
}

// ---------------------------------------------------------------------------
// Deck construction.
// ---------------------------------------------------------------------------

/**
 * Build the canonical 108-card UNO deck with deterministic IDs.
 *
 * Composition (PRD §4.1):
 *   • 4 colors × { one 0, two each of 1–9 }                = 76 number cards
 *   • 4 colors × { two Skip, two Reverse, two Draw Two }   = 24 action cards
 *   • 4 Wild                                                =  4
 *   • 4 Wild Draw Four                                      =  4
 *                                                         ─────
 *                                                          108
 *
 * IDs follow `<colorPrefix>-<type>[-<dupSuffix>]`. Each ID is unique and
 * deterministic so tests/snapshots are stable.
 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  const colorPrefix: Record<PlayableColor, string> = {
    red: 'r',
    blue: 'b',
    green: 'g',
    yellow: 'y',
  };
  const dupSuffix = ['a', 'b', 'c', 'd'] as const;

  for (const color of PLAYABLE_COLORS) {
    const p = colorPrefix[color];
    // One 0 per color.
    deck.push({
      id: `${p}-0`,
      color,
      type: '0',
      value: CARD_VALUES['0'],
    });
    // Two each of 1–9.
    for (let n = 1; n <= 9; n++) {
      const t = String(n) as CardType;
      deck.push({ id: `${p}-${n}-a`, color, type: t, value: CARD_VALUES[t] });
      deck.push({ id: `${p}-${n}-b`, color, type: t, value: CARD_VALUES[t] });
    }
    // Two each of skip / reverse / draw_two.
    const actionTypes: CardType[] = ['skip', 'reverse', 'draw_two'];
    for (const t of actionTypes) {
      deck.push({ id: `${p}-${t}-a`, color, type: t, value: CARD_VALUES[t] });
      deck.push({ id: `${p}-${t}-b`, color, type: t, value: CARD_VALUES[t] });
    }
  }
  // 4 Wild + 4 Wild Draw Four (color = 'wild').
  for (let i = 0; i < 4; i++) {
    const s = dupSuffix[i] as string;
    deck.push({
      id: `wild-${s}`,
      color: 'wild',
      type: 'wild',
      value: CARD_VALUES.wild,
    });
    deck.push({
      id: `wild_draw_four-${s}`,
      color: 'wild',
      type: 'wild_draw_four',
      value: CARD_VALUES.wild_draw_four,
    });
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Dealing.
// ---------------------------------------------------------------------------

/**
 * Shuffle deck, deal 7 to each player, flip top card. If the starting card is
 * a Wild Draw Four it is buried back into the deck and another card is flipped
 * (repeated until the top is not W4 — per PRD §4.2 / unorules.com).
 *
 * Starting-card effects (PRD §4.2, plan §"Rules audit"):
 *   • Skip:     first player loses their turn → `currentTurnIndex` = 1
 *   • Reverse:  direction flips; with exactly 2 players Reverse acts as Skip
 *   • Draw 2:   first player draws 2 + skipped
 *   • Wild:     `currentColor` left as `'red'` placeholder; caller MUST invoke
 *               `setStartingColor` once the host picks. (We default to red
 *               rather than returning a union with `'wild'` so the public
 *               state type stays simple — the caller is responsible for
 *               surfacing a "choose color" prompt before TURN_START.)
 *   • W4:       impossible — re-flipped per above.
 */
export function dealRound(
  playerIds: readonly string[],
  rng: RNG,
  now: number,
): EngineGameState {
  let deck = shuffle(buildDeck(), rng);
  const players: EnginePlayer[] = playerIds.map((id) => ({
    id,
    hand: [],
    score: 0,
  }));

  // Deal 7 cards per player, one card at a time round-robin (mirrors a
  // real-life dealer). Top of deck is index 0.
  for (let round = 0; round < 7; round++) {
    for (const p of players) {
      const card = deck[0] as Card;
      p.hand = [...p.hand, card];
      deck = deck.slice(1);
    }
  }

  // Flip starting card; bury any W4 back into the deck and re-shuffle.
  // Loop is bounded by deck size; W4 count is 4 so this terminates fast.
  let top = deck[0] as Card;
  deck = deck.slice(1);
  while (top.type === 'wild_draw_four') {
    // Bury W4 somewhere in the middle, then reshuffle to keep distribution clean.
    deck = shuffle([...deck, top], rng);
    top = deck[0] as Card;
    deck = deck.slice(1);
  }

  const discardPile: Card[] = [top];
  const playerCount = players.length;

  // Default state before applying starting-card effects.
  let direction: Direction = 1;
  let currentTurnIndex = 0;
  // For non-wild top cards the starting color matches the top card's color.
  // For Wild we use 'red' as a placeholder; caller MUST call setStartingColor.
  let currentColor: PlayableColor =
    top.color === 'wild' ? 'red' : (top.color as PlayableColor);

  // Apply starting-card effects.
  switch (top.type) {
    case 'skip': {
      currentTurnIndex = (1 + playerCount) % playerCount;
      break;
    }
    case 'reverse': {
      if (playerCount === 2) {
        // With 2 players, Reverse acts as Skip.
        currentTurnIndex = (1 + playerCount) % playerCount;
      } else {
        direction = -1;
        // Direction flips before the first turn — that means the "first" seat
        // in CCW order is the player at index playerCount-1.
        currentTurnIndex = (0 - 1 + playerCount) % playerCount;
      }
      break;
    }
    case 'draw_two': {
      // First player draws 2 + loses turn.
      const first = players[0] as EnginePlayer;
      const drawn = deck.slice(0, 2);
      deck = deck.slice(2);
      first.hand = [...first.hand, ...drawn];
      currentTurnIndex = (1 + playerCount) % playerCount;
      break;
    }
    default:
      // Number cards, Wild → no positional effect; turn stays on player 0.
      break;
  }

  return {
    deck,
    discardPile,
    currentColor,
    direction,
    currentTurnIndex,
    turnStartedAt: now,
    round: 1,
    pendingDraw: 0,
    players,
    unoVulnerable: null,
  };
}

/**
 * After a Wild has been flipped as the starting card, the host (first player)
 * picks the opening color. This setter is the only sanctioned way to mutate
 * `currentColor` outside of `applyPlay`.
 */
export function setStartingColor(
  state: EngineGameState,
  color: PlayableColor,
): EngineGameState {
  return { ...state, currentColor: color };
}

// ---------------------------------------------------------------------------
// Legal-play check.
// ---------------------------------------------------------------------------

/**
 * A card is playable if:
 *   • it is a Wild family card (Wild / Wild Draw Four — always legal to put down;
 *     W4 legality is judged afterward via the challenge mechanic, NOT here), OR
 *   • its color matches `currentColor` (which may have been set by a prior Wild), OR
 *   • its type matches the top card's type (number or symbol match).
 *
 * Note we compare on `topCard.type`, not just numbers — symbol cards
 * (skip/reverse/draw_two) also match across colors on type. PRD §4.3.
 */
export function isPlayable(
  card: Card,
  topCard: Card,
  currentColor: PlayableColor,
): boolean {
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.type === topCard.type) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Play / draw effects.
// ---------------------------------------------------------------------------

export type PlayEffectType =
  | 'normal'
  | 'skip'
  | 'reverse'
  | 'draw_two'
  | 'wild'
  | 'wild_draw_four';

export interface W4Context {
  w4PlayerId: string;
  previousColor: PlayableColor;
  /**
   * Hand of the W4 player BEFORE the W4 was played (the played card is NOT
   * included). Used by `validateW4Challenge` to determine challenge outcome.
   */
  w4PlayerHandSnapshot: Card[];
}

export interface PlayEffect {
  type: PlayEffectType;
  /** How many seats the turn should advance by (1 = normal, 2 = skip/draw2). */
  advanceBy: number;
  /** Card count the next player must draw (0/2/4 in v1). */
  nextPlayerDraws: number;
  /**
   * Present only for W4 plays — caller (turnController) needs this to resolve
   * a challenge before advancing the turn.
   */
  w4Context?: W4Context;
}

export interface ApplyPlayResult {
  state: EngineGameState;
  effect: PlayEffect;
}

/**
 * Validate + apply a card play. Pure: never mutates inputs.
 *
 * Throws (with stable message strings the caller can map to error codes) on:
 *   • card not in hand
 *   • card not playable against current top+color
 *   • wild family without `chosenColor`
 *
 * Does NOT advance the turn for W4 — caller must handle challenge resolution
 * (engine returns `w4Context` so the turn controller can call
 * `validateW4Challenge` once the challenger has been polled or timed out).
 *
 * For all other cards, `effect.advanceBy` tells the caller how far to advance.
 */
export function applyPlay(
  state: EngineGameState,
  playerIdx: number,
  cardId: string,
  chosenColor: PlayableColor | undefined,
  playerCount: number,
  now: number,
): ApplyPlayResult {
  const player = state.players[playerIdx];
  if (!player) throw new Error('invalid_player');
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) throw new Error('card_not_in_hand');
  const card = player.hand[cardIdx] as Card;
  const topCard = state.discardPile[state.discardPile.length - 1] as Card;
  if (!isPlayable(card, topCard, state.currentColor)) {
    throw new Error('illegal_play');
  }
  if (card.color === 'wild' && !chosenColor) {
    throw new Error('color_required');
  }

  // Build new player list with card removed.
  const newHand = [...player.hand.slice(0, cardIdx), ...player.hand.slice(cardIdx + 1)];
  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand } : p,
  );

  // Determine new currentColor.
  let newCurrentColor: PlayableColor = state.currentColor;
  if (card.color === 'wild') {
    newCurrentColor = chosenColor as PlayableColor;
  } else {
    newCurrentColor = card.color as PlayableColor;
  }

  // Direction flip for reverse (with 2 players acts as Skip; direction stays).
  let newDirection: Direction = state.direction;
  if (card.type === 'reverse' && playerCount > 2) {
    newDirection = (state.direction * -1) as Direction;
  }

  const newState: EngineGameState = {
    ...state,
    players: newPlayers,
    discardPile: [...state.discardPile, card],
    currentColor: newCurrentColor,
    direction: newDirection,
    turnStartedAt: now,
  };

  // Effect computation.
  let effect: PlayEffect;
  switch (card.type) {
    case 'skip':
      effect = { type: 'skip', advanceBy: 2, nextPlayerDraws: 0 };
      break;
    case 'reverse':
      if (playerCount === 2) {
        // With 2 players: acts as Skip (direction NOT flipped — only one
        // possible "next" anyway). Caller advances by 2 to return to current.
        effect = { type: 'reverse', advanceBy: 2, nextPlayerDraws: 0 };
      } else {
        effect = { type: 'reverse', advanceBy: 1, nextPlayerDraws: 0 };
      }
      break;
    case 'draw_two':
      effect = { type: 'draw_two', advanceBy: 2, nextPlayerDraws: 2 };
      break;
    case 'wild':
      effect = { type: 'wild', advanceBy: 1, nextPlayerDraws: 0 };
      break;
    case 'wild_draw_four': {
      effect = {
        type: 'wild_draw_four',
        // Caller may override advanceBy after resolving challenge — by default
        // advance past the next player (they get skipped after drawing).
        advanceBy: 2,
        nextPlayerDraws: 4,
        w4Context: {
          w4PlayerId: player.id,
          // The challenge is judged against the color in force BEFORE the W4
          // was played — that is `state.currentColor` (not `newCurrentColor`).
          previousColor: state.currentColor,
          // Snapshot is the hand BEFORE the W4 was played → exclude the played card.
          w4PlayerHandSnapshot: player.hand.filter((c) => c.id !== cardId),
        },
      };
      break;
    }
    default:
      // Number cards.
      effect = { type: 'normal', advanceBy: 1, nextPlayerDraws: 0 };
      break;
  }

  return { state: newState, effect };
}

export interface ApplyDrawResult {
  state: EngineGameState;
  /**
   * Cards actually drawn. May be shorter than the requested `count` if
   * deck + discard between them couldn't supply enough — caller treats that
   * as a deadlock signal (see plan §"Deadlock & edge cases").
   */
  drawnCards: Card[];
}

/**
 * Draw `count` cards from the top of the deck for player at `playerIdx`. If
 * the deck runs out mid-draw, reshuffle the discard pile (keeping its top
 * card) into a new deck and continue. If deck + discard combined still can't
 * satisfy the request, returns whatever was available (deadlock signal).
 *
 * Pure: returns new state.
 *
 * Note: this function intentionally does NOT seed shuffles deterministically
 * — reshuffling here uses array order. In practice the caller wires this
 * through `shuffle()` only at deal time, and reshuffle just reverses the
 * discard (sans top) which is good enough for fairness in a re-deal context.
 * Tests rely on this deterministic ordering. If we ever need a shuffled
 * reshuffle, inject an RNG via a future signature change.
 */
export function applyDraw(
  state: EngineGameState,
  playerIdx: number,
  count: number,
  now: number,
): ApplyDrawResult {
  const player = state.players[playerIdx];
  if (!player) throw new Error('invalid_player');

  let deck = state.deck;
  let discard = state.discardPile;
  const drawn: Card[] = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      // Reshuffle discard (except top) into deck.
      if (discard.length <= 1) {
        // Deadlock: nothing left to deal. Return partial result.
        break;
      }
      const top = discard[discard.length - 1] as Card;
      const rest = discard.slice(0, -1);
      // Reverse the rest so the most-recently-played card becomes the bottom
      // of the new deck — pure, deterministic, no RNG required here.
      deck = rest.slice().reverse();
      discard = [top];
    }
    drawn.push(deck[0] as Card);
    deck = deck.slice(1);
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: [...p.hand, ...drawn] } : p,
  );

  return {
    state: {
      ...state,
      deck,
      discardPile: discard,
      players: newPlayers,
      turnStartedAt: now,
    },
    drawnCards: drawn,
  };
}

// ---------------------------------------------------------------------------
// Turn advancement.
// ---------------------------------------------------------------------------

/**
 * Pure index math: advance the turn by `advanceBy * direction`, wrapping
 * around `playerCount`. `advanceBy` is always non-negative; the sign comes
 * from `state.direction`.
 */
export function advanceTurn(
  state: EngineGameState,
  playerCount: number,
  advanceBy: number,
): EngineGameState {
  const n = playerCount;
  const delta = advanceBy * state.direction;
  // ((x % n) + n) % n handles negative modulo.
  const nextIdx = ((state.currentTurnIndex + delta) % n + n) % n;
  return { ...state, currentTurnIndex: nextIdx };
}

// ---------------------------------------------------------------------------
// W4 challenge validation.
// ---------------------------------------------------------------------------

/**
 * Official rule (unorules.com): a Wild Draw Four is legal only if the player
 * playing it has "no other alternative cards to play that matches the color
 * of the card previously played."
 *
 * Interpretation choices (locked here, mirrored in tests):
 *   • Only the PREVIOUS current color matters — not the chosen new color.
 *   • The check is COLOR-MATCH ONLY against non-wild cards in the snapshot.
 *     Same-number/symbol cross-color matches do NOT count as alternatives;
 *     the official rule wording references color specifically.
 *   • Wild cards in the snapshot are NOT alternatives (a player is never
 *     required to play a Wild instead of a W4).
 *   • A regular Wild does count as an alternative for *some* enforcement
 *     readings, but unorules.com explicitly says color-match. We go with the
 *     official wording. This is the cited interpretation in the plan.
 *
 * Returns { legal: true } when the W4 was a legitimate play; the challenger
 * loses (draws 6 = 4 + 2 penalty). Returns { legal: false } when the W4
 * holder had a color-matching card — challenger wins, W4 holder draws 4.
 */
export function validateW4Challenge(
  w4PlayerHandSnapshot: readonly Card[],
  previousColor: PlayableColor,
): { legal: boolean } {
  const hasColorAlternative = w4PlayerHandSnapshot.some(
    (c) => c.color !== 'wild' && c.color === previousColor,
  );
  return { legal: !hasColorAlternative };
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

export interface ScoreRoundResult {
  winnerId: string;
  /** Total points awarded to winner this round. */
  points: number;
  /** Per-loser contribution (each loser's hand value). Map keyed by player id. */
  perPlayer: Record<string, number>;
}

/**
 * Round scoring per PRD §4.6: winner is paid the sum of all other players'
 * remaining card values. (Number = face value; action = 20; wild = 50.)
 */
export function scoreRound(
  players: readonly EnginePlayer[],
  winnerIdx: number,
): ScoreRoundResult {
  const winner = players[winnerIdx];
  if (!winner) throw new Error('invalid_winner');
  const perPlayer: Record<string, number> = {};
  let total = 0;
  players.forEach((p, i) => {
    if (i === winnerIdx) return;
    const sum = p.hand.reduce((acc, c) => acc + c.value, 0);
    perPlayer[p.id] = sum;
    total += sum;
  });
  return { winnerId: winner.id, points: total, perPlayer };
}

// ---------------------------------------------------------------------------
// UNO call / catch window.
// ---------------------------------------------------------------------------

/**
 * Open the UNO catch window: the player just played their penultimate card
 * and is now sitting at 1 card without having called UNO. Caller must invoke
 * this *after* `applyPlay` when the resulting hand length is exactly 1 AND
 * the player did not pre-declare UNO.
 */
export function markUnoVulnerable(
  state: EngineGameState,
  playerId: string,
  now: number,
): EngineGameState {
  return { ...state, unoVulnerable: { playerId, openedAt: now } };
}

/** Close the window without applying a penalty (e.g., next-player action). */
export function clearUnoVulnerable(state: EngineGameState): EngineGameState {
  return { ...state, unoVulnerable: null };
}

/**
 * True iff `targetId` is currently vulnerable AND the absolute fallback
 * window has not yet elapsed. The turnController separately closes the
 * window when the *next* player takes any action — this check is the
 * wall-clock failsafe for idle-next-player scenarios.
 */
export function isUnoCatchable(
  state: EngineGameState,
  targetId: string,
  now: number,
  windowMs: number,
): boolean {
  const v = state.unoVulnerable;
  if (!v) return false;
  if (v.playerId !== targetId) return false;
  return now - v.openedAt <= windowMs;
}

export interface ApplyUnoPenaltyResult {
  state: EngineGameState;
  drawnCards: Card[];
}

/**
 * Apply the 2-card UNO penalty to a caught player. Clears the vulnerability
 * flag whether or not draws succeed (the window is consumed by a successful
 * catch).
 */
export function applyUnoPenalty(
  state: EngineGameState,
  targetIdx: number,
  now: number,
): ApplyUnoPenaltyResult {
  const { state: s, drawnCards } = applyDraw(state, targetIdx, 2, now);
  return { state: { ...s, unoVulnerable: null }, drawnCards };
}

// Re-export the Color type for callers that want to narrow on it without
// digging into @uno/shared (small ergonomic shim).
export type { Color };
