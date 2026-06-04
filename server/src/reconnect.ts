// Player-token reconnect registry.
//
// Maintains a bidirectional mapping between opaque playerTokens (UUIDs) and
// live Socket.io socket ids. Tokens persist across reconnects; socket ids do
// not. The registry is process-local — when the server restarts, all rooms
// die anyway (no persistence per PRD §5.1).
//
// References: plan/BUILD_PLAN.md §P2c, PRD §7.5.

import { randomUUID } from 'node:crypto';

/** Mint a fresh opaque player token. */
export function issueToken(): string {
  return randomUUID();
}

export class SocketRegistry {
  private readonly tokenToSocket = new Map<string, string>();
  private readonly socketToToken = new Map<string, string>();

  /**
   * Bind a (playerToken, socketId) pair. If the token was previously bound to
   * a different socket, the old socket's reverse mapping is cleared (it has
   * been replaced by the reconnecting one). Same for the socketId in the
   * reverse direction.
   */
  bind(token: string, socketId: string): void {
    const oldSocket = this.tokenToSocket.get(token);
    if (oldSocket && oldSocket !== socketId) {
      this.socketToToken.delete(oldSocket);
    }
    const oldToken = this.socketToToken.get(socketId);
    if (oldToken && oldToken !== token) {
      this.tokenToSocket.delete(oldToken);
    }
    this.tokenToSocket.set(token, socketId);
    this.socketToToken.set(socketId, token);
  }

  /**
   * Drop the binding for a socket id (called on disconnect). Returns the
   * token that was bound to that socket, or null if none.
   */
  unbind(socketId: string): string | null {
    const token = this.socketToToken.get(socketId) ?? null;
    if (token !== null) {
      // Only clear the forward binding when it still points at this socket.
      if (this.tokenToSocket.get(token) === socketId) {
        this.tokenToSocket.delete(token);
      }
      this.socketToToken.delete(socketId);
    }
    return token;
  }

  socketFor(token: string): string | null {
    return this.tokenToSocket.get(token) ?? null;
  }

  tokenFor(socketId: string): string | null {
    return this.socketToToken.get(socketId) ?? null;
  }
}
