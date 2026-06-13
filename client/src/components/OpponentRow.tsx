// Horizontal row of all opponents (everyone except `myId`).
//
// Each opponent renders as a PlayerAvatar with:
//   • card count subtitle
//   • `active` ring + overlaid TurnTimerRing when it's their turn
//   • `disconnected` ring when isConnected === false
//   • optional "Catch!" button when they have exactly 1 card and have not
//     called UNO yet (tracked via store.unoCalledBy)

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Hand as HandIcon } from 'lucide-preact';
import type { PlayerPublic } from '@uno/shared';

import { PlayerAvatar } from './PlayerAvatar.js';
import { TurnTimerRing } from './TurnTimerRing.js';
import {
  gameState,
  isSpectator,
  myId,
  roomState,
  unoCalledBy,
} from '../store.js';
import { useGameActions } from '../useGameActions.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

function randomCatchStyle() {
  // Random position anywhere on screen, with small margin from edges
  const top = 8 + Math.random() * 80;  // 8%–88% viewport height
  const left = 5 + Math.random() * 85; // 5%–90% viewport width
  return {
    top: `${top.toFixed(1)}%`,
    left: `${left.toFixed(1)}%`,
    transform: 'translate(-50%, -50%)',
  };
}

const AVATAR_SIZE_MOBILE = 32;
const AVATAR_SIZE_DESKTOP = 44;
const TIMER_RING_SIZE_MOBILE = 64;
const TIMER_RING_SIZE_DESKTOP = 84;

export function OpponentRow(): JSX.Element | null {
  const room = roomState.value;
  const game = gameState.value;
  const me = myId.value;
  if (!room) return null;

  // Spectators see every player in the row; players see only opponents.
  const spectating = isSpectator.value;
  const opponents = spectating
    ? room.players
    : room.players.filter((p) => p.id !== me);
  if (opponents.length === 0) return null;

  const currentIndex = game?.currentTurnIndex ?? -1;
  const currentPlayerId =
    currentIndex >= 0 && currentIndex < room.players.length
      ? room.players[currentIndex].id
      : null;

  const timerSeconds = game?.turnTimerSeconds ?? null;
  const turnStartedAt = game?.turnStartedAt ?? 0;
  const deadlineMs =
    timerSeconds !== null ? turnStartedAt + timerSeconds * 1000 : 0;

  return (
    <section
      class="opponent-row"
      aria-label={spectating ? 'Players' : 'Opponents'}
    >
      {opponents.map((p) => (
        <OpponentSlot
          key={p.id}
          player={p}
          isActive={p.id === currentPlayerId}
          timerDeadlineMs={deadlineMs}
          timerSeconds={timerSeconds}
          atRisk={
            !spectating && p.cardCount === 1 && !unoCalledBy.value.has(p.id)
          }
        />
      ))}
    </section>
  );
}

interface OpponentSlotProps {
  player: PlayerPublic;
  isActive: boolean;
  timerDeadlineMs: number;
  timerSeconds: number | null;
  atRisk: boolean;
}

function OpponentSlot({
  player,
  isActive,
  timerDeadlineMs,
  timerSeconds,
  atRisk,
}: OpponentSlotProps): JSX.Element {
  const actions = useGameActions();
  const isDesktop = useMediaQuery('(min-width: 720px)');
  const avatarSize = isDesktop ? AVATAR_SIZE_DESKTOP : AVATAR_SIZE_MOBILE;
  const timerRingSize = isDesktop ? TIMER_RING_SIZE_DESKTOP : TIMER_RING_SIZE_MOBILE;
  const ring = !player.isConnected
    ? 'disconnected'
    : isActive
      ? 'active'
      : null;

  const [catchStyle, setCatchStyle] = useState(randomCatchStyle);
  useEffect(() => {
    if (atRisk) setCatchStyle(randomCatchStyle());
  }, [atRisk]);

  return (
    <div class="opponent-row__slot">
      <div class="opponent-row__avatar-wrap">
        <PlayerAvatar
          name={player.name}
          avatar={player.avatar}
          size={avatarSize}
          ring={ring}
          subtitle={
            !player.isConnected
              ? 'Reconnecting'
              : `${player.cardCount} card${player.cardCount === 1 ? '' : 's'}`
          }
          badges={
            player.cardCount === 1 ? (
              <span title="One card left" aria-label="One card left">
                <HandIcon size={12} color="var(--uno-yellow)" />
              </span>
            ) : null
          }
        />
        {isActive && timerSeconds !== null && timerSeconds > 0 ? (
          <div class="opponent-row__timer">
            <TurnTimerRing
              deadlineMs={timerDeadlineMs}
              totalSeconds={timerSeconds}
              size={timerRingSize}
            />
          </div>
        ) : null}
        {atRisk ? (
          <button
            type="button"
            class="opponent-row__catch"
            style={catchStyle}
            onClick={() => actions.catchUno(player.id)}
            aria-label={`Catch ${player.name} for not calling UNO`}
            title={`Catch ${player.name}!`}
          >
            Catch!
          </button>
        ) : null}
      </div>
    </div>
  );
}
