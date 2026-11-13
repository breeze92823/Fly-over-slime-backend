import { matchMaker } from "colyseus";

// Boxity cross-pod room directory: pushes this pod's live rooms to the matchmaker every ~2 s so the
// game page's "Open Rooms" list, the ESC menu's server list, friend joins and join-by-id work across
// pods. A no-op unless deployed by Boxity hosting (BLOXITY_REPORT_TOKEN, MATCHMAKER_REPORT_URL and
// BLOXITY_GAME_ID are injected there), so it is safe locally. Call installRoomReporter() after listen().
//
// `started` must stay false for a room people can still join: the directory treats a started room as in
// progress and lists it as LOCKED (not joinable, hidden from the lists). This game has no rounds, so a
// room is never started unless its metadata says so.

export function installRoomReporter(): void {
  const token = process.env.BLOXITY_REPORT_TOKEN;
  const base = process.env.MATCHMAKER_REPORT_URL;
  const gameId = process.env.BLOXITY_GAME_ID;
  if (!token || !base || !gameId) return;
  const url = `${base.replace(/\/$/, "")}/${gameId}/rooms`;
  const podName = process.env.POD_NAME || process.env.HOSTNAME || "local";

  async function tick(): Promise<void> {
    try {
      const listings = await matchMaker.query({});
      const rooms = listings.map((listing) => {
        const metadata = (listing.metadata || {}) as Record<string, unknown>;
        return {
          colyseusRoomId: listing.roomId,
          name: listing.name || undefined,
          clients: listing.clients ?? 0,
          maxClients: listing.maxClients ?? 0,
          locked: !!listing.locked,
          private: !!listing.private,
          started: !!metadata.started,
          metadata: listing.metadata || undefined,
        };
      });
      await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ podName, players: rooms.reduce((n, r) => n + r.clients, 0), rooms }),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      // The next tick retries; a missed report only delays the room directory.
    }
  }
  setInterval(() => void tick(), 2000).unref();
  void tick();
}
