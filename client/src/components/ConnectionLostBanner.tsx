// ConnectionLostBanner — global top banner shown whenever the socket
// transport is disconnected. Driven by the `isConnected` signal that
// main.tsx wires from `onConnectionChange`.

import type { JSX } from 'preact';
import { Loader2 } from 'lucide-preact';

import { isConnected } from '../store.js';

export function ConnectionLostBanner(): JSX.Element | null {
  if (isConnected.value) return null;
  return (
    <div
      class="conn-lost"
      role="status"
      aria-live="polite"
      aria-label="Connection lost. Reconnecting."
    >
      <span class="conn-lost__icon" aria-hidden="true">
        <Loader2 size={16} />
      </span>
      <span>Connection lost. Reconnecting&hellip;</span>
    </div>
  );
}
