// Singleton typed socket.io-client wrapper.
//
// All `emit`s and `on`s flow through this module so we get end-to-end payload
// typing from the shared package. Also handles `playerToken` persistence and
// automatic injection into JOIN_ROOM payloads.

import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  type ClientEventName,
  type ClientPayloadFor,
  type ServerEventName,
  type ServerPayloadFor,
} from '@uno/shared';

const TOKEN_STORAGE_KEY = 'uno_player_token';

let socket: Socket | null = null;
let cachedToken: string | null = readTokenFromStorage();

function readTokenFromStorage(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getPlayerToken(): string | null {
  return cachedToken;
}

export function setPlayerToken(token: string): void {
  cachedToken = token;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode, etc.) — in-memory cache still works
    // for the current session.
  }
}

export function clearPlayerToken(): void {
  cachedToken = null;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Lazy-init the socket. In dev we hit the Vite proxy (which forwards
 * `/socket.io` → :3000); in prod the SPA is served by the same Express that
 * hosts Socket.io, so same-origin works without a URL.
 */
export function connect(): Socket {
  if (socket) return socket;
  const isDev = import.meta.env.DEV;
  socket = isDev
    ? io({
        transports: ['websocket', 'polling'],
      })
    : io({
        transports: ['websocket', 'polling'],
      });
  return socket;
}

export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Typed `on` wrapper. Returns an unsubscribe fn so callers don't have to
 * remember to pair it with `off`.
 */
// socket.io's listener union pulls in reserved-event conditional types that
// fight generic widening; we localize the interop here behind an unknown cast
// and keep the public signature strict.
interface UntypedSocket {
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
  emit(event: string, payload: unknown): void;
}

function untyped(s: Socket): UntypedSocket {
  return s as unknown as UntypedSocket;
}

export function on<E extends ServerEventName>(
  event: E,
  handler: (payload: ServerPayloadFor<E>) => void,
): () => void {
  const s = untyped(connect());
  const wrapped = (payload: unknown): void =>
    handler(payload as ServerPayloadFor<E>);
  s.on(event, wrapped);
  return () => {
    s.off(event, wrapped);
  };
}

/**
 * Typed `emit` wrapper. Auto-injects `playerToken` into JOIN_ROOM payloads
 * when one is stored — callers don't need to thread it through.
 */
export function emit<E extends ClientEventName>(
  event: E,
  payload: ClientPayloadFor<E>,
): void {
  const s = untyped(connect());
  let outgoing: ClientPayloadFor<E> = payload;
  if (event === ClientEvents.JOIN_ROOM && cachedToken) {
    // Spread is safe — JoinRoomPayload always object-shaped.
    outgoing = {
      ...(payload as object),
      playerToken: cachedToken,
    } as ClientPayloadFor<E>;
  }
  s.emit(event, outgoing);
}

/**
 * Subscribe to raw socket lifecycle events. Returned unsubscribe fn removes
 * both handlers in one call so call sites stay tidy.
 */
export function onConnectionChange(
  handler: (connected: boolean) => void,
): () => void {
  const s = connect();
  const onConnect = (): void => handler(true);
  const onDisconnect = (): void => handler(false);
  s.on('connect', onConnect);
  s.on('disconnect', onDisconnect);
  return () => {
    s.off('connect', onConnect);
    s.off('disconnect', onDisconnect);
  };
}
