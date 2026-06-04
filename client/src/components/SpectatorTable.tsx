// SpectatorTable — center board view for spectators. Same DiscardPile,
// DrawPile (display-only), color + direction indicators as Table, but no
// Hand and the DrawPile cannot be interacted with.

import type { JSX } from 'preact';

import { DiscardPile } from './DiscardPile.js';
import { DrawPile } from './DrawPile.js';
import { CurrentColorIndicator } from './CurrentColorIndicator.js';
import { DirectionIndicator } from './DirectionIndicator.js';
import { gameState, roomState } from '../store.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

export function SpectatorTable(): JSX.Element | null {
  const room = roomState.value;
  const game = gameState.value;
  if (!room || !game) return null;

  const isMobile = useMediaQuery('(max-width: 480px)');
  const pileWidth = isMobile ? 70 : 100;

  return (
    <section class="table" aria-label="Play surface (spectating)">
      <div class="table__piles">
        <DiscardPile
          topCard={game.topCard}
          currentColor={game.currentColor}
          width={pileWidth}
        />
        <DrawPile
          count={game.drawPileCount}
          canDraw={false}
          onDraw={() => {}}
          width={pileWidth}
        />
      </div>
      <div class="table__indicators">
        <CurrentColorIndicator color={game.currentColor} />
        <DirectionIndicator direction={game.direction} />
      </div>
    </section>
  );
}
