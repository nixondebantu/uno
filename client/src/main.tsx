// Client boot. Wires socket transport into the store, picks an initial screen
// from the URL, and renders the App switch.
//
// Anything beyond the switch (full screens) is owned by other phase agents.

import { render } from 'preact';
import type { VNode } from 'preact';

import './styles/global.css';

import { connect, onConnectionChange } from './socket.js';
import { isConnected, screen, wireServerEvents } from './store.js';
import { routeRoomCode, current as currentRoute } from './router.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Game } from './screens/Game.js';
import { ToastStack } from './components/ToastStack.js';

// ---------- Boot ----------

connect();
wireServerEvents();
onConnectionChange((connected) => {
  isConnected.value = connected;
});

// Initial screen derived from URL. The auto-join handshake itself (emit
// JOIN_ROOM with stored name) is owned by the Home/Lobby screens (P3b) —
// here we only set the entry screen so the right component mounts.
function syncScreenFromUrl(): void {
  const code = routeRoomCode();
  if (code) {
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

function EndScreenPlaceholder({ label }: { label: string }): VNode {
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
      }}
    >
      <div>
        <h1 style={{ marginBottom: '12px' }}>{label}</h1>
        <p>This screen ships in phase P5.</p>
      </div>
    </main>
  );
}

function ScreenSlot(): VNode {
  switch (screen.value) {
    case 'home':
      return <Home />;
    case 'lobby':
      return <Lobby />;
    case 'game':
      return <Game />;
    case 'round_end':
      return <EndScreenPlaceholder label="Round End" />;
    case 'match_end':
      return <EndScreenPlaceholder label="Match End" />;
    default:
      return <Home />;
  }
}

function App(): VNode {
  return (
    <>
      <ScreenSlot />
      <ToastStack />
    </>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
