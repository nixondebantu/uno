// Hand — the local player's row of cards.
//
// Behaviour:
//   • Desktop (≥640px): fan-out, cards overlap via negative margin; hover lifts
//     the focused card and reveals neighbours via CSS.
//   • Mobile (<640px): scroll-snap horizontal row, full-width-by-card.
//   • Non-playable cards are dimmed (still rendered, just not clickable).
//   • Clicking a Wild/W4 card opens the ColorChooser before emitting the play.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  isPlayable,
  isWildCard,
  type Card as UnoCard,
  type PlayableColor,
} from '@uno/shared';

import { Card } from './Card.js';
import { ColorChooser } from './ColorChooser.js';

export interface HandProps {
  hand: UnoCard[];
  topCard: UnoCard;
  currentColor: PlayableColor;
  isMyTurn: boolean;
  onPlay: (cardId: string, chosenColor?: PlayableColor) => void;
}

export function Hand({
  hand,
  topCard,
  currentColor,
  isMyTurn,
  onPlay,
}: HandProps): JSX.Element {
  // The card currently waiting on a color pick (Wild family + playable).
  const [pendingWildId, setPendingWildId] = useState<string | null>(null);

  const onCardClick = (card: UnoCard): void => {
    if (!isMyTurn) return;
    if (!isPlayable(card, topCard, currentColor)) return;
    if (isWildCard(card)) {
      setPendingWildId(card.id);
      return;
    }
    onPlay(card.id);
  };

  const onColorPicked = (color: PlayableColor): void => {
    if (pendingWildId) {
      onPlay(pendingWildId, color);
      setPendingWildId(null);
    }
  };

  return (
    <>
      <div class="hand" role="list" aria-label="Your hand">
        {hand.map((card) => {
          const playable = isMyTurn && isPlayable(card, topCard, currentColor);
          return (
            <div class="hand__slot" role="listitem" key={card.id}>
              <Card
                card={card}
                width={80}
                dim={!playable}
                onClick={playable ? () => onCardClick(card) : undefined}
              />
            </div>
          );
        })}
      </div>
      <ColorChooser
        open={pendingWildId !== null}
        onPick={onColorPicked}
        onCancel={() => setPendingWildId(null)}
        title="Pick a color for your Wild"
      />
    </>
  );
}
