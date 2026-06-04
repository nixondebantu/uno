// MatchEnd screen — full-screen takeover shown when a player crosses the
// points-to-win threshold (PRD §10.6). Confetti is pure CSS (no JS lib).

import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { Award, Medal, Trophy } from 'lucide-preact';
import type { PlayerPublic } from '@uno/shared';

import styles from './MatchEnd.module.css';
import { AvatarIcon } from '../avatars.js';
import {
  matchEndState,
  myId,
  roomState,
} from '../store.js';
import { useGameActions } from '../useGameActions.js';

// ---------- Confetti helpers ----------

const CONFETTI_COUNT = 60;
const CONFETTI_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#fbc02d'];

interface ConfettiPiece {
  left: string;
  delay: string;
  duration: string;
  color: string;
  size: number;
}

// Deterministic-ish pseudo-random so SSR/dev hot-reload doesn't reshuffle
// every render. Seeded on a constant — confetti looks the same each mount
// of the same component, which is fine for a celebratory effect.
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 9301 + salt * 49297) * 233280;
  return x - Math.floor(x);
}

function buildConfetti(): ConfettiPiece[] {
  const out: ConfettiPiece[] = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const leftPct = rand(i, 1) * 100;
    const delaySec = rand(i, 2) * 4; // 0–4s stagger
    const durationSec = 4 + rand(i, 3) * 4; // 4–8s fall
    const color =
      CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? CONFETTI_COLORS[0];
    const size = 8 + Math.floor(rand(i, 4) * 8); // 8–16px
    out.push({
      left: `${leftPct.toFixed(2)}%`,
      delay: `${delaySec.toFixed(2)}s`,
      duration: `${durationSec.toFixed(2)}s`,
      color: color ?? '#fff',
      size,
    });
  }
  return out;
}

// ---------- Score row helper ----------

interface MatchScoreRow {
  player: PlayerPublic;
  score: number;
  rank: number;
}

function buildRows(
  players: readonly PlayerPublic[],
  finalScores: Record<string, number>,
): MatchScoreRow[] {
  const withScores = players
    .map((p) => ({ player: p, score: finalScores[p.id] ?? p.score }))
    .sort((a, b) => b.score - a.score);
  return withScores.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

function PodiumIcon({ rank }: { rank: number }): JSX.Element {
  if (rank === 1) {
    return (
      <Trophy
        size={22}
        class={`${styles.rankIcon} ${styles.rankIconGold}`}
        aria-label="1st place"
      />
    );
  }
  if (rank === 2) {
    return (
      <Medal
        size={22}
        class={`${styles.rankIcon} ${styles.rankIconSilver}`}
        aria-label="2nd place"
      />
    );
  }
  if (rank === 3) {
    return (
      <Award
        size={22}
        class={`${styles.rankIcon} ${styles.rankIconBronze}`}
        aria-label="3rd place"
      />
    );
  }
  return <span class={styles.rankNum}>{rank}</span>;
}

// ---------- Component ----------

export function MatchEnd(): JSX.Element {
  const end = matchEndState.value;
  const room = roomState.value;
  const me = myId.value;
  const actions = useGameActions();

  const confetti = useMemo(buildConfetti, []);

  const rows: MatchScoreRow[] = useMemo(() => {
    if (!end || !room) return [];
    return buildRows(room.players, end.finalScores);
  }, [end, room]);

  if (!end || !room) {
    return (
      <div class={styles.root} role="dialog" aria-modal="true">
        <div class={styles.card}>
          <p>Wrapping up…</p>
        </div>
      </div>
    );
  }

  const winner = room.players.find((p) => p.id === end.winnerId);
  const host = room.players.find((p) => p.isHost);
  const iAmHost = host?.id === me;

  return (
    <div
      class={styles.root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-end-title"
    >
      {/* Confetti — purely decorative; aria-hidden so it stays out of AT. */}
      <div class={styles.confettiLayer} aria-hidden="true">
        {confetti.map((piece, i) => (
          <span
            key={i}
            class={styles.confettiPiece}
            style={{
              left: piece.left,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              backgroundColor: piece.color,
              width: `${piece.size}px`,
              height: `${Math.round(piece.size * 1.4)}px`,
            }}
          />
        ))}
      </div>

      <div class={styles.card}>
        {/* Banner --------------------------------------------------- */}
        <div class={styles.banner}>
          <div class={styles.bannerLabel}>Match Complete</div>
          {winner ? (
            <>
              <h1 id="match-end-title" class={styles.bannerWinner}>
                {winner.name}
              </h1>
              <div class={styles.bannerSub}>wins the match!</div>
            </>
          ) : (
            <h1 id="match-end-title" class={styles.bannerSub}>
              Match ended
            </h1>
          )}
        </div>

        {/* Final scores --------------------------------------------- */}
        <div class={styles.tableWrap}>
          <table class={styles.table}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th class={styles.scoreCol}>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.player.id}>
                  <td>
                    <div class={styles.rankCell}>
                      <PodiumIcon rank={row.rank} />
                    </div>
                  </td>
                  <td>
                    <div class={styles.rankCell}>
                      <div class={styles.rankAvatar}>
                        <AvatarIcon name={row.player.avatar} size={20} />
                      </div>
                      <span>{row.player.name}</span>
                    </div>
                  </td>
                  <td class={styles.scoreCol}>{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* CTAs ----------------------------------------------------- */}
        <div class={styles.ctas}>
          {iAmHost ? (
            <button
              type="button"
              class={`primary ${styles.playAgainBtn}`}
              onClick={actions.playAgain}
            >
              Play Again
            </button>
          ) : (
            <p class={styles.waitingMsg}>
              Waiting for host to start a new match…
            </p>
          )}
          <button
            type="button"
            class={styles.leaveBtn}
            onClick={actions.leaveRoom}
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
