// Lobby screen — room code, player grid, host settings, Start Game.
// Per PRD §10.2 and §7.1.3.

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  Copy,
  Crown,
  Eye,
  LogOut,
  UserPlus,
  X,
} from 'lucide-preact';
import {
  ClientEvents,
  DEFAULT_SETTINGS,
  MIN_PLAYERS,
  MAX_PLAYERS_HARD,
  type GameSettings,
  type PlayableColor,
  type PlayerPublic,
  type UpdateSettingsPayload,
} from '@uno/shared';

import styles from './Lobby.module.css';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { ColorChooser } from '../components/ColorChooser.js';
import { emit } from '../socket.js';
import {
  roomState,
  myId,
  awaitingStartingColor,
  pushToast,
} from '../store.js';

interface TimerOption {
  label: string;
  value: number | null;
}

const TIMER_OPTIONS: readonly TimerOption[] = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: 'Off', value: null },
];

const POINTS_OPTIONS: readonly number[] = [200, 500, 1000];

const SETTINGS_DEBOUNCE_MS = 250;

export function Lobby(): JSX.Element {
  const room = roomState.value;
  const me = myId.value;

  // Debounced settings emit — host can drag the slider without spamming.
  const pendingPatch = useRef<Partial<GameSettings>>({});
  const pendingTimer = useRef<number | null>(null);

  // Flush any pending change on unmount so we don't lose the host's last tweak.
  useEffect(() => {
    return () => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
        const patch = pendingPatch.current;
        if (Object.keys(patch).length > 0) {
          const payload: UpdateSettingsPayload = { settings: patch };
          emit(ClientEvents.UPDATE_SETTINGS, payload);
        }
      }
    };
  }, []);

  if (!room) {
    return (
      <main class={styles.root}>
        <p>Loading lobby…</p>
      </main>
    );
  }

  const settings: GameSettings = room.settings ?? DEFAULT_SETTINGS;
  const isHost = me === room.hostId;
  const players = room.players;
  const spectators = room.spectators;
  const canStart = isHost && players.length >= MIN_PLAYERS;

  const queueSettingsChange = (patch: Partial<GameSettings>): void => {
    if (!isHost) return;
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (pendingTimer.current !== null) {
      window.clearTimeout(pendingTimer.current);
    }
    pendingTimer.current = window.setTimeout(() => {
      const toSend = pendingPatch.current;
      pendingPatch.current = {};
      pendingTimer.current = null;
      if (Object.keys(toSend).length === 0) return;
      const payload: UpdateSettingsPayload = { settings: toSend };
      emit(ClientEvents.UPDATE_SETTINGS, payload);
    }, SETTINGS_DEBOUNCE_MS);
  };

  const copyShareLink = async (): Promise<void> => {
    const url = `${window.location.origin}/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      pushToast('success', 'Link copied');
    } catch {
      // Fallback: surface the URL in a toast so the user can long-press / copy.
      pushToast('info', url, 6000);
    }
  };

  const leaveRoom = (): void => {
    emit(ClientEvents.LEAVE_ROOM, {});
  };

  const startGame = (): void => {
    if (!canStart) return;
    emit(ClientEvents.START_GAME, {});
  };

  const promote = (playerId: string): void => {
    emit(ClientEvents.PROMOTE_SPECTATOR, { playerId });
  };

  const kick = (playerId: string): void => {
    emit(ClientEvents.KICK_SPECTATOR, { playerId });
  };

  const onPickStartingColor = (color: PlayableColor): void => {
    emit(ClientEvents.SET_STARTING_COLOR, { color });
    awaitingStartingColor.value = false;
  };

  const renderPlayer = (p: PlayerPublic): JSX.Element => {
    const ring = !p.isConnected ? 'disconnected' : null;
    const subtitle = !p.isConnected
      ? 'Disconnected'
      : p.score > 0
      ? `${p.score} pts`
      : undefined;
    return (
      <PlayerAvatar
        key={p.id}
        name={p.name}
        avatar={p.avatar}
        ring={ring}
        subtitle={subtitle}
        badges={
          p.isHost ? (
            <span title="Host" aria-label="Host">
              <Crown size={14} color="var(--uno-yellow)" />
            </span>
          ) : null
        }
      />
    );
  };

  const renderSpectator = (p: PlayerPublic): JSX.Element => {
    const ring = !p.isConnected ? 'disconnected' : null;
    return (
      <PlayerAvatar
        key={p.id}
        name={p.name}
        avatar={p.avatar}
        ring={ring}
        subtitle="Spectator"
        badges={
          <span title="Spectator" aria-label="Spectator">
            <Eye size={14} color="var(--color-text-muted)" />
          </span>
        }
        actions={
          isHost && room.status === 'waiting' ? (
            <>
              <button
                type="button"
                class={styles.iconButton}
                aria-label={`Promote ${p.name} to player`}
                onClick={() => promote(p.id)}
                title="Promote to player"
              >
                <UserPlus size={14} />
              </button>
              <button
                type="button"
                class={styles.iconButton}
                aria-label={`Kick ${p.name}`}
                onClick={() => kick(p.id)}
                title="Kick"
              >
                <X size={14} />
              </button>
            </>
          ) : null
        }
      />
    );
  };

  return (
    <main class={styles.root}>
      <header class={styles.header}>
        <div class={styles.codeBlock}>
          <span class={styles.codeLabel}>Room</span>
          <span class={styles.codeBig}>{room.code}</span>
        </div>
        <div class={styles.headerActions}>
          <button
            type="button"
            class={styles.iconButton}
            onClick={copyShareLink}
          >
            <Copy size={16} /> Copy link
          </button>
          <button
            type="button"
            class={styles.iconButton}
            onClick={leaveRoom}
          >
            <LogOut size={16} /> Leave
          </button>
        </div>
      </header>

      <div class={styles.body}>
        <section class={styles.section} aria-label="Players">
          <h2 class={styles.sectionTitle}>
            Players ({players.length}/{settings.maxPlayers})
          </h2>
          {players.length === 0 ? (
            <p>No players yet.</p>
          ) : (
            <div class={styles.playerGrid}>{players.map(renderPlayer)}</div>
          )}

          <h2
            class={styles.sectionTitle}
            style={{ marginTop: 'var(--space-5)' }}
          >
            Spectators{' '}
            <span class={styles.spectatorBadge}>
              <Eye size={12} /> {spectators.length}
            </span>
          </h2>
          {spectators.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>
              No spectators.
            </p>
          ) : (
            <div class={styles.playerGrid}>
              {spectators.map(renderSpectator)}
            </div>
          )}
        </section>

        <aside class={styles.section} aria-label="Game settings">
          <h2 class={styles.sectionTitle}>Settings</h2>
          <HostSettings
            settings={settings}
            isHost={isHost}
            onChange={queueSettingsChange}
          />
        </aside>
      </div>

      <footer class={styles.footer}>
        {isHost ? (
          <div>
            <button
              type="button"
              class={`primary ${styles.startBtn}`}
              disabled={!canStart}
              onClick={startGame}
              title={
                canStart ? undefined : `Need at least ${MIN_PLAYERS} players`
              }
            >
              Start Game
            </button>
            {!canStart ? (
              <div class={styles.tooltip}>
                Need at least {MIN_PLAYERS} players to start
              </div>
            ) : null}
          </div>
        ) : (
          <div class={styles.tooltip}>Waiting for host to start…</div>
        )}
      </footer>

      <ColorChooser
        open={awaitingStartingColor.value && isHost}
        onPick={onPickStartingColor}
        title="Pick the starting color"
      />
    </main>
  );
}

// ---------- Host settings panel ----------

interface HostSettingsProps {
  settings: GameSettings;
  isHost: boolean;
  onChange: (patch: Partial<GameSettings>) => void;
}

function HostSettings({
  settings,
  isHost,
  onChange,
}: HostSettingsProps): JSX.Element {
  const timerLabel = (() => {
    const t = TIMER_OPTIONS.find((o) => o.value === settings.turnTimerSeconds);
    return t ? t.label : `${settings.turnTimerSeconds ?? 'Off'}`;
  })();

  return (
    <div class={styles.settingsList}>
      <div class={styles.settingRow}>
        <span class={styles.settingLabel}>Turn timer</span>
        {isHost ? (
          <div class={styles.radioRow} role="radiogroup">
            {TIMER_OPTIONS.map((opt) => {
              const selected = settings.turnTimerSeconds === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  class={`${styles.radioOption} ${selected ? styles.radioOptionSelected : ''}`}
                  onClick={() =>
                    onChange({ turnTimerSeconds: opt.value })
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span class={styles.readonlyValue}>{timerLabel}</span>
        )}
      </div>

      <div class={styles.settingRow}>
        <span class={styles.settingLabel}>Points to win</span>
        {isHost ? (
          <div class={styles.radioRow} role="radiogroup">
            {POINTS_OPTIONS.map((pts) => {
              const selected = settings.pointsToWin === pts;
              return (
                <button
                  key={pts}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  class={`${styles.radioOption} ${selected ? styles.radioOptionSelected : ''}`}
                  onClick={() => onChange({ pointsToWin: pts })}
                >
                  {pts}
                </button>
              );
            })}
          </div>
        ) : (
          <span class={styles.readonlyValue}>{settings.pointsToWin}</span>
        )}
      </div>

      <div class={styles.settingRow}>
        <span class={styles.settingLabel}>
          Max players ({settings.maxPlayers})
        </span>
        {isHost ? (
          <div class={styles.sliderRow}>
            <input
              type="range"
              min={MIN_PLAYERS}
              max={MAX_PLAYERS_HARD}
              step={1}
              value={settings.maxPlayers}
              onInput={(e) =>
                onChange({
                  maxPlayers: Number(
                    (e.currentTarget as HTMLInputElement).value,
                  ),
                })
              }
              aria-label="Max players"
            />
            <span class={styles.sliderValue}>{settings.maxPlayers}</span>
          </div>
        ) : (
          <span class={styles.readonlyValue}>{settings.maxPlayers}</span>
        )}
      </div>

      <div class={styles.settingRow}>
        <span class={styles.settingLabel}>Wild Draw 4 challenge</span>
        {isHost ? (
          <div class={styles.toggleRow}>
            <input
              type="checkbox"
              class={styles.toggle}
              checked={settings.w4ChallengeEnabled}
              onChange={(e) =>
                onChange({
                  w4ChallengeEnabled: (e.currentTarget as HTMLInputElement)
                    .checked,
                })
              }
              aria-label="Enable Wild Draw 4 challenge"
            />
            <span class={styles.readonlyValue}>
              {settings.w4ChallengeEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ) : (
          <span class={styles.readonlyValue}>
            {settings.w4ChallengeEnabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>
    </div>
  );
}
