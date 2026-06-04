// Card — Preact component wrapping the SVG-string renderer.
//
// Choice: we inject the SVG via `dangerouslySetInnerHTML` rather than re-build
// a parallel JSX tree. Rationale (decided per P4a brief):
//   • Single source of truth for the visual recipe (cardSvg.ts).
//   • Same string is reusable for data URIs / CSS backgrounds.
//   • The SVG itself never reacts — events live on the wrapper div, not on
//     internal SVG nodes, so the lack of JSX inside the SVG is harmless.
//
// All interactivity (click, hover lift, dim, selected glow) is handled by the
// outer wrapper via CSS classes.

import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { Card as UnoCard } from '@uno/shared';

import { renderCardSvg } from '../assets/cardSvg.js';

export interface CardProps {
  card: UnoCard;
  width?: number;
  faceDown?: boolean;
  /** Greys out + reduces opacity — used for non-playable cards in hand. */
  dim?: boolean;
  /** Highlights the card with a glow ring (e.g. hover-confirmed selection). */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  /** Accessibility label override. */
  ariaLabel?: string;
  /**
   * Force the card to be a focusable button regardless of `onClick`. Used by
   * `Hand` so non-playable cards stay reachable via Tab and announce
   * `aria-disabled`.
   */
  interactive?: boolean;
  /** Override the aria-disabled state. Defaults to !onClick && interactive. */
  ariaDisabled?: boolean;
}

function defaultAriaLabel(card: UnoCard, faceDown: boolean): string {
  if (faceDown) return 'Face-down card';
  if (card.color === 'wild') {
    return card.type === 'wild_draw_four' ? 'Wild Draw Four' : 'Wild';
  }
  const colorName = card.color[0].toUpperCase() + card.color.slice(1);
  switch (card.type) {
    case 'skip':
      return `${colorName} Skip`;
    case 'reverse':
      return `${colorName} Reverse`;
    case 'draw_two':
      return `${colorName} Draw Two`;
    default:
      return `${colorName} ${card.type}`;
  }
}

export function Card({
  card,
  width = 80,
  faceDown = false,
  dim = false,
  selected = false,
  onClick,
  className,
  ariaLabel,
  interactive,
  ariaDisabled,
}: CardProps): JSX.Element {
  const svg = useMemo(
    () => renderCardSvg(card, { faceDown }),
    [card.id, card.color, card.type, faceDown],
  );

  const isButton = Boolean(onClick) || Boolean(interactive);

  const classes = ['uno-card'];
  if (dim) classes.push('uno-card--dim');
  if (selected) classes.push('uno-card--selected');
  if (isButton) classes.push('uno-card--interactive');
  if (className) classes.push(className);

  const handleKey = (e: KeyboardEvent): void => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const resolvedAriaDisabled =
    ariaDisabled !== undefined
      ? ariaDisabled
      : isButton && !onClick
        ? true
        : undefined;

  return (
    <div
      class={classes.join(' ')}
      style={{
        width: `${width}px`,
        height: `${(width * 3) / 2}px`,
      }}
      role={isButton ? 'button' : 'img'}
      tabIndex={isButton ? 0 : -1}
      aria-label={ariaLabel ?? defaultAriaLabel(card, faceDown)}
      aria-disabled={resolvedAriaDisabled}
      onClick={onClick}
      onKeyDown={isButton ? handleKey : undefined}
      // Inject the pre-built SVG markup. The SVG renderer is the only source
      // of truth for card visuals.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
