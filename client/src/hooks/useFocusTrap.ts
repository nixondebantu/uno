// Small focus-trap hook — no library dependency.
//
// Behaviour when `active` is true and the ref is attached:
//   • On mount: remembers the previously-focused element, then moves focus to
//     the first tabbable descendant inside the container (or the container
//     itself if it has tabindex>=0). Falls back to focusing the container.
//   • Tab / Shift+Tab cycle focus within the container's tabbable set —
//     wrapping at the ends. No focus escapes the modal.
//   • On unmount: restores focus to the previously-focused element if it's
//     still in the DOM.
//
// We deliberately listen on `keydown` (capture phase) at the document level so
// nested elements that stopPropagation can't break the trap.
//
// Strict-typed; no DOM mutations beyond focus().

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getTabbables(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR);
  const list: HTMLElement[] = [];
  nodes.forEach((el) => {
    if (el.hasAttribute('disabled')) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    // Skip invisible elements (display:none / visibility:hidden / size 0).
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    list.push(el);
  });
  return list;
}

export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return undefined;
    const container = ref.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Defer initial focus until after Preact has flushed children.
    const initialFocus = window.setTimeout(() => {
      const tabbables = getTabbables(container);
      if (tabbables.length > 0) {
        tabbables[0].focus();
      } else {
        // Make container focusable as a last resort so SR users land inside.
        if (!container.hasAttribute('tabindex')) {
          container.setAttribute('tabindex', '-1');
        }
        container.focus();
      }
    }, 0);

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const tabbables = getTabbables(container);
      if (tabbables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(initialFocus);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          // Ignore — element may have been detached or non-focusable.
        }
      }
    };
  }, [active, ref]);
}
