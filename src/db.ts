import { MongoClient, type Collection } from "mongodb";

import { LEADERBOARD_STATS } from "./constants.js";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

// The persisted client state (what `saveProgress` carries, see sanitize.ts). The client keeps
// nothing in the browser: this document is the player's only save.
export interface PlayerDoc {
  _id: string; // Bloxity user id -- see WorldRoom.ts (guests are never saved)
  username?: string; // display name as of the last save
  trophies?: number; // Wins (the HUD's trophy counter, the shop currency)
  gems?: number;
  energy?: number; // lightning (rebirth.js), the race speed
  rebirths?: number;
  autoRebirth?: boolean;
  bestDistance?: number; // personal best race, studs (only ever goes up)
  playtime?: number; // s with the game visible
  boats?: string[]; // owned boat ids (client BOATS.list)
  boat?: string; // the equipped boat (an owned one)
  engines?: string[]; // owned engine ids (client engine.js ENGINES)
  engine?: string; // the equipped engine, "" = none
  partners?: string[]; // owned partner ids (client PARTNER.partners)
  partner?: string; // the equipped partner, "" = none
  trails?: string[]; // owned trail ids (client TRAILS.list)
  trail?: string; // the equipped trail, "" = none
  pets?: SavedPet[]; // owned pets (client pets.js), at most PETS_MAX
  petSlots?: number; // pets equipped at once
  petStorage?: number; // pets owned at most
  eggsSeen?: string[]; // pet kinds ever hatched (client eggs.js: the NEW! tag)
  hatchMax?: number; // eggs one Open Max hatches (1, or a bought +3 / +8 / +16 upgrade)
  eggsHatched?: number; // lifetime eggs hatched (the Egg Fan title)
  world?: string; // the world the player was in (client worlds.js WORLDS), "" = the start world
  worldsUnlocked?: string[]; // worlds whose portal requirement was met once (they stay open)
  giftTime?: number; // Online Gifts clock, s online this round
  giftsClaimed?: number[]; // GIFTS.list indexes claimed this round
  potions?: Record<string, number>; // potion id -> count (gifts.js)
  lastSeen?: number; // epoch ms of the last activity
  // Spin wheel (spin.ts): written only by the server's `spin` handler, never by saveProgress.
  spins?: number; // spins ready to use
  spinAt?: number; // epoch ms the next free spin arrives
  // Daily Reward (daily.ts): written by the server only, never by saveProgress.
  dailyDay?: number; // days unlocked this cycle
  dailyLast?: number; // UTC day index of the last unlock
  dailyClaimed?: number[]; // claimed day indexes this cycle
  version: number;
  updatedAt: Date;
}

// One owned pet: its kind (client PETS.kinds key) and craft tier (index into PETS.tiers).
export interface SavedPet {
  kind: string;
  tier: number;
  equipped: boolean;
  locked: boolean;
}

let client: MongoClient | null = null;
let players: Collection<PlayerDoc> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set -- player progress will not persist");
    return;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    // No dbName passed to .db() -- the injected URI already points at this game+channel's database.
    players = client.db().collection<PlayerDoc>("players");
    console.log("[db] connected to MongoDB");
    // The leaderboards sort and count by these (leaderboard.ts).
    for (const stat of LEADERBOARD_STATS) {
      players.createIndex({ [stat]: -1 }).catch((err) => console.warn(`[db] index on ${stat} failed`, err));
    }
  } catch (err) {
    console.warn("[db] connect failed -- player progress will not persist:", err);
    client = null;
    players = null;
  }
}

// Null whenever Mongo is unset/unreachable -- every caller must treat that as "skip persistence".
export function getPlayers(): Collection<PlayerDoc> | null {
  return players;
}

// Test-only seam: exercise the save/load logic against an in-memory fake collection.
export function __setPlayersForTest(fake: Collection<PlayerDoc> | null): void {
  players = fake;
}
