// Modal that prompts the player to pick one of the four UNO play colors.
// Used both for Wild/W4 plays (later) and for the host's starting-color
// choice when the very first card is a Wild.

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { PlayableColor } from '@uno/shared';

export interface ColorChooserProps {
  open: boolean;
  onPick: (color: PlayableColor) => void;
  onCancel?: () => void;
  title?: string;
}

interface ColorMeta {
  value: PlayableColor;
  label: string;
  cssVar: string;
}

const COLORS: readonly ColorMeta[] = [
  { value: 'red', label: 'Red', cssVar: 'var(--uno-red)' },
  { value: 'blue', label: 'Blue', cssVar: 'var(--uno-blue)' },
  { value: 'green', label: 'Green', cssVar: 'var(--uno-green)' },
  { value: 'yellow', label: 'Yellow', cssVar: 'var(--uno-yellow)' },
];

export function ColorChooser({
  open,
  onPick,
  onCancel,
  title = 'Choose a color',
}: ColorChooserProps): JSX.Element | null {
  // Esc closes if cancellable.
  useEffect(() => {
    if (!open || !onCancel) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget && onCancel) onCancel();
      }}
    >
      <div class="modal color-chooser">
        <h2 class="color-chooser__title">{title}</h2>
        <div class="color-chooser__grid">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              class="color-chooser__swatch"
              style={{ backgroundColor: c.cssVar }}
              aria-label={`Pick ${c.label}`}
              onClick={() => onPick(c.value)}
            >
              <span class="color-chooser__swatch-label">{c.label}</span>
            </button>
          ))}
        </div>
        {onCancel ? (
          <button
            type="button"
            class="color-chooser__cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
