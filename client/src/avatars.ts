// 24 lucide icons usable as player avatars. Order is the source-of-truth grid
// order for Home; the icon *name* is the canonical id we ship over the wire.

import { h, type VNode } from 'preact';
import {
  Apple,
  Banana,
  Bird,
  Carrot,
  Cat,
  Cherry,
  Cloud,
  Crown,
  Dog,
  Fish,
  Flame,
  Ghost,
  IceCreamCone,
  Leaf,
  Moon,
  Mountain,
  Pizza,
  Plane,
  Rocket,
  Sailboat,
  Snowflake,
  Star,
  Sun,
  TrainFront,
  type LucideIcon,
} from 'lucide-preact';

export const AVATAR_ICONS = {
  Cat,
  Dog,
  Bird,
  Fish,
  Apple,
  Banana,
  Cherry,
  Carrot,
  IceCreamCone,
  Pizza,
  Rocket,
  Plane,
  TrainFront,
  Sailboat,
  Sun,
  Moon,
  Star,
  Cloud,
  Snowflake,
  Flame,
  Leaf,
  Mountain,
  Ghost,
  Crown,
} as const satisfies Record<string, LucideIcon>;

export type AvatarName = keyof typeof AVATAR_ICONS;

// Ordered list — UI components iterate this for stable grid layout.
export const AVATARS: readonly AvatarName[] = Object.freeze(
  Object.keys(AVATAR_ICONS) as AvatarName[],
);

export function isAvatarName(name: string): name is AvatarName {
  return name in AVATAR_ICONS;
}

export interface AvatarIconProps {
  name: string;
  size?: number;
  color?: string;
}

/**
 * Renders an avatar by name. Unknown names fall back to the first avatar so
 * stale localStorage entries can't crash the UI.
 */
export function AvatarIcon({
  name,
  size = 32,
  color,
}: AvatarIconProps): VNode {
  const key: AvatarName = isAvatarName(name) ? name : AVATARS[0];
  const Icon = AVATAR_ICONS[key];
  return h(Icon, { size, color });
}
