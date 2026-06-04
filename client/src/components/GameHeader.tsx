// Top-of-screen game header.
//   • room code (top-right) for sharing
//   • round number
//   • score-table toggle that pops open a side drawer with cumulative scores

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ListOrdered, X } from 'lucide-preact';

import { gameState, roomState } from '../store.js';

export function GameHeader(): JSX.Element | null {
  const room = roomState.value;
  const game = gameState.value;
  if (!room) return null;

  const [scoresOpen, setScoresOpen] = useState(false);

  return (
    <header class="game-header" aria-label="Game header">
      <div class="game-header__left">
        <button
          type="button"
          class="game-header__icon-btn"
          aria-label="Show scores"
          onClick={() => setScoresOpen(true)}
        >
          <ListOrdered size={16} />
          <span>Scores</span>
        </button>
        {game ? (
          <span class="game-header__round">Round {game.round}</span>
        ) : null}
      </div>
      <div class="game-header__right">
        <span class="game-header__code-label">Room</span>
        <span class="game-header__code">{room.code}</span>
      </div>

      {scoresOpen ? (
        <ScoreDrawer onClose={() => setScoresOpen(false)} />
      ) : null}
    </header>
  );
}

interface ScoreDrawerProps {
  onClose: () => void;
}

function ScoreDrawer({ onClose }: ScoreDrawerProps): JSX.Element {
  const room = roomState.value;
  const players = room ? [...room.players].sort((a, b) => b.score - a.score) : [];
  return (
    <div
      class="modal-overlay score-drawer__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Scores"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside class="score-drawer">
        <header class="score-drawer__header">
          <h2>Scores</h2>
          <button
            type="button"
            class="game-header__icon-btn"
            onClick={onClose}
            aria-label="Close scores"
          >
            <X size={16} />
          </button>
        </header>
        <ul class="score-drawer__list">
          {players.map((p) => (
            <li key={p.id} class="score-drawer__row">
              <span class="score-drawer__name">{p.name}</span>
              <span class="score-drawer__pts">{p.score} pts</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
