import { MongoClient, type Collection } from "mongodb";

import { LEADERBOARD_STATS } from "./constants.js";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

// The persisted client state (what `saveProgress` carries, see sanitize.ts): the client's whole
// `state` object (Fly-over-slime/src/state.js). For signed-in players this document is the save;
// the browser keeps only a cache that the server's copy replaces on load.
export interface PlayerDoc {
  _id: string; // Bloxity user id -- see WorldRoom.ts (guests are never saved)
  username?: string; // display name as of the last save
  wins?: number;
  skill?: number;
  bestSkill?: number; // only ever goes up ($max)
  totalSkill?: number;
  level?: number; // client-computed Level, ranked on the leaderboard
  rebirths?: number;
  tokens?: number;
  slingshots?: string[];
  equippedSling?: string;
  platforms?: string[];
  pets?: SavedPet[];
  nextUid?: number;
  discovered?: string[];
  indexClaims?: number;
  trails?: string[];
  trail?: string; // "" = none
  passes?: Record<string, boolean>;
  extraSlots?: number;
  storageBuys?: number;
  hatchMax?: number;
  autoRebirth?: boolean;
  autoFly?: boolean;
  playTime?: number; // s, lifetime
  flights?: number;
  bestDistance?: number; // metres, only ever goes up ($max)
  chestAt?: number; // epoch ms
  potions?: Record<string, number>;
  boostLeft?: Record<string, number>;
  daily?: { unlocked: number; last: number; claimed: number[] };
  title?: string;
  stats?: Record<string, number>;
  gear?: Record<string, number>; // Flight Gear levels by id
  settings?: Record<string, boolean | number | string>;
  lastSeen?: number; // epoch ms of the last activity
  version: number;
  updatedAt: Date;
}

// One owned pet (client state.pets): uid, catalog id, tier '' | 'g' | 'd'.
export interface SavedPet {
  uid: number;
  id: string;
  tier: string;
  equipped: boolean;
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
