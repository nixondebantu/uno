// Square avatar card: lucide icon centered + name below + optional state ring.
//
// Used in the lobby player grid and (later) in the game's opponent row. The
// `ring` prop drives a colored border that signals turn-active or
// disconnected state; pass `null` for a plain card.

import type { JSX } from 'preact';
import { AvatarIcon } from '../avatars.js';

export type AvatarRing = 'active' | 'disconnected' | null;

export interface PlayerAvatarProps {
  name: string;
  avatar: string;
  size?: number;
  ring?: AvatarRing;
  subtitle?: string;
  /** Visual badges layered on the card (e.g. crown for host, eye for spectator). */
  badges?: JSX.Element[] | JSX.Element | null;
  /** Right-side action slot (e.g. promote / kick buttons in the lobby). */
  actions?: JSX.Element | null;
}

function ringClass(ring: AvatarRing): string {
  if (ring === 'active') return 'avatar--active';
  if (ring === 'disconnected') return 'avatar--disconnected';
  return '';
}

export function PlayerAvatar({
  name,
  avatar,
  size = 48,
  ring = null,
  subtitle,
  badges,
  actions,
}: PlayerAvatarProps): JSX.Element {
  const cls = `avatar ${ringClass(ring)}`.trim();
  return (
    <div class={cls} data-disconnected={ring === 'disconnected'}>
      <div class="avatar__icon">
        <AvatarIcon name={avatar} size={size} />
        {badges ? <div class="avatar__badges">{badges}</div> : null}
      </div>
      <div class="avatar__meta">
        <div class="avatar__name" title={name}>
          {name}
        </div>
        {subtitle ? <div class="avatar__subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div class="avatar__actions">{actions}</div> : null}
    </div>
  );
}
