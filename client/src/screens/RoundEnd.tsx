// RoundEnd screen — modal overlay shown between rounds.
//
// Reads `roundEndState` (from the ROUND_END event) and the latest
// `roomState.players` for cumulative scores. Reveals every player's
// final hand as a row of small Card components. Host sees a "Next Round"
// CTA that emits NEXT_ROUND; non-hosts see a waiting message.

import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { Trophy } from 'lucide-preact';
import { CARD_VALUES, type Card as UnoCard, type PlayerPublic } from '@uno/shared';

import styles from './RoundEnd.module.css';
import { Card } from '../components/Card.js';
import { AvatarIcon } from '../avatars.js';
import {
  myId,
  roomState,
  roundEndState,
} from '../store.js';
import { useGameActions } from '../useGameActions.js';

interface ScoreRow {
  player: PlayerPublic;
  cardsRemaining: number;
  pointsContributed: number;
  cumulative: number;
  isWinner: boolean;
}

function buildRows(
  players: readonly PlayerPublic[],
  hands: Record<string, UnoCard[]>,
  cumulativeScores: Record<string, number>,
  winnerId: string,
): ScoreRow[] {
  // Sort by seating order — keep the table predictable across rounds.
  return players.map((p) => {
    const hand = hands[p.id] ?? [];
    const contributed = sumHandValue(hand);
    return {
      player: p,
      cardsRemaining: hand.length,
      pointsContributed: contributed,
      cumulative: cumulativeScores[p.id] ?? p.score,
      isWinner: p.id === winnerId,
    };
  });
}

function sumHandValue(hand: readonly UnoCard[]): number {
  let total = 0;
  for (const c of hand) total += CARD_VALUES[c.type] ?? 0;
  return total;
}

function findHostId(players: readonly PlayerPublic[]): string | null {
  const host = players.find((p) => p.isHost);
  return host ? host.id : null;
}

export function RoundEnd(): JSX.Element {
  const end = roundEndState.value;
  const room = roomState.value;
  const me = myId.value;
  const actions = useGameActions();

  const rows: ScoreRow[] = useMemo(() => {
    if (!end || !room) return [];
    return buildRows(room.players, end.hands, end.scores, end.winnerId);
  }, [end, room]);

  if (!end || !room) {
    return (
      <div class={styles.overlay} role="dialog" aria-modal="true">
        <div class={styles.modal}>
          <p>Tallying scores…</p>
        </div>
      </div>
    );
  }

  const winner = room.players.find((p) => p.id === end.winnerId);
  const hostId = findHostId(room.players);
  const iAmHost = hostId !== null && hostId === me;

  return (
    <div
      class={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-end-title"
    >
      <div class={styles.modal}>
        {/* Banner ----------------------------------------------------- */}
        <div class={styles.banner}>
          <div class={styles.bannerLabel}>Round {room.game?.round ?? ''} complete</div>
          {winner ? (
            <h1 id="round-end-title" class={styles.bannerWinner}>
              {winner.name} wins the round!
            </h1>
          ) : (
            <h1 id="round-end-title" class={styles.bannerDraw}>
              Round ended — no winner
            </h1>
          )}
        </div>

        {/* Score table ----------------------------------------------- */}
        <div class={styles.tableWrap}>
          <table class={styles.table}>
            <thead>
              <tr>
                <th>Player</th>
                <th class={styles.numCol}>Cards left</th>
                <th class={styles.numCol}>Round pts</th>
                <th class={styles.numCol}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.player.id}
                  class={row.isWinner ? styles.winnerRow : ''}
                >
                  <td>
                    <div class={styles.nameCell}>
                      <div class={styles.nameCellIcon}>
                        <AvatarIcon name={row.player.avatar} size={20} />
                      </div>
                      <span>{row.player.name}</span>
                      {row.isWinner ? (
                        <span class={styles.winnerBadge}>
                          <Trophy size={12} aria-hidden="true" />
                          Winner
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td class={styles.numCol}>{row.cardsRemaining}</td>
                  <td class={styles.numCol}>
                    {row.isWinner ? '—' : `+${row.pointsContributed}`}
                  </td>
                  <td class={styles.numCol}>{row.cumulative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Revealed hands -------------------------------------------- */}
        <div class={styles.handsSection}>
          <div class={styles.handsTitle}>Revealed hands</div>
          {rows.map((row) => {
            const hand = end.hands[row.player.id] ?? [];
            return (
              <div class={styles.handRow} key={row.player.id}>
                <div class={styles.handRowName}>{row.player.name}</div>
                <div class={styles.handRowCards}>
                  {hand.length === 0 ? (
                    <span class={styles.handRowEmpty}>(empty — winner)</span>
                  ) : (
                    hand.map((card) => (
                      <Card key={card.id} card={card} width={44} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* CTAs ------------------------------------------------------ */}
        <div class={styles.ctas}>
          {iAmHost ? (
            <button
              type="button"
              class={`primary ${styles.nextRoundBtn}`}
              onClick={actions.nextRound}
            >
              Next Round
            </button>
          ) : (
            <p class={styles.waitingMsg}>
              Waiting for host to start the next round…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
