// Client boot. Wires socket transport into the store, picks an initial screen
// from the URL, and renders the App switch.
//
// Anything beyond the switch (full screens) is owned by other phase agents.

import { render } from 'preact';
import type { VNode } from 'preact';

import './styles/global.css';

import { ClientEvents, type JoinRoomPayload } from '@uno/shared';

import { connect, emit, onConnect, onConnectionChange } from './socket.js';
import { isConnected, screen, wireServerEvents } from './store.js';
import { routeRoomCode, current as currentRoute } from './router.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Game } from './screens/Game.js';
import { RoundEnd } from './screens/RoundEnd.js';
import { MatchEnd } from './screens/MatchEnd.js';
import { ToastStack } from './components/ToastStack.js';
import { ConnectionLostBanner } from './components/ConnectionLostBanner.js';

// ---------- Boot ----------

connect();
wireServerEvents();
onConnectionChange((connected) => {
  isConnected.value = connected;
});

// localStorage keys shared with the Home screen — written there on create/join.
const LAST_NAME_STORAGE_KEY = 'uno_last_name';
const LAST_AVATAR_STORAGE_KEY = 'uno_last_avatar';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function hasStoredCredentials(): boolean {
  const name = readStored(LAST_NAME_STORAGE_KEY);
  const avatar = readStored(LAST_AVATAR_STORAGE_KEY);
  return !!name && !!avatar;
}

/**
 * Re-issue a JOIN_ROOM when the URL points at a room AND we have stored
 * name/avatar. The socket wrapper auto-injects the stored playerToken, so the
 * server rebinds us to our existing seat (and replays game state mid-game).
 *
 * Fires on the initial connect and on every socket reconnect — this is what
 * makes a page refresh, a shared link, and a dropped connection all resolve
 * back into the room instead of getting stuck on a loading screen.
 */
function attemptAutoJoin(): void {
  const code = routeRoomCode();
  if (!code) return;
  const name = readStored(LAST_NAME_STORAGE_KEY);
  const avatar = readStored(LAST_AVATAR_STORAGE_KEY);
  if (!name || !avatar) return; // no creds yet — Home screen handles the join
  const payload: JoinRoomPayload = { roomCode: code, name, avatar };
  emit(ClientEvents.JOIN_ROOM, payload);
}

// Single source of (re)join: the socket `connect` event fires on first connect
// and after every reconnect. No duplicate emit at boot.
onConnect(() => {
  attemptAutoJoin();
});

// Initial screen derived from URL. When the URL targets a room and we have
// stored credentials, show the transient "joining" lobby until ROOM_JOINED
// drives the real screen; otherwise fall back to Home (so a fresh visitor on a
// shared link can enter a name + avatar — Home prefills the join panel).
function syncScreenFromUrl(): void {
  const code = routeRoomCode();
  if (code && hasStoredCredentials()) {
    screen.value = 'lobby';
  } else {
    screen.value = 'home';
  }
}
syncScreenFromUrl();

// Re-derive on browser nav.
currentRoute.subscribe(() => {
  // Only re-derive when we're in pre-game screens; once the server tells us a
  // game has started, store events drive `screen` directly.
  const s = screen.value;
  if (s === 'home' || s === 'lobby') {
    syncScreenFromUrl();
  }
});

// ---------- Components ----------

function ScreenSlot(): VNode {
  switch (screen.value) {
    case 'home':
      return <Home />;
    case 'lobby':
      return <Lobby />;
    case 'game':
      return <Game />;
    case 'round_end':
      return <RoundEnd />;
    case 'match_end':
      return <MatchEnd />;
    default:
      return <Home />;
  }
}

function App(): VNode {
  return (
    <>
      <ConnectionLostBanner />
      <ScreenSlot />
      <ToastStack />
    </>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
