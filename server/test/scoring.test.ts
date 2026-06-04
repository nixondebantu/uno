import { describe, it, expect } from 'vitest';
import { buildDeck, scoreRound, type EnginePlayer } from '../src/gameEngine.js';
import type { Card, CardType } from '@uno/shared';

function card(id: string, type: CardType, value: number): Card {
  return { id, color: 'red', type, value };
}

describe('scoreRound', () => {
  it('number cards: sum face values', () => {
    const players: EnginePlayer[] = [
      { id: 'w', hand: [], score: 0 },
      { id: 'a', hand: [card('a1', '5', 5), card('a2', '7', 7)], score: 0 },
      { id: 'b', hand: [card('b1', '3', 3)], score: 0 },
    ];
    const r = scoreRound(players, 0);
    expect(r.winnerId).toBe('w');
    expect(r.points).toBe(15);
    expect(r.perPlayer).toEqual({ a: 12, b: 3 });
  });

  it('action cards = 20 each', () => {
    const players: EnginePlayer[] = [
      { id: 'w', hand: [], score: 0 },
      {
        id: 'a',
        hand: [card('s', 'skip', 20), card('r', 'reverse', 20), card('d', 'draw_two', 20)],
        score: 0,
      },
    ];
    const r = scoreRound(players, 0);
    expect(r.points).toBe(60);
    expect(r.perPlayer.a).toBe(60);
  });

  it('wilds = 50 each', () => {
    const players: EnginePlayer[] = [
      { id: 'w', hand: [], score: 0 },
      {
        id: 'a',
        hand: [card('w1', 'wild', 50), card('w2', 'wild_draw_four', 50)],
        score: 0,
      },
    ];
    const r = scoreRound(players, 0);
    expect(r.points).toBe(100);
  });

  it('mixed: numbers + action + wild', () => {
    const players: EnginePlayer[] = [
      { id: 'w', hand: [], score: 0 },
      {
        id: 'a',
        hand: [card('n', '9', 9), card('s', 'skip', 20), card('w', 'wild', 50)],
        score: 0,
      },
    ];
    const r = scoreRound(players, 0);
    expect(r.points).toBe(79);
  });

  it('throws on invalid winner index', () => {
    const players: EnginePlayer[] = [{ id: 'a', hand: [], score: 0 }];
    expect(() => scoreRound(players, 5)).toThrow();
  });

  it('summing all 108 cards = max possible round score (1240)', () => {
    // Edge case: imagine winner has empty hand and one mega-loser holds the
    // entire 107-card rest of the deck. (Impossible in practice but exercises
    // the sum.)
    const deck = buildDeck();
    const players: EnginePlayer[] = [
      { id: 'w', hand: [], score: 0 },
      { id: 'loser', hand: deck, score: 0 },
    ];
    const r = scoreRound(players, 0);
    expect(r.points).toBe(1240);
    expect(r.perPlayer.loser).toBe(1240);
  });

  it('table-driven values per card type', () => {
    const cases: Array<{ type: CardType; expected: number }> = [
      { type: '0', expected: 0 },
      { type: '1', expected: 1 },
      { type: '5', expected: 5 },
      { type: '9', expected: 9 },
      { type: 'skip', expected: 20 },
      { type: 'reverse', expected: 20 },
      { type: 'draw_two', expected: 20 },
      { type: 'wild', expected: 50 },
      { type: 'wild_draw_four', expected: 50 },
    ];
    for (const c of cases) {
      const players: EnginePlayer[] = [
        { id: 'w', hand: [], score: 0 },
        { id: 'a', hand: [card('x', c.type, c.expected)], score: 0 },
      ];
      const r = scoreRound(players, 0);
      expect(r.points).toBe(c.expected);
    }
  });
});
