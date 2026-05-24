import { WebSocketServer, WebSocket } from "ws";

/// Minimal live-fanout WebSocket server. The coordinator and indexer call
/// `broadcast` to push contest updates to every connected frontend client.

let wss: WebSocketServer | undefined;

export function startWs(port: number): WebSocketServer {
  wss = new WebSocketServer({ port });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello", service: "coordinator" }));
  });
  wss.on("listening", () => console.log(`ws fanout on ws://localhost:${port}`));
  return wss;
}

export function broadcast(message: unknown): void {
  if (!wss) return;
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}
