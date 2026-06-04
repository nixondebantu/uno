// Circular SVG ring that counts down to the current turn's deadline.
//
// Server-authoritative — the ring is purely cosmetic; when it hits zero we do
// not emit any action. Re-renders at ~10fps via rAF.

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface TurnTimerRingProps {
  /** Epoch ms at which the turn expires. */
  deadlineMs: number;
  /** Total seconds for this turn (controls denominator of progress). */
  totalSeconds: number;
  /** Outer diameter in px. */
  size?: number;
  /** Ring stroke width in px. */
  strokeWidth?: number;
}

const FRAME_INTERVAL_MS = 100; // ~10fps is plenty for a countdown ring.

function colorForRatio(ratio: number): string {
  if (ratio > 0.5) return 'var(--color-success)';
  if (ratio > 0.2) return 'var(--color-warn)';
  return 'var(--color-error)';
}

export function TurnTimerRing({
  deadlineMs,
  totalSeconds,
  size = 80,
  strokeWidth = 6,
}: TurnTimerRingProps): JSX.Element | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    const loop = (ts: number): void => {
      if (ts - lastUpdate >= FRAME_INTERVAL_MS) {
        lastUpdate = ts;
        setNow(Date.now());
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [deadlineMs, totalSeconds]);

  if (totalSeconds <= 0) return null;

  const totalMs = totalSeconds * 1000;
  const remaining = Math.max(0, deadlineMs - now);
  const ratio = Math.max(0, Math.min(1, remaining / totalMs));

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const stroke = colorForRatio(ratio);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      class="turn-timer-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`Turn timer: ${Math.ceil(remaining / 1000)}s remaining`}
      role="img"
    >
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        stroke="var(--color-border)"
        stroke-width={strokeWidth}
        fill="none"
        opacity={0.4}
      />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        stroke={stroke}
        stroke-width={strokeWidth}
        fill="none"
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={dashOffset}
        // Rotate so progress starts at 12 o'clock.
        transform={`rotate(-90 ${cx} ${cy})`}
        style="transition: stroke-dashoffset 120ms linear, stroke 200ms ease;"
      />
    </svg>
  );
}
