// DrawPile — face-down stack the player can click to draw. Renders three
// offset card backs to suggest depth, plus an `×N` count badge.

import type { JSX } from 'preact';
import type { Card as UnoCard } from '@uno/shared';

import { Card } from './Card.js';

export interface DrawPileProps {
  count: number;
  canDraw: boolean;
  onDraw: () => void;
  width?: number;
}

// We need *a* card object to render a face-down placeholder; type/color are
// irrelevant since `faceDown` hides them entirely.
const PLACEHOLDER_BACK: UnoCard = {
  id: 'draw-pile-back',
  color: 'red',
  type: '0',
  value: 0,
};

export function DrawPile({
  count,
  canDraw,
  onDraw,
  width = 100,
}: DrawPileProps): JSX.Element {
  const classes = ['draw-pile'];
  if (!canDraw) classes.push('draw-pile--disabled');

  const handleKey = (e: KeyboardEvent): void => {
    if (!canDraw) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDraw();
    }
  };

  return (
    <div
      class={classes.join(' ')}
      style={{
        width: `${width + 6}px`,
        height: `${(width * 3) / 2 + 6}px`,
      }}
      role={canDraw ? 'button' : 'group'}
      tabIndex={canDraw ? 0 : -1}
      aria-label={`Draw pile (${count} cards)${canDraw ? ' — click to draw' : ''}`}
      onClick={canDraw ? onDraw : undefined}
      onKeyDown={canDraw ? handleKey : undefined}
    >
      {/* Stack — three offset card backs for depth. */}
      <div class="draw-pile__stack draw-pile__stack--3">
        <Card card={PLACEHOLDER_BACK} width={width} faceDown />
      </div>
      <div class="draw-pile__stack draw-pile__stack--2">
        <Card card={PLACEHOLDER_BACK} width={width} faceDown />
      </div>
      <div class="draw-pile__stack draw-pile__stack--1">
        <Card card={PLACEHOLDER_BACK} width={width} faceDown />
      </div>
      <span class="draw-pile__count" aria-hidden="true">×{count}</span>
    </div>
  );
}
