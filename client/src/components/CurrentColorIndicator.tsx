// CurrentColorIndicator — pill showing the active color (label + swatch dot).
// Used in the Game header alongside DirectionIndicator.

import type { JSX } from 'preact';
import type { PlayableColor } from '@uno/shared';

import { CARD_COLOR_HEX } from '../assets/cardSvg.js';

export interface CurrentColorIndicatorProps {
  color: PlayableColor;
}

const LABELS: Record<PlayableColor, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
};

export function CurrentColorIndicator({
  color,
}: CurrentColorIndicatorProps): JSX.Element {
  return (
    <div
      class="current-color"
      role="status"
      aria-label={`Active color: ${LABELS[color]}`}
    >
      <span
        class="current-color__dot"
        style={{ background: CARD_COLOR_HEX[color] }}
      />
      <span class="current-color__label">{LABELS[color]}</span>
    </div>
  );
}
