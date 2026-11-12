import { AVATAR_MAX_LEN, ID_PATTERN, POSE_BOUNDS, PRESENCE_PETS_MAX, PET_TIERS_MAX } from "./constants.js";
import type { PlayerState } from "./rooms/schema/WorldState.js";

// Presence: what the other clients need to draw a player in the world (client remotePlayers.js).
// Relayed through the roster as sent, only bounded here -- like the rest of the game it is
// client-authoritative and purely cosmetic.

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

// `pose` { x, y, z, yaw, speed }: the boat's feet position in TRACK coordinates (z minus the
// sender's race scroll, so racers line up in everyone's lane), heading (rad) and speed (m/s).
export function applyPose(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  const b = POSE_BOUNDS;
  if (finite(m.x)) p.x = clamp(m.x, -b.xy, b.xy);
  if (finite(m.y)) p.y = clamp(m.y, -b.xy, b.xy);
  if (finite(m.z)) p.z = clamp(m.z, -b.z, b.xy);
  if (finite(m.yaw)) p.yaw = Math.atan2(Math.sin(m.yaw), Math.cos(m.yaw));
  if (finite(m.speed)) p.speed = clamp(m.speed, 0, b.speed);
}

// `loadout` { boat, engine, trail, partner, pets: [{ kind, tier }], world }: equipped catalog ids
// ("" = none) and the world the player is in (clients only draw players in their own world). Pets travel as "kind:tier" joined by commas, capped at PRESENCE_PETS_MAX.
export function applyLoadout(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  for (const key of ["boat", "engine", "trail", "partner", "world"] as const) {
    const v = m[key];
    if (v === "" || isId(v)) p[key] = v as string;
  }
  if (Array.isArray(m.pets)) {
    const pets: string[] = [];
    for (const pet of m.pets) {
      if (pets.length >= PRESENCE_PETS_MAX) break;
      const k = (pet as { kind?: unknown })?.kind;
      const t = (pet as { tier?: unknown })?.tier;
      if (isId(k) && Number.isInteger(t) && (t as number) >= 0 && (t as number) < PET_TIERS_MAX) pets.push(`${k}:${t}`);
    }
    p.pets = pets.join(",");
  }
}

// `setAvatar` { avatar }: the Bloxity look as an opaque JSON string ("" = default), length-capped.
export function applyAvatar(p: PlayerState, msg: unknown): void {
  const a = (msg as { avatar?: unknown })?.avatar;
  if (typeof a === "string" && a.length <= AVATAR_MAX_LEN) p.avatar = a;
}
