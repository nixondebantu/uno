// Game screen — top-level layout per PRD §10.3.
//
// Owners:
//   • P4a: card visuals — Table (piles + indicators + Hand).
//   • P4b: game-loop UI — GameHeader, OpponentRow, SelfStatus, prompts.
//   • P5b: spectator mode swap + ConnectionLostBanner mount point.

import type { JSX } from 'preact';

import { GameHeader } from '../components/GameHeader.js';
import { OpponentRow } from '../components/OpponentRow.js';
import { SelfStatus } from '../components/SelfStatus.js';
import { SpectatorBanner } from '../components/SpectatorBanner.js';
import { ChallengePrompt } from '../components/ChallengePrompt.js';
import { StartingColorPrompt } from '../components/StartingColorPrompt.js';
import { PlayableDrawnPrompt } from '../components/PlayableDrawnPrompt.js';
import { Table } from '../components/Table.js';
import { SpectatorTable } from '../components/SpectatorTable.js';
import { gameState, isSpectator, roomState } from '../store.js';
import './Game.css';

export function Game(): JSX.Element {
  const room = roomState.value;
  const game = gameState.value;
  const spectating = isSpectator.value;

  if (!room || !game) {
    return (
      <main class="game">
        <p class="game__loading">Waiting for game state&hellip;</p>
      </main>
    );
  }

  return (
    <main class="game">
      <GameHeader />
      <OpponentRow />
      {spectating ? <SpectatorTable /> : <Table />}
      {spectating ? <SpectatorBanner /> : <SelfStatus />}

      {/* Floating overlays — only meaningful for active players. */}
      {!spectating ? (
        <>
          <ChallengePrompt />
          <StartingColorPrompt />
          <PlayableDrawnPrompt />
        </>
      ) : null}
    </main>
  );
}
