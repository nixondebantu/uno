// Full-screen blinking gradient border shown ONLY to the player whose turn it
// is — soft "your move" cue. Colored with the current round color. Purely
// decorative: fixed overlay, pointer-events:none, sits below modals/prompts.

import type { JSX } from 'preact';

import type { PlayableColor } from '@uno/shared';

// UNO color -> design token used for the glow.
const GLOW_TOKEN: Record<PlayableColor, string> = {
  red: 'var(--uno-red)',
  blue: 'var(--uno-blue)',
  green: 'var(--uno-green)',
  yellow: 'var(--uno-yellow)',
};

export function TurnGlow({ color }: { color: PlayableColor }): JSX.Element {
  return (
    <div
      class="turn-glow"
      aria-hidden="true"
      style={{ '--glow': GLOW_TOKEN[color] }}
    />
  );
}
