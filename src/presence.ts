import { AVATAR_MAX_LEN, EMOTE_PATTERN, ID_PATTERN, POSE_BOUNDS, PRESENCE_PETS_MAX, PET_TIERS } from "./constants.js";
import type { PlayerState } from "./rooms/schema/WorldState.js";

// Presence: what the other clients need to draw a player in the world (client remotePlayers.js).
// Relayed through the roster as sent, only bounded here -- like the rest of the game it is
// client-authoritative and purely cosmetic.

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isId = (v: unknown): v is string => typeof v === "string" && ID_PATTERN.test(v);

// `pose` { x, y, z, yaw, speed, vy, grounded, flying, pitch, roll, training }: the feet position
// (m), heading (rad), ground speed (m/s), vertical speed and grounded flag (they drive the run /
// jump / land animation on the receiving side), `flying` + the flight body tilt (`pitch` is the
// forward somersault angle, `roll` the bank, rad) and `training` (pulling the slingshot).
export function applyPose(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  const b = POSE_BOUNDS;
  if (finite(m.x)) p.x = clamp(m.x, -b.xy, b.xy);
  if (finite(m.y)) p.y = clamp(m.y, -b.xy, b.xy);
  if (finite(m.z)) p.z = clamp(m.z, -b.z, b.z);
  if (finite(m.yaw)) p.yaw = Math.atan2(Math.sin(m.yaw), Math.cos(m.yaw));
  if (finite(m.speed)) p.speed = clamp(m.speed, 0, b.speed);
  if (finite(m.vy)) p.vy = clamp(m.vy, -b.speed, b.speed);
  if (typeof m.grounded === "boolean") p.grounded = m.grounded;
  if (typeof m.flying === "boolean") p.flying = m.flying;
  if (typeof m.training === "boolean") p.training = m.training;
  if (finite(m.pitch)) p.pitch = clamp(m.pitch, -100, 100);
  if (finite(m.roll)) p.roll = clamp(m.roll, -4, 4);
}

// `loadout` { sling, trail, title, pets: [{ id, tier }] }: equipped catalog ids ("" = none) and the
// equipped pets. Pets travel as "id" / "id:g" / "id:d" joined by commas, capped at PRESENCE_PETS_MAX.
export function applyLoadout(p: PlayerState, msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as Record<string, unknown>;
  for (const key of ["sling", "trail", "title"] as const) {
    const v = m[key];
    if (v === "" || isId(v)) p[key] = v as string;
  }
  if (Array.isArray(m.pets)) {
    const pets: string[] = [];
    for (const pet of m.pets) {
      if (pets.length >= PRESENCE_PETS_MAX) break;
      const id = (pet as { id?: unknown })?.id;
      const tier = (pet as { tier?: unknown })?.tier;
      if (isId(id) && typeof tier === "string" && (PET_TIERS as readonly string[]).includes(tier)) pets.push(tier ? `${id}:${tier}` : id);
    }
    p.pets = pets.join(",");
  }
}

// `emote` { id }: a Bloxity emote the player started from the portal's emote wheel ("" stops it);
// stamped with the server clock so late joiners start it at the right point.
export function applyEmote(p: PlayerState, msg: unknown, now = Date.now()): void {
  const id = (msg as { id?: unknown })?.id;
  if (typeof id !== "string" || !EMOTE_PATTERN.test(id)) return;
  p.emote = id;
  p.emoteAt = id ? now : 0;
}

// `setAvatar` { avatar }: the Bloxity look (equipped cosmetics, proportions, skin texture) as an
// opaque JSON string ("" = default), length-capped, never parsed here.
export function applyAvatar(p: PlayerState, msg: unknown): void {
  const a = (msg as { avatar?: unknown })?.avatar;
  if (typeof a === "string" && a.length <= AVATAR_MAX_LEN) p.avatar = a;
}
