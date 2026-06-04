import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// In dev (tsx) __filename points at server/src/index.ts.
// In prod (tsc build) it points at server/dist/index.js.
// Either way, the client dist lives at <repoRoot>/client/dist, which is
// two dirs up from this file (server/src or server/dist) then into client/dist.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Candidate locations for the built client. We try in order:
// 1. <thisFile>/../../client/dist           (dev: server/src/.. -> server -> uno -> client/dist; same for server/dist)
// 2. <thisFile>/../../../client/dist        (Docker runtime layout where server/dist is nested differently)
// 3. <cwd>/client/dist                      (workspace root fallback)
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
  // SPA fallback: serve index.html for any non-API/non-socket GET that isn't a static asset.
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

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);

  socket.on("ping_test", (payload: unknown) => {
    socket.emit("pong_test", {
      echo: payload,
      serverTime: Date.now(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`socket disconnected: ${socket.id} (${reason})`);
  });
});

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, () => {
  console.log(`uno server listening on :${PORT}`);
});
