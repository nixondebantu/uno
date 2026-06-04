// Table — the center play surface. Composes:
//   • DiscardPile (top card + current-color chip)
//   • DrawPile (count + clickable when it's my turn)
//   • CurrentColorIndicator + DirectionIndicator (right-side stack)
//   • Hand (the local player's row)
//
// Replaces the P4b-era `TablePlaceholder`. Reads state from store signals;
// dispatches plays/draws via `useGameActions`.

import type { JSX } from 'preact';

import { DiscardPile } from './DiscardPile.js';
import { DrawPile } from './DrawPile.js';
import { CurrentColorIndicator } from './CurrentColorIndicator.js';
import { DirectionIndicator } from './DirectionIndicator.js';
import { Hand } from './Hand.js';
import { gameState, myHand, myId, roomState } from '../store.js';
import { useGameActions } from '../useGameActions.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

export function Table(): JSX.Element | null {
  const room = roomState.value;
  const game = gameState.value;
  if (!room || !game) return null;

  const me = myId.value;
  const currentPlayerId =
    game.currentTurnIndex >= 0 && game.currentTurnIndex < room.players.length
      ? room.players[game.currentTurnIndex].id
      : null;
  const isMyTurn = me !== null && currentPlayerId === me;

  const actions = useGameActions();
  const isMobile = useMediaQuery('(max-width: 480px)');
  const pileWidth = isMobile ? 70 : 100;

  return (
    <>
      <section class="table" aria-label="Play surface">
        <div class="table__piles">
          <DiscardPile
            topCard={game.topCard}
            currentColor={game.currentColor}
            width={pileWidth}
          />
          <DrawPile
            count={game.drawPileCount}
            canDraw={isMyTurn}
            onDraw={() => actions.drawCard()}
            width={pileWidth}
          />
        </div>
        <div class="table__indicators">
          <CurrentColorIndicator color={game.currentColor} />
          <DirectionIndicator direction={game.direction} />
        </div>
      </section>

      <Hand
        hand={myHand.value}
        topCard={game.topCard}
        currentColor={game.currentColor}
        isMyTurn={isMyTurn}
        onPlay={(cardId, chosenColor) => actions.playCard(cardId, chosenColor)}
      />
    </>
  );
}
