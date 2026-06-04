// SpectatorBanner — replaces Hand + SelfStatus when the local viewer is in
// the spectator list. Renders the "you're spectating" notice plus a compact
// list of co-spectators.
//
// Read directly from the store so it stays in sync with promote/kick events.

import type { JSX } from 'preact';
import { Eye } from 'lucide-preact';

import { PlayerAvatar } from './PlayerAvatar.js';
import { myId, roomState } from '../store.js';

export function SpectatorBanner(): JSX.Element | null {
  const room = roomState.value;
  const me = myId.value;
  if (!room || !me) return null;

  const others = room.spectators.filter((s) => s.id !== me);

  return (
    <section class="spectator-banner" aria-label="Spectator status">
      <div class="spectator-banner__head">
        <Eye size={20} aria-hidden="true" />
        <h2 class="spectator-banner__title">You&rsquo;re spectating</h2>
      </div>
      <p class="spectator-banner__body">
        Waiting to be promoted to a player between rounds.
      </p>
      {others.length > 0 ? (
        <div class="spectator-banner__others">
          <div class="spectator-banner__others-label">
            Other spectators
          </div>
          <div class="spectator-banner__others-grid">
            {others.map((s) => (
              <PlayerAvatar
                key={s.id}
                name={s.name}
                avatar={s.avatar}
                size={36}
                ring={!s.isConnected ? 'disconnected' : null}
                subtitle={!s.isConnected ? 'Disconnected' : 'Spectator'}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
