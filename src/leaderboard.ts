import { LEADERBOARD_EVERY_MS, LEADERBOARD_SIZE, LEADERBOARD_STATS, type LeaderboardStat } from "./constants.js";
import { getPlayers } from "./db.js";

// The plaza's four leaderboard boards (client plaza.js): the top LEADERBOARD_SIZE saved players by
// rebirths, Wins (trophies), Power (energy) and playtime, read from every saved doc. The top lists
// are one shared cache per process (every room reads it), refreshed at most every
// LEADERBOARD_EVERY_MS; each player's own rank is counted per refresh. Guests are never saved, so
// they never appear (their rank is null).

export interface LeaderRow {
  name: string;
  value: number;
}
export type Boards = Record<LeaderboardStat, LeaderRow[]>;
export type Ranks = Record<LeaderboardStat, number | null>;

const empty = (): Boards => Object.fromEntries(LEADERBOARD_STATS.map((s): [string, LeaderRow[]] => [s, []])) as unknown as Boards;

let cache: { at: number; boards: Boards } = { at: -Infinity, boards: empty() };
let inflight: Promise<Boards> | null = null;

// Top lists, from the cache while fresh. Never throws: no database / a failed read keeps the last lists.
export function topBoards(now = Date.now()): Promise<Boards> {
  if (now - cache.at < LEADERBOARD_EVERY_MS) return Promise.resolve(cache.boards);
  return (inflight ??= readBoards()
    .then((boards) => {
      cache = { at: Date.now(), boards };
      return boards;
    })
    .catch((err) => {
      console.warn("[leaderboard] read failed", err);
      cache.at = Date.now(); // don't hammer a failing database
      return cache.boards;
    })
    .finally(() => (inflight = null)));
}

async function readBoards(): Promise<Boards> {
  const players = getPlayers();
  if (!players) return empty();
  const boards = empty();
  await Promise.all(
    LEADERBOARD_STATS.map(async (stat) => {
      const docs = await players
        .find({ [stat]: { $gt: 0 } }, { projection: { username: 1, [stat]: 1 } })
        .sort({ [stat]: -1 })
        .limit(LEADERBOARD_SIZE)
        .toArray();
      boards[stat] = docs.map((d) => ({ name: d.username || "Player", value: Number(d[stat]) || 0 }));
    }),
  );
  return boards;
}

// A saved player's place on each board (1 = top), null when it has no score there or can't be read.
export async function ranksOf(userId: string): Promise<Ranks> {
  const ranks = Object.fromEntries(LEADERBOARD_STATS.map((s): [string, null] => [s, null])) as unknown as Ranks;
  const players = getPlayers();
  if (!userId || !players) return ranks;
  try {
    const doc = await players.findOne({ _id: userId }, { projection: Object.fromEntries(LEADERBOARD_STATS.map((s): [string, number] => [s, 1])) });
    if (!doc) return ranks;
    await Promise.all(
      LEADERBOARD_STATS.map(async (stat) => {
        const v = Number(doc[stat]);
        if (!(v > 0)) return;
        ranks[stat] = (await players.countDocuments({ [stat]: { $gt: v } })) + 1;
      }),
    );
  } catch (err) {
    console.warn("[leaderboard] rank read failed", err);
  }
  return ranks;
}

// Test-only: forget the cached lists.
export function __resetLeaderboardForTest(): void {
  cache = { at: -Infinity, boards: empty() };
  inflight = null;
}
