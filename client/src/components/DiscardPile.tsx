// DiscardPile — shows the top card of the discard pile + a small overlay
// chip displaying the currently active color (useful when the top card is a
// Wild and the chosen color differs from the card's printed color).

import type { JSX } from 'preact';
import type { Card as UnoCard, PlayableColor } from '@uno/shared';

import { Card } from './Card.js';
import { CARD_COLOR_HEX } from '../assets/cardSvg.js';

export interface DiscardPileProps {
  topCard: UnoCard;
  currentColor: PlayableColor;
  width?: number;
}

export function DiscardPile({
  topCard,
  currentColor,
  width = 100,
}: DiscardPileProps): JSX.Element {
  return (
    <div class="discard-pile" aria-label="Discard pile">
      <Card card={topCard} width={width} />
      <span
        class="discard-pile__chip"
        style={{ background: CARD_COLOR_HEX[currentColor] }}
        aria-label={`Active color: ${currentColor}`}
        title={`Active color: ${currentColor}`}
      />
    </div>
  );
}
