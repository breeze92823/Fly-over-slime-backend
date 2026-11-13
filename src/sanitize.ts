import {
  CURRENCY_MAX, REBIRTHS_MAX, COUNT_MAX, DISTANCE_MAX, PLAY_SECONDS_MAX, OWNED_MAX, PETS_MAX, PET_TIERS,
  PET_SLOTS_MAX, DISCOVERED_MAX, HATCH_MAX, GEAR_LEVEL_MAX, MAP_KEYS_MAX, DAILY_DAYS, SETTING_STRING_MAX, ID_PATTERN,
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

// Catalog ids (slingshots, tables, trails): slug strings, no duplicates, bounded count.
export function sanitizeIds(raw: unknown, max = OWNED_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isId))].slice(0, max);
}

// Index keys: a pet id, optionally ":g" / ":d" for its tier.
export function sanitizeDiscovered(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ok = (v: unknown): v is string => {
    if (typeof v !== "string") return false;
    const [id, tier, ...rest] = v.split(":");
    return rest.length === 0 && isId(id) && (tier === undefined || tier === "g" || tier === "d");
  };
  return [...new Set(raw.filter(ok))].slice(0, DISCOVERED_MAX);
}

// Owned pets { uid, id, tier: '' | 'g' | 'd', equipped }: slug ids, whole uids, at most PETS_MAX, and
// no more than `slots` of them equipped (the extra ones are unequipped, never dropped).
export function sanitizePets(raw: unknown, slots = PET_SLOTS_MAX): SavedPet[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPet[] = [];
  let equipped = 0;
  for (const p of raw) {
    if (out.length >= PETS_MAX) break;
    if (!isObject(p) || !isId(p.id) || !finite(p.uid)) continue;
    const tier = typeof p.tier === "string" ? p.tier : "";
    if (!(PET_TIERS as readonly string[]).includes(tier)) continue;
    const on = p.equipped === true && equipped < slots;
    if (on) equipped++;
    out.push({ uid: clampInt(p.uid, COUNT_MAX), id: p.id, tier, equipped: on });
  }
  return out;
}

// { id: n } maps (potions, boosts, stats): slug keys, non-negative numbers, bounded kinds.
function numberMap(raw: unknown, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(raw)) return out;
  for (const [id, n] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAP_KEYS_MAX) break;
    if (isId(id) && finite(n)) out[id] = clampNum(n, max);
  }
  return out;
}
function boolMap(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObject(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAP_KEYS_MAX) break;
    if (isId(id) && typeof v === "boolean") out[id] = v;
  }
  return out;
}
function settingsMap(raw: unknown): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  if (!isObject(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAP_KEYS_MAX) break;
    if (!isId(id)) continue;
    if (typeof v === "boolean") out[id] = v;
    else if (finite(v)) out[id] = clampNum(v, 1e6);
    else if (typeof v === "string" && v.length <= SETTING_STRING_MAX) out[id] = v;
  }
  return out;
}

// Daily Rewards (client state.daily): days unlocked this cycle, the local day index of the last
// unlock, claimed 0-based days.
function sanitizeDaily(raw: unknown): PlayerDoc["daily"] | undefined {
  if (!isObject(raw)) return undefined;
  const claimed = Array.isArray(raw.claimed) ? raw.claimed.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < DAILY_DAYS) : [];
  return {
    unlocked: finite(raw.unlocked) ? clampInt(raw.unlocked, DAILY_DAYS) : 0,
    last: finite(raw.last) ? clampInt(raw.last, COUNT_MAX, -1) : -1,
    claimed: [...new Set(claimed)],
  };
}

// The game is client-authoritative -- no server-side gameplay validation. What IS enforced:
// shape and bounds, so a malformed payload can never corrupt this player's own Mongo document.
// A forged number can only ever affect the sender's own save.
export function sanitizeProgress(raw: unknown): Partial<PlayerDoc> | null {
  if (!isObject(raw)) return null;
  const out: Partial<PlayerDoc> = {};

  for (const k of ["wins", "skill", "bestSkill", "totalSkill", "tokens"] as const) {
    if (finite(raw[k])) out[k] = clampNum(raw[k], CURRENCY_MAX);
  }
  for (const k of ["rebirths"] as const) if (finite(raw[k])) out[k] = clampInt(raw[k], REBIRTHS_MAX);
  for (const k of ["level", "indexClaims", "flights", "nextUid", "extraSlots", "storageBuys"] as const) {
    if (finite(raw[k])) out[k] = clampInt(raw[k], COUNT_MAX);
  }
  if (finite(raw.bestDistance)) out.bestDistance = clampNum(raw.bestDistance, DISTANCE_MAX);
  if (finite(raw.playTime)) out.playTime = clampInt(raw.playTime, PLAY_SECONDS_MAX);
  if (finite(raw.chestAt)) out.chestAt = clampInt(raw.chestAt, Date.now() + 366 * 86400000);
  if (finite(raw.lastSeen)) out.lastSeen = clampInt(raw.lastSeen, Date.now() + 10 * 60 * 1000);
  if (finite(raw.hatchMax)) out.hatchMax = clampInt(raw.hatchMax, HATCH_MAX, 1);
  if (typeof raw.autoRebirth === "boolean") out.autoRebirth = raw.autoRebirth;
  if (typeof raw.autoFly === "boolean") out.autoFly = raw.autoFly;

  if (raw.slingshots !== undefined) out.slingshots = sanitizeIds(raw.slingshots);
  if (raw.platforms !== undefined) out.platforms = sanitizeIds(raw.platforms);
  if (raw.trails !== undefined) out.trails = sanitizeIds(raw.trails);
  // The equipped slingshot / trail must be owned when this save carries the list ("" = no trail).
  if (isId(raw.equippedSling) && (!out.slingshots || out.slingshots.includes(raw.equippedSling))) out.equippedSling = raw.equippedSling;
  if (raw.trail === "") out.trail = "";
  else if (isId(raw.trail) && (!out.trails || out.trails.includes(raw.trail))) out.trail = raw.trail;
  if (isId(raw.title)) out.title = raw.title;

  if (raw.pets !== undefined) out.pets = sanitizePets(raw.pets);
  if (raw.discovered !== undefined) out.discovered = sanitizeDiscovered(raw.discovered);
  if (raw.passes !== undefined) out.passes = boolMap(raw.passes);
  if (raw.potions !== undefined) out.potions = numberMap(raw.potions, 1e9);
  if (raw.boostLeft !== undefined) out.boostLeft = numberMap(raw.boostLeft, PLAY_SECONDS_MAX);
  if (raw.stats !== undefined) out.stats = numberMap(raw.stats, CURRENCY_MAX);
  if (raw.gear !== undefined) {
    // Flight Gear levels: whole numbers 0..GEAR_LEVEL_MAX
    const gear = numberMap(raw.gear, GEAR_LEVEL_MAX);
    for (const k of Object.keys(gear)) gear[k] = Math.floor(gear[k]);
    out.gear = gear;
  }
  if (raw.settings !== undefined) out.settings = settingsMap(raw.settings);
  const daily = sanitizeDaily(raw.daily);
  if (daily) out.daily = daily;
  return out;
}
