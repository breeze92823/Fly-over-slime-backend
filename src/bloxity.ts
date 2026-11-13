import { GUEST_ID_PREFIX, LB_BOARDS, LB_REPORT_MAX, STAT_CEILING, STAT_DEFS, STATS_REPORT_MAX } from "./constants.js";
import type { PlayerDoc } from "./db.js";

// Bloxity (Legion) platform calls the game server makes. Every one degrades to a no-op when the
// platform env vars are missing (local `npm start`), and none of them throws.
//   BLOXITY_API_URL      platform API base (injected by Legion hosting)
//   BLOXITY_GAME_ID      this game's id (= the client's GAME_SLUG)
//   BLOXITY_REPORT_TOKEN bearer token for the hosted leaderboard report
// Docs: https://docs.bloxity.io/#html5 (server token verification, hosted leaderboards).

const apiUrl = () => (process.env.BLOXITY_API_URL || "").replace(/\/$/, "");
const gameId = () => process.env.BLOXITY_GAME_ID || "fly-over-slime";

// True when this server can verify Bloxity game tokens (deployed). Locally it can't, so the
// client-sent id is trusted there (dev only: never in production without the API URL).
export const canVerify = () => !!apiUrl();

export interface VerifiedUser {
  id: string; // the account id (user._id): the only id the server trusts
  username: string;
  pfp: string;
}

// POST {BLOXITY_API_URL}/v1/auth/game-token/verify -> { valid, user: { _id, username, displayName, pfp } }.
// null = not valid (a guest) or the check failed.
export async function verifyToken(token: unknown): Promise<VerifiedUser | null> {
  const base = apiUrl();
  if (!base || typeof token !== "string" || !token || token.length > 4096) return null;
  try {
    const res = await fetcher(`${base}/v1/auth/game-token/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameSlug: gameId() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { valid?: boolean; user?: { _id?: unknown; username?: unknown; displayName?: unknown; pfp?: unknown } };
    const id = body?.user?._id;
    if (!body?.valid || typeof id !== "string" || !id || id.startsWith(GUEST_ID_PREFIX)) return null;
    const name = body.user?.displayName || body.user?.username;
    return { id, username: typeof name === "string" ? name : "", pfp: typeof body.user?.pfp === "string" ? body.user.pfp : "" };
  } catch (err) {
    console.warn("[bloxity] token verify failed", err);
    return null;
  }
}

// --- Hosted leaderboards ----------------------------------------------------------------------------
// Scores are read from each signed-in player's stored save, so the server reports state it keeps,
// never a client-sent score.
export type Scores = Partial<Record<(typeof LB_BOARDS)[number]["id"], number>>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// The saved doc's fields -> the board scores (0 = nothing to report).
export function scoresFromDoc(doc: Partial<PlayerDoc> | null | undefined): Scores {
  const out: Scores = {};
  if (!doc) return out;
  for (const b of LB_BOARDS) out[b.id] = num(doc[b.stat]);
  return out;
}

// A Bloxity account id as the report wants it: `legion_<id>`, without any `#m...` suffix; "" for
// anything that isn't an account.
export function reportId(id: string): string {
  const bare = id.split("#")[0];
  if (!bare || bare.startsWith(GUEST_ID_PREFIX)) return "";
  return bare.startsWith("legion_") ? bare : `legion_${bare}`;
}

let fetcher: typeof fetch = fetch;
// Test-only: swap fetch.
export function __setFetchForTest(f: typeof fetch | null): void {
  fetcher = f ?? fetch;
}

// POST {BLOXITY_API_URL}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report, at most LB_REPORT_MAX scores
// a call. Returns how many were accepted (0 when not configured).
export async function reportScores(rows: { userId: string; scores: Scores }[]): Promise<number> {
  const base = apiUrl();
  const token = process.env.BLOXITY_REPORT_TOKEN;
  if (!base || !token || !rows.length) return 0;
  const scores: { board: string; userId: string; score: number }[] = [];
  for (const r of rows) {
    const userId = reportId(r.userId);
    if (!userId) continue;
    for (const b of LB_BOARDS) {
      const score = r.scores[b.id];
      if (score) scores.push({ board: b.id, userId, score });
    }
  }
  const boards = LB_BOARDS.map(({ stat, ...b }) => b);
  let accepted = 0;
  for (let i = 0; i < scores.length; i += LB_REPORT_MAX) {
    try {
      const res = await fetcher(`${base}/v1/leaderboards/hosted/${encodeURIComponent(gameId())}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ boards, scores: scores.slice(i, i + LB_REPORT_MAX) }),
        signal: AbortSignal.timeout(10000),
      });
      const body = (await res.json().catch((): null => null)) as { accepted?: number; dropped?: unknown } | null;
      accepted += body?.accepted ?? 0;
      if (body?.dropped) console.info("[bloxity] leaderboard report", { accepted: body.accepted, dropped: body.dropped });
    } catch (err) {
      console.warn("[bloxity] leaderboard report failed", err);
    }
  }
  return accepted;
}

// --- Game stats (profile + missions) ---------------------------------------------------------------
export type StatValues = Record<string, number>;

const statSource = (doc: Partial<PlayerDoc>, from: string): unknown => {
  if (from === "pets.length") return doc.pets?.length;
  if (from.startsWith("stats.")) return doc.stats?.[from.slice(6)];
  return (doc as Record<string, unknown>)[from];
};

// The saved doc -> the declared stats' current values: whole, finite, >= 0, clamped to the type's
// ceiling (Bloxity rejects above it). Stats the doc has no value for are left out.
export function statsFromDoc(doc: Partial<PlayerDoc> | null | undefined): StatValues {
  const out: StatValues = {};
  if (!doc) return out;
  for (const d of STAT_DEFS) {
    const raw = Number(statSource(doc, d.from));
    if (!Number.isFinite(raw) || raw < 0) continue;
    out[d.key] = Math.min(Math.floor(raw), STAT_CEILING[d.type]);
  }
  return out;
}

// POST {BLOXITY_API_URL}/v1/games/{BLOXITY_GAME_ID}/stats, at most STATS_REPORT_MAX players a call; the
// definitions ride along on every call. Returns how many players were accepted (0 when not configured).
// Report CURRENT values: Bloxity keeps the last one and a high-water mark that can never be lowered.
export async function reportStats(rows: { userId: string; values: StatValues }[]): Promise<number> {
  const base = apiUrl();
  const token = process.env.BLOXITY_REPORT_TOKEN;
  if (!base || !token || !rows.length) return 0;
  const players: { userId: string; values: StatValues }[] = [];
  for (const r of rows) {
    const userId = reportId(r.userId);
    if (userId && Object.keys(r.values).length) players.push({ userId, values: r.values });
  }
  const definitions = STAT_DEFS.map(({ from, ...d }) => d);
  let accepted = 0;
  for (let i = 0; i < players.length; i += STATS_REPORT_MAX) {
    try {
      const res = await fetcher(`${base}/v1/games/${encodeURIComponent(gameId())}/stats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ definitions, players: players.slice(i, i + STATS_REPORT_MAX) }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json().catch((): null => null)) as { accepted?: number; dropped?: Record<string, number> } | null;
      if (!res.ok) console.warn(`[bloxity] stats report answered ${res.status}`, body);
      accepted += body?.accepted ?? 0;
      const dropped = Object.entries(body?.dropped ?? {}).filter(([, n]) => n > 0);
      if (dropped.length) console.warn("[bloxity] stats dropped", Object.fromEntries(dropped));
    } catch (err) {
      console.warn("[bloxity] stats report failed", err);
    }
  }
  return accepted;
}
