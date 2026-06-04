// Minimal URL-driven router.
// Routes:
//   /             → home
//   /room/:CODE   → lobby (auto-joins if name + token present, else home)

import { signal } from '@preact/signals';
import { ROOM_CODE_LEN } from '@uno/shared';

export const current = signal<string>(window.location.pathname);

window.addEventListener('popstate', () => {
  current.value = window.location.pathname;
});

export interface NavigateOptions {
  replace?: boolean;
}

export function navigate(path: string, opts?: NavigateOptions): void {
  if (opts?.replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  current.value = path;
}

/**
 * Extract the room code from `/room/:CODE`. Normalizes to uppercase and
 * validates the 6-char length so a typo'd URL doesn't get auto-joined.
 */
export function routeRoomCode(): string | null {
  const path = current.value;
  const match = /^\/room\/([A-Za-z0-9]+)\/?$/.exec(path);
  if (!match) return null;
  const code = match[1].toUpperCase();
  if (code.length !== ROOM_CODE_LEN) return null;
  return code;
}
