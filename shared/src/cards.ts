// Card primitives shared between server and client.
// Pure types + small const tables — no runtime deps.

export type Color = 'red' | 'blue' | 'green' | 'yellow' | 'wild';

// Color the active play resolves to. After a Wild/W4 lands, the player picks one.
export type PlayableColor = 'red' | 'blue' | 'green' | 'yellow';

export type CardType =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'skip'
  | 'reverse'
  | 'draw_two'
  | 'wild'
  | 'wild_draw_four';

export interface Card {
  id: string;
  color: Color;
  type: CardType;
  value: number;
}

// PRD §4.6 scoring: number cards = face value, action cards = 20, wilds = 50.
export const CARD_VALUES: Record<CardType, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  skip: 20,
  reverse: 20,
  draw_two: 20,
  wild: 50,
  wild_draw_four: 50,
};

export const PLAYABLE_COLORS: readonly PlayableColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
] as const;

const NUMBER_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]);

const ACTION_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  'skip',
  'reverse',
  'draw_two',
]);

const WILD_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  'wild',
  'wild_draw_four',
]);

export function isNumberCard(c: Card): boolean {
  return NUMBER_TYPES.has(c.type);
}

export function isActionCard(c: Card): boolean {
  return ACTION_TYPES.has(c.type);
}

export function isWildCard(c: Card): boolean {
  return WILD_TYPES.has(c.type);
}

/**
 * A card is playable if:
 *   • it is a Wild family card (Wild / Wild Draw Four — always legal to put down;
 *     W4 legality is judged afterward via the challenge mechanic, NOT here), OR
 *   • its color matches `currentColor` (which may have been set by a prior Wild), OR
 *   • its type matches the top card's type (number or symbol match).
 *
 * Pure function — shared between server rules engine and client hand UI.
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
