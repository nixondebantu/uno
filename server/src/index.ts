import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { TurnController } from "./turnController.js";
import { SocketRegistry } from "./reconnect.js";
import {
  buildTurnEvents,
  defaultRoomsDeps,
  wireSockets,
} from "./sockets.js";
import { runGc } from "./roomManager.js";

// In dev (tsx) __filename points at server/src/index.ts.
// In prod (tsc build) it points at server/dist/index.js.
// Either way, the client dist lives at <repoRoot>/client/dist, which is
// two dirs up from this file (server/src or server/dist) then into client/dist.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveClientDist(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../client/dist"),
    path.resolve(__dirname, "../../../client/dist"),
    path.resolve(process.cwd(), "client/dist"),
    path.resolve(process.cwd(), "../client/dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const clientDist = resolveClientDist();
if (clientDist) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/socket.io")) return next();
    const indexFile = path.join(clientDist, "index.html");
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      next();
    }
  });
  console.log(`serving client static from ${clientDist}`);
} else {
  console.log("no client dist found — running in API-only mode");
}

// --- Real-time wiring ------------------------------------------------------

const registry = new SocketRegistry();
const rooms = defaultRoomsDeps();
const turnEvents = buildTurnEvents(io, rooms, registry);
const turn = new TurnController(turnEvents);

wireSockets(io, { rooms, turn, registry });

// Periodic GC — 30-min inactivity, 5-min all-disconnected grace.
const GC_INTERVAL_MS = 60 * 1000;
setInterval(() => {
  const destroyed = runGc(Date.now(), {
    inactivityMs: 30 * 60 * 1000,
    allDisconnectedGraceMs: 5 * 60 * 1000,
  });
  for (const code of destroyed) {
    turn.cleanup(code);
    io.in(code).disconnectSockets(true);
    console.log(`gc destroyed room ${code}`);
  }
}, GC_INTERVAL_MS).unref();

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, () => {
  console.log(`uno server listening on :${PORT}`);
});
