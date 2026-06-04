// Floating top-right toast stack. Auto-dismiss is handled by the store;
// this component is a pure projection of the `toasts` signal.

import type { JSX } from 'preact';
import { toasts, dismissToast } from '../store.js';

export function ToastStack(): JSX.Element | null {
  const list = toasts.value;
  if (list.length === 0) return null;
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          class={`toast ${t.kind}`}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
