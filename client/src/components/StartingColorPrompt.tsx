// Host-only modal shown when the very first card is a Wild and the host must
// declare the opening color. Reuses ColorChooser for the picker UI.

import type { JSX } from 'preact';

import { ColorChooser } from './ColorChooser.js';
import { awaitingStartingColor, myId, roomState } from '../store.js';
import { useGameActions } from '../useGameActions.js';

export function StartingColorPrompt(): JSX.Element | null {
  const room = roomState.value;
  if (!room) return null;
  const isHost = myId.value === room.hostId;
  if (!awaitingStartingColor.value || !isHost) return null;

  const actions = useGameActions();
  return (
    <ColorChooser
      open={true}
      onPick={(color) => actions.setStartingColor(color)}
      title="Pick the starting color"
    />
  );
}
