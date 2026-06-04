import { describe, it, expect } from 'vitest';
import { buildDeck } from '../src/gameEngine.js';
import { CARD_VALUES, type CardType } from '@uno/shared';

describe('buildDeck — exact 108-card composition', () => {
  const deck = buildDeck();

  it('has exactly 108 cards', () => {
    expect(deck).toHaveLength(108);
  });

  it('has all unique ids', () => {
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(108);
  });

  function countByType(type: CardType): number {
    return deck.filter((c) => c.type === type).length;
  }

  it('has 4 zeros (one per color)', () => {
    expect(countByType('0')).toBe(4);
  });

  it('has 8 of each of 1..9', () => {
    for (let n = 1; n <= 9; n++) {
      expect(countByType(String(n) as CardType)).toBe(8);
    }
  });

  it('has 76 numbered cards total', () => {
    const numbered = deck.filter((c) => /^[0-9]$/.test(c.type));
    expect(numbered).toHaveLength(76);
  });

  it('has 8 skip, 8 reverse, 8 draw_two', () => {
    expect(countByType('skip')).toBe(8);
    expect(countByType('reverse')).toBe(8);
    expect(countByType('draw_two')).toBe(8);
  });

  it('has 4 wild and 4 wild_draw_four', () => {
    expect(countByType('wild')).toBe(4);
    expect(countByType('wild_draw_four')).toBe(4);
  });

  it('has 4 colors × 25 cards = 100 colored + 8 wild = 108', () => {
    const byColor = (color: string) =>
      deck.filter((c) => c.color === color).length;
    expect(byColor('red')).toBe(25);
    expect(byColor('blue')).toBe(25);
    expect(byColor('green')).toBe(25);
    expect(byColor('yellow')).toBe(25);
    expect(byColor('wild')).toBe(8);
  });

  it('every card value matches CARD_VALUES', () => {
    for (const c of deck) {
      expect(c.value).toBe(CARD_VALUES[c.type]);
    }
  });

  it('total deck point value equals expected max round score', () => {
    // 4 colors × (0 + 2*(1+..+9)) = 4 * (0 + 90) = 360 numbered
    //   = 0*4 + (1+..+9)*8 = 0 + 45*8 = 360 numbered
    // 24 action cards × 20 = 480
    // 8 wild family × 50 = 400
    // total = 360 + 480 + 400 = 1240
    const total = buildDeck().reduce((acc, c) => acc + c.value, 0);
    expect(total).toBe(1240);
  });
});
