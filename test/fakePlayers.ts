import type { Collection } from "mongodb";

import type { PlayerDoc } from "../src/db.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Just what WorldRoom calls: findOne() and updateOne() (upsert, $set, $max, $setOnInsert), plus the
// leaderboard's find({ f: { $gt } }).sort({ f: -1 }).limit(n).toArray() and countDocuments({ f: { $gt } }).
// Reads wait for release(), so a test registers its message handlers before the load answers.
export function fakePlayers(seed: PlayerDoc[] = []) {
  const docs = new Map<string, PlayerDoc>(seed.map((d) => [d._id, d]));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fake = {
    docs,
    gate,
    release,
    async findOne(filter: { _id?: string; invitesSent?: string }) {
      await gate;
      if (filter._id !== undefined) return docs.get(filter._id) ?? null;
      if (filter.invitesSent !== undefined) return [...docs.values()].find((d) => d.invitesSent?.includes(filter.invitesSent!)) ?? null;
      return null;
    },
    find(filter: Record<string, { $gt: number }>) {
      const [field, { $gt }] = Object.entries(filter)[0];
      let rows = [...docs.values()].filter((d: any) => d[field] > $gt);
      const cursor = {
        sort(by: Record<string, number>) {
          const [f, dir] = Object.entries(by)[0];
          rows = rows.sort((a: any, b: any) => dir * ((a[f] ?? 0) - (b[f] ?? 0)));
          return cursor;
        },
        limit(n: number) {
          rows = rows.slice(0, n);
          return cursor;
        },
        toArray: async () => rows,
      };
      return cursor;
    },
    async countDocuments(filter: Record<string, { $gt: number }>) {
      const [field, { $gt }] = Object.entries(filter)[0];
      return [...docs.values()].filter((d: any) => d[field] > $gt).length;
    },
    async updateOne(filter: { _id: string; invitedBy?: { $exists: boolean } }, update: any, options: any) {
      const existing = docs.get(filter._id);
      if (filter.invitedBy?.$exists === false && existing?.invitedBy) return { modifiedCount: 0, upsertedCount: 0 };
      if (!existing && !options?.upsert) return { modifiedCount: 0 };
      const next: any = { ...(existing ?? { _id: filter._id, ...(update.$setOnInsert ?? {}) }), ...(update.$set ?? {}) };
      for (const [k, v] of Object.entries(update.$max ?? {})) next[k] = Math.max(next[k] ?? -Infinity, v as number);
      for (const [k, v] of Object.entries(update.$inc ?? {})) next[k] = (next[k] ?? 0) + (v as number);
      docs.set(filter._id, next);
      return existing ? { modifiedCount: 1, upsertedCount: 0 } : { modifiedCount: 0, upsertedCount: 1 };
    },
  };
  return fake as unknown as Collection<PlayerDoc> & { docs: Map<string, PlayerDoc>; gate: Promise<void>; release: () => void };
}
