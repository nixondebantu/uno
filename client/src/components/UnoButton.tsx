// Big pulsing UNO! button — visible when the local player has 1 card AND has
// not yet called UNO this round. Clicking emits CALL_UNO and flips the local
// `unoCallEmitted` flag (handled inside useGameActions().callUno).

import type { JSX } from 'preact';

export interface UnoButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function UnoButton({ visible, onClick }: UnoButtonProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      class="uno-button"
      onClick={onClick}
      aria-label="Call UNO"
    >
      UNO!
    </button>
  );
}
