// Bottom-of-screen status bar for the local player:
//   • my avatar + name (with "Your turn!" pulse when it's my turn)
//   • round score
//   • UNO! button when applicable
//   • connection status dot

import type { JSX } from 'preact';

import { PlayerAvatar } from './PlayerAvatar.js';
import { TurnTimerRing } from './TurnTimerRing.js';
import { UnoButton } from './UnoButton.js';
import {
  gameState,
  isConnected,
  myId,
  roomState,
  unoCallable,
} from '../store.js';
import { useGameActions } from '../useGameActions.js';

export function SelfStatus(): JSX.Element | null {
  const room = roomState.value;
  const game = gameState.value;
  const me = myId.value;
  if (!room || !me) return null;

  const myPlayer = room.players.find((p) => p.id === me);
  if (!myPlayer) return null;

  const actions = useGameActions();

  const currentIndex = game?.currentTurnIndex ?? -1;
  const myIndex = room.players.findIndex((p) => p.id === me);
  const itsMyTurn = currentIndex === myIndex && myIndex >= 0;

  const timerSeconds = game?.turnTimerSeconds ?? null;
  const deadlineMs =
    timerSeconds !== null && game ? game.turnStartedAt + timerSeconds * 1000 : 0;

  return (
    <footer class="self-status" aria-label="Your status">
      <div class="self-status__avatar-wrap">
        <PlayerAvatar
          name={myPlayer.name}
          avatar={myPlayer.avatar}
          size={48}
          ring={
            !isConnected.value
              ? 'disconnected'
              : itsMyTurn
                ? 'active'
                : null
          }
          subtitle={itsMyTurn ? 'Your turn!' : `${myPlayer.score} pts`}
        />
        {itsMyTurn && timerSeconds !== null && timerSeconds > 0 ? (
          <div class="self-status__timer">
            <TurnTimerRing
              deadlineMs={deadlineMs}
              totalSeconds={timerSeconds}
              size={96}
            />
          </div>
        ) : null}
      </div>

      <div class="self-status__center">
        <UnoButton
          visible={unoCallable.value}
          onClick={() => actions.callUno()}
        />
      </div>

      <div class="self-status__right">
        <span
          class={`self-status__conn ${isConnected.value ? 'on' : 'off'}`}
          title={isConnected.value ? 'Connected' : 'Disconnected'}
          aria-label={isConnected.value ? 'Connected' : 'Disconnected'}
        />
      </div>
    </footer>
  );
}
