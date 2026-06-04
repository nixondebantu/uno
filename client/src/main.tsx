import { render } from "preact";
import { signal } from "@preact/signals";
import { io, type Socket } from "socket.io-client";

// In dev (Vite on :5173), connect to server on :3000.
// In prod (Express serves the SPA), use same-origin.
const isDev = import.meta.env.DEV;
const SERVER_URL = isDev ? "http://localhost:3000" : window.location.origin;

const status = signal<string>("connecting...");
const pongPayload = signal<unknown>(null);

const socket: Socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
});

socket.on("connect", () => {
  status.value = `connected (${socket.id})`;
  socket.emit("ping_test", { clientTime: Date.now(), hello: "uno" });
});

socket.on("disconnect", (reason) => {
  status.value = `disconnected: ${reason}`;
});

socket.on("pong_test", (payload: unknown) => {
  pongPayload.value = payload;
});

function App() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "24px",
        maxWidth: "640px",
        margin: "0 auto",
      }}
    >
      <h1>UNO — P0 skeleton</h1>
      <p>
        <strong>Socket:</strong> {status.value}
      </p>
      <p>
        <strong>pong_test:</strong>
      </p>
      <pre
        style={{
          background: "#f4f4f5",
          padding: "12px",
          borderRadius: "8px",
          overflow: "auto",
        }}
      >
        {pongPayload.value
          ? JSON.stringify(pongPayload.value, null, 2)
          : "(awaiting reply)"}
      </pre>
    </main>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
