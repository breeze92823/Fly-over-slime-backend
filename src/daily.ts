import { DAILY_DAYS } from "./constants.js";
import type { PlayerDoc } from "./db.js";

// Daily Reward (client src/daily.js): a 7-day calendar on the SERVER's clock (UTC days), so a
// changed device clock can't unlock anything. Each new UTC day the player joins (or is online
// through midnight) unlocks one more day, up to DAILY_DAYS; unlocked days stay claimable until
// claimed (days need not be consecutive). Once all are claimed, the next new day starts a fresh
// cycle at day 1. Unlike the rest of the save, the client never writes these fields:
// claims go through the `claimDaily` message (WorldRoom.ts) and only then does the client grant
// the reward.
export interface DailyState {
  day: number; // days unlocked this cycle (0..DAILY_DAYS)
  last: number; // UTC day index (utcDay) of the last unlock, -1 = never
  claimed: number[]; // claimed day indexes (0-based) this cycle
}

const DAY_MS = 86_400_000;
export const utcDay = (ms = Date.now()) => Math.floor(ms / DAY_MS);

// The saved state from a player's doc (null / missing fields = a new player), bounded.
export function readDaily(doc: Partial<PlayerDoc> | null): DailyState {
  const day = Number.isInteger(doc?.dailyDay) ? Math.min(DAILY_DAYS, Math.max(0, doc!.dailyDay!)) : 0;
  const last = Number.isInteger(doc?.dailyLast) ? doc!.dailyLast! : -1;
  const raw = Array.isArray(doc?.dailyClaimed) ? doc!.dailyClaimed! : [];
  const claimed = [...new Set(raw.filter((i) => Number.isInteger(i) && i >= 0 && i < day))].sort((a, b) => a - b);
  return { day, last, claimed };
}

// Unlocks today's day if it isn't yet. Returns true when the state changed (save it).
export function rollDaily(s: DailyState, today = utcDay()): boolean {
  if (s.last >= today) return false; // already rolled today (or the clock went back)
  if (s.day === 0 || s.claimed.length >= DAILY_DAYS) {
    s.day = 1;
    s.claimed = [];
  } else s.day = Math.min(DAILY_DAYS, s.day + 1);
  s.last = today;
  return true;
}

// Claims day `i` (0-based) if it is unlocked and unclaimed.
export function claimDaily(s: DailyState, i: unknown): boolean {
  if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= s.day || s.claimed.includes(i as number)) return false;
  s.claimed.push(i as number);
  s.claimed.sort((a, b) => a - b);
  return true;
}

// What the client is sent: the state plus when the next UTC day starts (server clock).
export function dailyView(s: DailyState, now = Date.now()) {
  return { unlocked: s.day, claimed: [...s.claimed], nextAt: (utcDay(now) + 1) * DAY_MS, serverTime: now };
}

// The doc fields that store it.
export const dailyFields = (s: DailyState) => ({ dailyDay: s.day, dailyLast: s.last, dailyClaimed: [...s.claimed] });
