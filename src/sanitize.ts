import {
  CURRENCY_MAX, REBIRTHS_MAX, DISTANCE_MAX, PLAY_SECONDS_MAX, OWNED_MAX, PETS_MAX, PET_TIERS_MAX,
  PET_SLOTS_MAX, HATCH_MAX, HATCHED_MAX, GIFTS_MAX, POTION_KINDS_MAX, POTION_COUNT_MAX, ID_PATTERN,
} from "./constants.js";
import type { PlayerDoc, SavedPet } from "./db.js";

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function clampNum(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}
export function clampInt(v: number, max: number, min = 0): number {
  return Math.min(max, Math.max(min, Math.floor(v)));
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

// Catalog ids (boats, engines, partners, trails): slug strings, no duplicates, bounded count.
export function sanitizeIds(raw: unknown, max = OWNED_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isId))].slice(0, max);
}

// Owned pets { kind, tier, equipped, locked }: slug kinds, integer tiers, at most PETS_MAX, and no
// more than `slots` of them equipped (the extra ones are unequipped, never dropped).
export function sanitizePets(raw: unknown, slots = PET_SLOTS_MAX): SavedPet[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPet[] = [];
  let equipped = 0;
  for (const p of raw) {
    if (out.length >= PETS_MAX) break;
    if (!isObject(p) || !isId(p.kind) || !Number.isInteger(p.tier) || (p.tier as number) < 0 || (p.tier as number) >= PET_TIERS_MAX) continue;
    const on = p.equipped === true && equipped < slots;
    if (on) equipped++;
    out.push({ kind: p.kind, tier: p.tier as number, equipped: on, locked: p.locked === true });
  }
  return out;
}

// Potion counts { id: n }: slug ids, whole non-negative counts, bounded kinds.
function sanitizePotions(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(raw)) return out;
  for (const [id, n] of Object.entries(raw)) {
    if (Object.keys(out).length >= POTION_KINDS_MAX) break;
    if (isId(id) && finite(n)) out[id] = clampInt(n, POTION_COUNT_MAX);
  }
  return out;
}

// One owned list + its equipped id. The equipped one must be owned ("" = none); when this save
// doesn't carry the list, trust the id's shape only.
function ownedPair(raw: Record<string, unknown>, out: Partial<PlayerDoc>, listKey: "boats" | "engines" | "partners" | "trails", idKey: "boat" | "engine" | "partner" | "trail") {
  if (raw[listKey] !== undefined) out[listKey] = sanitizeIds(raw[listKey]);
  const id = raw[idKey];
  const owned = out[listKey];
  if (id === "") out[idKey] = "";
  else if (isId(id) && (!owned || owned.includes(id))) out[idKey] = id;
}

// The game is client-authoritative -- no server-side gameplay validation. What IS enforced:
// shape and bounds, so a malformed payload can never corrupt this player's own Mongo document.
// A forged number can only ever affect the sender's own save.
export function sanitizeProgress(raw: unknown): Partial<PlayerDoc> | null {
  if (!isObject(raw)) return null;
  const out: Partial<PlayerDoc> = {};

  if (finite(raw.trophies)) out.trophies = clampNum(raw.trophies, CURRENCY_MAX);
  if (finite(raw.gems)) out.gems = clampNum(raw.gems, CURRENCY_MAX);
  if (finite(raw.energy)) out.energy = clampNum(raw.energy, CURRENCY_MAX);
  if (finite(raw.rebirths)) out.rebirths = clampInt(raw.rebirths, REBIRTHS_MAX);
  if (typeof raw.autoRebirth === "boolean") out.autoRebirth = raw.autoRebirth;
  if (finite(raw.bestDistance)) out.bestDistance = clampNum(raw.bestDistance, DISTANCE_MAX);
  if (finite(raw.playtime)) out.playtime = clampInt(raw.playtime, PLAY_SECONDS_MAX);
  if (finite(raw.lastSeen)) out.lastSeen = clampInt(raw.lastSeen, Date.now() + 10 * 60 * 1000);

  ownedPair(raw, out, "boats", "boat");
  ownedPair(raw, out, "engines", "engine");
  ownedPair(raw, out, "partners", "partner");
  ownedPair(raw, out, "trails", "trail");

  if (finite(raw.petSlots)) out.petSlots = clampInt(raw.petSlots, PET_SLOTS_MAX, 1);
  if (finite(raw.petStorage)) out.petStorage = clampInt(raw.petStorage, PETS_MAX, 1);
  if (raw.pets !== undefined) out.pets = sanitizePets(raw.pets, out.petSlots ?? PET_SLOTS_MAX);
  if (raw.eggsSeen !== undefined) out.eggsSeen = sanitizeIds(raw.eggsSeen);
  if (finite(raw.hatchMax)) out.hatchMax = clampInt(raw.hatchMax, HATCH_MAX, 1);
  if (finite(raw.eggsHatched)) out.eggsHatched = clampInt(raw.eggsHatched, HATCHED_MAX);
  if (raw.world === "" || isId(raw.world)) out.world = raw.world as string;
  if (raw.worldsUnlocked !== undefined) out.worldsUnlocked = sanitizeIds(raw.worldsUnlocked);

  if (finite(raw.giftTime)) out.giftTime = clampInt(raw.giftTime, PLAY_SECONDS_MAX);
  if (raw.giftsClaimed !== undefined) {
    const claimed = Array.isArray(raw.giftsClaimed) ? raw.giftsClaimed.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < GIFTS_MAX) : [];
    out.giftsClaimed = [...new Set(claimed)];
  }
  if (raw.potions !== undefined) out.potions = sanitizePotions(raw.potions);
  return out;
}
