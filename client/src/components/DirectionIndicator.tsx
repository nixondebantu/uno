// DirectionIndicator — small animated arrow circling clockwise or
// counter-clockwise to mirror the current play direction.
//
// 1 = clockwise, -1 = counter-clockwise (matches `Direction` in shared/state).

import type { JSX } from 'preact';
import type { Direction } from '@uno/shared';

export interface DirectionIndicatorProps {
  direction: Direction;
  size?: number;
}

export function DirectionIndicator({
  direction,
  size = 48,
}: DirectionIndicatorProps): JSX.Element {
  const label =
    direction === 1 ? 'Clockwise turn order' : 'Counter-clockwise turn order';
  const className =
    direction === 1 ? 'dir-indicator dir-indicator--cw' : 'dir-indicator dir-indicator--ccw';

  // Circular arrow built from a path + arrowhead.
  return (
    <div
      class={className}
      style={{ width: `${size}px`, height: `${size}px` }}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        width={size}
        height={size}
      >
        {/* 3/4 circle arc */}
        <path
          d="M 24 6 A 18 18 0 1 1 6 24"
          fill="none"
          stroke="currentColor"
          stroke-width="4"
          stroke-linecap="round"
        />
        {/* Arrowhead at the open end of the arc (top, pointing right for CW). */}
        <path d="M 18 6 L 24 6 L 24 12 Z" fill="currentColor" />
      </svg>
    </div>
  );
}
