import { matchMaker } from "colyseus";

// Tells the Bloxity matchmaker which rooms live on this pod (every 2 s), so friends' "Join" and
// "Play with friends" invites and the game page's Open Rooms list can find them across pods.
// A no-op unless deployed by Bloxity hosting (BLOXITY_REPORT_TOKEN, MATCHMAKER_REPORT_URL and
// BLOXITY_GAME_ID are injected there). Call installRoomReporter() after listen().

export function installRoomReporter(): void {
  const token = process.env.BLOXITY_REPORT_TOKEN;
  const base = process.env.MATCHMAKER_REPORT_URL;
  const gameId = process.env.BLOXITY_GAME_ID;
  if (!token || !base || !gameId) return;
  const url = `${base.replace(/\/$/, "")}/${gameId}/rooms`;
  const podName = process.env.POD_NAME || "local";

  async function tick() {
    try {
      const rooms = await matchMaker.query({ name: "world" });
      await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          podName,
          players: rooms.reduce((n, r) => n + r.clients, 0),
          rooms: rooms.map((r) => ({
            colyseusRoomId: r.roomId,
            clients: r.clients,
            maxClients: r.maxClients,
            locked: !!r.locked,
            private: !!r.private,
            started: true,
            metadata: r.metadata ?? {},
          })),
        }),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // The next tick retries; a missed report only delays the room directory.
    }
  }
  setInterval(() => void tick(), 2000).unref();
}
