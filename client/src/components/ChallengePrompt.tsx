// Modal asking the next player whether to challenge an incoming Wild Draw 4.
// Auto-decline countdown bar shows time remaining until the server's deadline.
// On either click, we clear the prompt locally; the server confirms via
// W4_CHALLENGE_RESULT.

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { roomState, w4ChallengePrompt } from '../store.js';
import { useGameActions } from '../useGameActions.js';

const TICK_MS = 100;
// Server's W4 prompt window is 5s (see turnController). Used only for the
// progress bar denominator; the server still owns the auto-decline.
const W4_PROMPT_WINDOW_MS = 5000;

function findPlayerName(id: string): string {
  const room = roomState.value;
  if (!room) return id;
  const p = room.players.find((x) => x.id === id);
  return p ? p.name : id;
}

export function ChallengePrompt(): JSX.Element | null {
  const prompt = w4ChallengePrompt.value;
  const actions = useGameActions();

  // Local clock for the countdown bar.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!prompt) return undefined;
    const handle = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(handle);
  }, [prompt?.deadlineMs]);

  if (!prompt) return null;

  const remainingMs = Math.max(0, prompt.deadlineMs - now);
  const widthPct = Math.max(
    0,
    Math.min(100, (remainingMs / W4_PROMPT_WINDOW_MS) * 100),
  );
  const name = findPlayerName(prompt.againstPlayerId);

  return (
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Wild Draw 4 challenge"
    >
      <div class="modal challenge-modal">
        <div
          class="challenge-modal__progress"
          aria-hidden="true"
        >
          <div
            class="challenge-modal__progress-fill"
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <h2 class="challenge-modal__title">Wild Draw 4 challenge?</h2>
        <p class="challenge-modal__body">
          <strong>{name}</strong> just played a Wild Draw 4. If you think it was
          illegal, challenge it. If you're wrong, you'll draw 6 instead of 4.
        </p>
        <div class="challenge-modal__actions">
          <button
            type="button"
            class="challenge-modal__accept"
            onClick={() => actions.respondW4(false)}
          >
            Accept (draw 4)
          </button>
          <button
            type="button"
            class="challenge-modal__challenge primary"
            onClick={() => actions.respondW4(true)}
          >
            Challenge!
          </button>
        </div>
      </div>
    </div>
  );
}
