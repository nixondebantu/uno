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
