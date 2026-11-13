import { Room, Client, CloseCode } from "colyseus";
import type { Filter } from "mongodb";
import { WorldState, PlayerState } from "./schema/WorldState.js";
import { GUEST_ID_PREFIX, LB_REPORT_EVERY_MS, STATS_REPORT_EVERY_MS, LEADERBOARD_EVERY_MS, NAME_MAX, PFP_MAX_LEN, RECONNECT_SECONDS, ROOM_MAX_CLIENTS } from "../constants.js";
import { getPlayers, type PlayerDoc } from "../db.js";
import { sanitizeProgress } from "../sanitize.js";
import { applyAvatar, applyEmote, applyLoadout, applyPose } from "../presence.js";
import { canVerify, reportScores, reportStats, scoresFromDoc, statsFromDoc, verifyToken, type Scores, type StatValues } from "../bloxity.js";
import { ranksOf, topBoards } from "../leaderboard.js";
import { inviteView, isUserId, readInvite, rememberSent, type InviteState } from "../invite.js";

function sanitizeName(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, NAME_MAX) : "";
}

function sanitizePfp(raw: unknown): string {
  return typeof raw === "string" && raw.length <= PFP_MAX_LEN && /^https?:\/\//i.test(raw) ? raw : "";
}

/**
 * Room every client joins via `client.joinOrCreate("world", { userId, username })`. Loads and
 * saves each signed-in player's progress (MongoDB, see db.ts) and relays every player's presence
 * (pose, animation state, gear, Bloxity look) so the others can draw them. The game is
 * client-authoritative: no gameplay rules live here, saves are only bounded (sanitize.ts). Full
 * rooms spill into a fresh one automatically (maxClients).
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  state = new WorldState();
  maxClients = ROOM_MAX_CLIENTS;

  // sessionId -> user id (Bloxity id). Deliberately NOT part of WorldState: it only gates this
  // room's own Mongo reads/writes. Guests have no entry.
  userIds = new Map<string, string>();

  // sessionIds that already got a progress/noProgress answer for their current identity.
  private identified = new Set<string>();
  // sessionIds whose current identity's save has been read: only these may write. A save sent
  // before the load answered would overwrite the stored progress with a fresh player's defaults.
  private loaded = new Set<string>();
  // sessionId -> the saved board stats (level, bestSkill, wins, bestDistance, rebirths) of a signed-in
  // player, for the Bloxity hosted leaderboards; and per account the scores last reported.
  private scoreDocs = new Map<string, Partial<PlayerDoc>>();
  private reported = new Map<string, string>();
  private statsReported = new Map<string, string>(); // account -> the stat values last reported
  // sessionId -> invite state (invite.ts), read with a signed-in player's save; and the inviter's
  // account id from the join options (`ref`: the invite link's tag).
  private inviteStates = new Map<string, InviteState>();
  private refs = new Map<string, string>();

  messages = {
    // Debounced push of the client's whole progress. Upserts, so a first save creates the document.
    saveProgress: async (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const patch = sanitizeProgress(msg);
      if (!p || !patch || !this.loaded.has(client.sessionId)) return;

      const userId = this.userIds.get(client.sessionId);
      if (!userId) return;
      const players = getPlayers();
      if (!players) return; // Mongo unset/unreachable -- degrade silently
      // The personal bests only ever go up ($max), so a stale or replayed save can't lower them.
      const { bestDistance, bestSkill, ...rest } = patch;
      const max: Record<string, number> = {};
      if (bestDistance !== undefined) max.bestDistance = bestDistance;
      if (bestSkill !== undefined) max.bestSkill = bestSkill;
      try {
        await players.updateOne(
          { _id: userId },
          {
            // Display name comes from this connection's own PlayerState, not `msg`.
            $set: { ...rest, username: p.username || "Player", updatedAt: new Date() },
            ...(Object.keys(max).length > 0 && { $max: max }),
            $setOnInsert: { version: 1 },
          },
          { upsert: true },
        );
      } catch (err) {
        console.warn("[WorldRoom] saveProgress failed", err);
        return;
      }
      this.rememberScores(client.sessionId, patch);
    },
    // Presence (presence.ts): the sender's pose ~10x/s, its equipped gear and its Bloxity look,
    // relayed through the roster so everyone draws them in the world (client remotePlayers.js).
    pose: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyPose(p, msg);
    },
    loadout: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyLoadout(p, msg);
    },
    // Invites (invite.ts; they earn the client's Friend Boost). `invited` { friendId }: the client sent a
    // direct Bloxity invite; remembered so that friend counts when they join. `inviteRefresh` re-reads
    // the friends-joined count (credited in another room / pod). Both answer `invite`.
    invited: async (client: Client, msg: { friendId?: unknown }) => {
      const st = this.inviteStates.get(client.sessionId);
      const friendId = msg?.friendId;
      if (!st || !isUserId(friendId) || friendId === this.userIds.get(client.sessionId)) return;
      if (rememberSent(st, friendId)) await this.saveInvite(client.sessionId, { invitesSent: [...st.sent] });
      if (this.inviteStates.get(client.sessionId) === st) client.send("invite", inviteView(st));
    },
    inviteRefresh: async (client: Client) => {
      const st = this.inviteStates.get(client.sessionId);
      const userId = this.userIds.get(client.sessionId);
      const players = getPlayers();
      if (!st) return client.send("invite", { ...inviteView(readInvite(null)), guest: !userId });
      if (userId && players) {
        try {
          st.joined = readInvite(await players.findOne({ _id: userId })).joined;
        } catch (err) {
          console.warn("[WorldRoom] inviteRefresh failed", err);
        }
      }
      if (this.inviteStates.get(client.sessionId) === st) client.send("invite", inviteView(st));
    },
    // The Bloxity emote the sender started from the portal's emote wheel ({ id }, "" = stopped).
    emote: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyEmote(p, msg);
    },
    setAvatar: (client: Client, msg: unknown) => {
      const p = this.state.players.get(client.sessionId);
      if (p) applyAvatar(p, msg);
    },
    // Re-states identity after a login/logout that happens AFTER join (a guest who signs in
    // mid-session). The server answers with progress/noProgress for the new identity.
    identify: (client: Client, msg: { username?: string; userId?: string; pfp?: string; token?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof msg?.username === "string") p.username = sanitizeName(msg.username);
      if (typeof msg?.pfp === "string") p.pfp = sanitizePfp(msg.pfp);
      // A name / picture-only identify keeps the current account; a token or id re-checks it.
      if (typeof msg?.token === "string" || typeof msg?.userId === "string") void this.identifyFrom(client, p, msg);
    },
  };

  // Leaderboards (leaderboard.ts): everyone gets the top lists + their own ranks every
  // LEADERBOARD_EVERY_MS, and once right after their save loads.
  onCreate() {
    this.clock.setInterval(() => {
      for (const c of this.clients) void this.sendLeaderboard(c);
    }, LEADERBOARD_EVERY_MS);
    // Bloxity hosted leaderboards: report the signed-in players' scores (read from their saved
    // stats) every LB_REPORT_EVERY_MS, only the ones that changed.
    this.clock.setInterval((): void => void this.reportBoards(), LB_REPORT_EVERY_MS);
    // Bloxity game stats (profile + missions): the same saved values, every STATS_REPORT_EVERY_MS.
    this.clock.setInterval((): void => void this.reportStatsFor(), STATS_REPORT_EVERY_MS);
  }

  async onDispose() {
    await Promise.all([this.reportBoards(), this.reportStatsFor()]);
  }

  // Keeps a session's board stats current from a sanitized save (the personal bests only go up).
  private rememberScores(sessionId: string, patch: Partial<PlayerDoc>) {
    const old = this.scoreDocs.get(sessionId) ?? {};
    this.scoreDocs.set(sessionId, {
      ...old,
      ...patch,
      bestSkill: Math.max(old.bestSkill ?? 0, patch.bestSkill ?? 0),
      bestDistance: Math.max(old.bestDistance ?? 0, patch.bestDistance ?? 0),
    });
  }

  // Reports the given sessions' (default: everyone's) changed scores to Bloxity.
  private async reportBoards(sessionIds?: string[]) {
    const rows: { userId: string; scores: Scores }[] = [];
    for (const sid of sessionIds ?? [...this.scoreDocs.keys()]) {
      const userId = this.userIds.get(sid);
      const doc = this.scoreDocs.get(sid);
      if (!userId || !doc) continue;
      const scores = scoresFromDoc(doc);
      const key = JSON.stringify(scores);
      if (this.reported.get(userId) === key) continue;
      this.reported.set(userId, key);
      rows.push({ userId, scores });
    }
    if (rows.length) await reportScores(rows);
  }

  // Reports the given sessions' (default: everyone's) changed stat values to Bloxity.
  private async reportStatsFor(sessionIds?: string[]) {
    const rows: { userId: string; values: StatValues }[] = [];
    for (const sid of sessionIds ?? [...this.scoreDocs.keys()]) {
      const userId = this.userIds.get(sid);
      const doc = this.scoreDocs.get(sid);
      if (!userId || !doc) continue;
      const values = statsFromDoc(doc);
      const key = JSON.stringify(values);
      if (this.statsReported.get(userId) === key) continue;
      this.statsReported.set(userId, key);
      rows.push({ userId, values });
    }
    if (rows.length) await reportStats(rows);
  }

  // The account behind a join / identify. Deployed (BLOXITY_API_URL set) only a verified Bloxity
  // game token counts, and a client-sent userId is ignored (Bloxity rule); a failed check plays as a
  // guest. Locally there is nothing to verify against, so the client's id is used (dev only).
  private async identifyFrom(client: Client, p: PlayerState, opts: { userId?: unknown; token?: unknown; username?: unknown; pfp?: unknown } | undefined) {
    if (!canVerify()) return this.setUserId(client, p, typeof opts?.userId === "string" ? opts.userId : "");
    const user = await verifyToken(opts?.token);
    if (this.state.players.get(client.sessionId) !== p) return; // left meanwhile
    if (user) {
      if (user.username) p.username = sanitizeName(user.username);
      if (user.pfp && !p.pfp) p.pfp = sanitizePfp(user.pfp);
    }
    this.setUserId(client, p, user?.id ?? "");
  }

  // `leaderboard` { boards: { bestSkill|playTime|level|wins: [{ name, value }] }, ranks: { stat: n | null } }.
  private async sendLeaderboard(client: Client) {
    const userId = this.userIds.get(client.sessionId) ?? "";
    const [boards, ranks] = await Promise.all([topBoards(), ranksOf(userId)]);
    if (!this.state.players.has(client.sessionId)) return;
    try {
      client.send("leaderboard", { boards, ranks });
    } catch {
      // Gone meanwhile.
    }
  }

  onJoin(client: Client, options?: { username?: string; userId?: string; token?: string; ref?: string; pfp?: string; pose?: unknown; loadout?: unknown; avatar?: string }) {
    const p = new PlayerState();
    p.username = sanitizeName(options?.username);
    p.pfp = sanitizePfp(options?.pfp);
    // Presence from the join options, so the others draw the newcomer right away.
    applyPose(p, options?.pose);
    applyLoadout(p, options?.loadout);
    applyAvatar(p, options);
    const ref = options?.ref;
    if (isUserId(ref)) this.refs.set(client.sessionId, ref);
    this.state.players.set(client.sessionId, p);
    // Locally this answers at once; deployed it waits for the Bloxity token check.
    void this.identifyFrom(client, p, options);
  }

  // A deliberate `room.leave()` closes with CONSENTED -- drop the player at once. Anything
  // else (WiFi blip, backgrounded tab) gets RECONNECT_SECONDS to reconnect with the same session.
  async onLeave(client: Client, code?: number) {
    if (code === CloseCode.CONSENTED) {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      void this.stampLastSeen(client.sessionId);
      this.forgetSession(client.sessionId);
    }
  }

  // Server-clock "last seen" for a player who has really gone. Call before forgetSession.
  private async stampLastSeen(sessionId: string) {
    const userId = this.userIds.get(sessionId);
    const players = getPlayers();
    if (!userId || !players) return;
    try {
      await players.updateOne({ _id: userId }, { $set: { lastSeen: Date.now() } });
    } catch (err) {
      console.warn("[WorldRoom] stampLastSeen failed", err);
    }
  }

  // Drops a session's per-connection bookkeeping.
  private forgetSession(sessionId: string) {
    void this.reportBoards([sessionId]); // the player's final scores (reads its maps before they are cleared)
    void this.reportStatsFor([sessionId]);
    this.scoreDocs.delete(sessionId);
    this.inviteStates.delete(sessionId);
    this.refs.delete(sessionId);
    this.state.players.delete(sessionId);
    this.userIds.delete(sessionId);
    this.identified.delete(sessionId);
    this.loaded.delete(sessionId);
  }

  // Client-trusted Bloxity user id (guest ids are dropped, see GUEST_ID_PREFIX). A forged id can
  // only read/overwrite the SENDER's own save (there is no cross-player read in `saveProgress`).
  // Called from both onJoin and `identify`; answers with progress / noProgress / serverError.
  private setUserId(client: Client, p: PlayerState, raw: string) {
    let userId = raw.slice(0, 128);
    // Guests (client-made `guest-...` ids) get no identity: nothing is loaded or saved for them.
    if (userId.startsWith(GUEST_ID_PREFIX)) userId = "";
    const prev = this.userIds.get(client.sessionId) || "";
    // No change (e.g. a username-only identify) -- but the very first call must still answer.
    if (userId === prev && this.identified.has(client.sessionId)) return;
    this.identified.add(client.sessionId);
    this.loaded.delete(client.sessionId); // no writes until the new identity's save is read
    p.signedIn = !!userId;
    p.uid = userId; // chat messages carry this id: the others put the bubble over the right player
    if (!userId) this.scoreDocs.delete(client.sessionId);

    if (userId) {
      // Evict any OTHER live session already claiming this account, so one account never has
      // two racing Mongo writers (a crashed tab lingers up to RECONNECT_SECONDS via
      // allowReconnection in onLeave).
      for (const [sid, uid] of this.userIds) {
        if (sid === client.sessionId || uid !== userId) continue;
        this.forgetSession(sid);
        const stale = this.clients.find((c) => c.sessionId === sid);
        if (stale) {
          try {
            stale.leave(CloseCode.CONSENTED);
          } catch {
            // Already gone -- nothing to clean up.
          }
        }
      }
      this.userIds.set(client.sessionId, userId);
    } else {
      // No identity: stop persisting for this connection. (The client flushes a final
      // saveProgress under the OLD id before sending `identify`.)
      this.userIds.delete(client.sessionId);
    }

    void this.loadProgress(client, userId, p);
  }

  // Sends the saved doc to just this client so it can hydrate its state ("progress"), or
  // "noProgress" when there is nothing to load (new account, guest, or Mongo unset). A failed read
  // sends "serverError" and keeps saving off, so a save that could not be read is never overwritten.
  private async loadProgress(client: Client, userId: string, p: PlayerState) {
    const players = getPlayers();
    let doc: PlayerDoc | null = null;
    if (userId && players) {
      try {
        doc = await players.findOne({ _id: userId });
      } catch (err) {
        console.warn("[WorldRoom] loadProgress failed", err);
        client.send("serverError", {});
        return;
      }
    }
    // The player may have left, or switched identity again, while the read was in flight.
    if (this.state.players.get(client.sessionId) !== p || (this.userIds.get(client.sessionId) ?? "") !== userId) return;

    this.loaded.add(client.sessionId);
    if (doc) this.scoreDocs.set(client.sessionId, doc);
    const now = Date.now();
    if (!doc) client.send("noProgress", { serverTime: now });
    else client.send("progress", { ...(sanitizeProgress(doc) ?? {}), serverTime: now });
    // Invites: a signed-in player gets their state (and may be credited as someone's invited friend);
    // a guest is told invites need a Bloxity account.
    if (userId) {
      const invite = readInvite(doc);
      this.inviteStates.set(client.sessionId, invite);
      client.send("invite", inviteView(invite));
      void this.creditInvite(client, userId, invite, doc);
    } else client.send("invite", { ...inviteView(readInvite(null)), guest: true });
    void this.sendLeaderboard(client);
  }

  // Stores invite fields. True when stored, or when there is nowhere to store them (no database:
  // they live in `inviteStates` for the session).
  private async saveInvite(sessionId: string, fields: Partial<PlayerDoc>): Promise<boolean> {
    const userId = this.userIds.get(sessionId);
    const players = getPlayers();
    if (!userId || !players) return true;
    try {
      await players.updateOne({ _id: userId }, { $set: { ...fields, updatedAt: new Date() }, $setOnInsert: { version: 1 } }, { upsert: true });
      return true;
    } catch (err) {
      console.warn("[WorldRoom] saveInvite failed", err);
      return false;
    }
  }

  // A signed-in player joined who was never invited before: if their link's `ref` (or a direct invite,
  // `invitesSent`) names another existing player, they become that player's invited friend. `invitedBy`
  // is set once (a conditional write, so two rooms can't both credit), then the inviter's `invites`
  // goes up (live when the inviter is in this room: their Friend Boost grows).
  private async creditInvite(client: Client, userId: string, st: InviteState, doc: PlayerDoc | null) {
    const players = getPlayers();
    if (!players || doc?.invitedBy) return;
    try {
      const ref = this.refs.get(client.sessionId);
      let inviter = ref && ref !== userId ? await players.findOne({ _id: ref }) : null;
      if (!inviter) inviter = await players.findOne({ invitesSent: userId } as Filter<PlayerDoc>);
      if (!inviter || inviter._id === userId) return;
      let credited = false;
      try {
        const res = await players.updateOne(
          { _id: userId, invitedBy: { $exists: false } } as Filter<PlayerDoc>,
          { $set: { invitedBy: inviter._id }, $setOnInsert: { version: 1, updatedAt: new Date() } },
          { upsert: true },
        );
        credited = res.modifiedCount + (res.upsertedCount ?? 0) > 0;
      } catch {
        // Duplicate key: another session credited this account first.
      }
      if (!credited) return;
      await players.updateOne({ _id: inviter._id }, { $inc: { invites: 1 } });
      const name = this.state.players.get(client.sessionId)?.username || "A friend";
      if (this.inviteStates.get(client.sessionId) === st) client.send("invitedBy", { name: inviter.username || "A friend" });
      // The inviter, when online in this room.
      for (const [sid, uid] of this.userIds) {
        const is = this.inviteStates.get(sid);
        const c = this.clients.find((c) => c.sessionId === sid);
        if (uid !== inviter._id || !is || !c) continue;
        is.joined++;
        c.send("invite", inviteView(is));
        c.send("friendJoined", { name });
      }
    } catch (err) {
      console.warn("[WorldRoom] creditInvite failed", err);
    }
  }
}
