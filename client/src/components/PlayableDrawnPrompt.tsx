// After DRAW_CARD, the server tells you (privately) if the drawn card is
// playable on the current discard top. Show a small modal asking "Play it or
// pass?" — Wild/W4 drawn requires a color first (delegated to ColorChooser).

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { PlayableColor } from '@uno/shared';

import { ColorChooser } from './ColorChooser.js';
import { playableDrawn } from '../store.js';
import { useGameActions } from '../useGameActions.js';

function cardLabel(color: string, type: string): string {
  return `${color === 'wild' ? 'Wild' : color} ${type.replace('_', ' ')}`;
}

export function PlayableDrawnPrompt(): JSX.Element | null {
  const drawn = playableDrawn.value;
  const actions = useGameActions();
  const [pickingColor, setPickingColor] = useState(false);

  if (!drawn) return null;

  const requiresColor = drawn.color === 'wild';

  const onPlay = (): void => {
    if (requiresColor) {
      setPickingColor(true);
      return;
    }
    actions.playCard(drawn.id);
  };

  const onPickColor = (color: PlayableColor): void => {
    setPickingColor(false);
    actions.playCard(drawn.id, color);
  };

  if (pickingColor) {
    return (
      <ColorChooser
        open={true}
        onPick={onPickColor}
        onCancel={() => setPickingColor(false)}
        title="Pick a color for your Wild"
      />
    );
  }

  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Play drawn card?"
    >
      <div class="modal playable-drawn-modal">
        <h2 class="playable-drawn-modal__title">You drew a playable card</h2>
        <p class="playable-drawn-modal__body">
          {cardLabel(drawn.color, drawn.type)} — play it now or pass?
        </p>
        <div class="playable-drawn-modal__actions">
          <button type="button" onClick={() => actions.passTurn()}>
            Pass
          </button>
          <button
            type="button"
            class="primary"
            onClick={onPlay}
          >
            Play
          </button>
        </div>
      </div>
    </div>
  );
}
