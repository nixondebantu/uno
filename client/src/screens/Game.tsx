// Game screen — top-level layout per PRD §10.3.
//
// Owners:
//   • P4a: card visuals — Table (piles + indicators + Hand).
//   • P4b: game-loop UI — GameHeader, OpponentRow, SelfStatus, prompts.
//
// Component composition kept thin; per-section state lives in each component
// reading the store directly.

import type { JSX } from 'preact';

import { GameHeader } from '../components/GameHeader.js';
import { OpponentRow } from '../components/OpponentRow.js';
import { SelfStatus } from '../components/SelfStatus.js';
import { ChallengePrompt } from '../components/ChallengePrompt.js';
import { StartingColorPrompt } from '../components/StartingColorPrompt.js';
import { PlayableDrawnPrompt } from '../components/PlayableDrawnPrompt.js';
import { Table } from '../components/Table.js';
import { gameState, roomState } from '../store.js';
import './Game.css';

export function Game(): JSX.Element {
  const room = roomState.value;
  const game = gameState.value;

  if (!room || !game) {
    return (
      <main class="game">
        <p class="game__loading">Waiting for game state…</p>
      </main>
    );
  }

  return (
    <main class="game">
      <GameHeader />
      <OpponentRow />
      <Table />
      <SelfStatus />

      {/* Floating overlays */}
      <ChallengePrompt />
      <StartingColorPrompt />
      <PlayableDrawnPrompt />
    </main>
  );
}
