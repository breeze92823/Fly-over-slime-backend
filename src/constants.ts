// Keep in step with the client's src/config.js by hand.
export const ROOM_MAX_CLIENTS = 50;

// Longest accepted strings.
export const NAME_MAX = 64;
// Profile picture URL (Bloxity `pfp`), relayed so other players can draw it.
export const PFP_MAX_LEN = 512;
// Presence (presence.ts): the Bloxity avatar JSON relayed for the others to draw, the most pets
// drawn per player, and the pose bounds (|x| and y up to `xy` m, z within +-`z` m: the slime river
// runs far down -Z; speed in m/s).
export const AVATAR_MAX_LEN = 3000;
export const PRESENCE_PETS_MAX = 8;
export const POSE_BOUNDS = { xy: 5000, z: 100000, speed: 2000 };

// Colyseus drops the whole connection for a WebSocket message above this (default 4 KB).
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// How long a dropped connection (WiFi blip, backgrounded tab) may reconnect with the same session.
export const RECONNECT_SECONDS = 20;

// Upper bounds for saved values, so a forged payload cannot store a bogus number. Generous
// ceilings, not game rules.
export const CURRENCY_MAX = 1e33; // Wins, Skill, tokens
export const REBIRTHS_MAX = 1e9;
export const COUNT_MAX = 1e12; // flights, hatched, level, uid counters, ...
export const DISTANCE_MAX = 1e15; // personal best flight, metres
export const PLAY_SECONDS_MAX = 31_536_000 * 10; // ~10 years

// Owned catalog ids (client SLINGSHOTS ~12, PLATFORMS 7, TRAILS ~30), with slack.
export const OWNED_MAX = 256;
// Pets (client state.pets): at most PETS_MAX owned. Tiers are '' (basic), 'g' (golden), 'd' (diamond).
export const PETS_MAX = 1000;
export const PET_TIERS = ["", "g", "d"] as const;
export const PET_SLOTS_MAX = 50;
// Index (`discovered`): pet id + optional ":g" / ":d". Bounded count.
export const DISCOVERED_MAX = 1000;
// Eggs: the most eggs one Open Max can hatch (the +16 upgrade).
export const HATCH_MAX = 16;
// Flight Gear levels (client config GEAR: at most 5 levels per item today).
export const GEAR_LEVEL_MAX = 20;
// Free-form id -> number / bool maps (passes, potions, stats, settings): most keys kept.
export const MAP_KEYS_MAX = 64;
// Daily Reward (client DAILY): claimed days per cycle.
export const DAILY_DAYS = 31;
export const SETTING_STRING_MAX = 32;

// Leaderboards (leaderboard.ts; client game.js boards): the saved doc fields ranked, rows per board
// and how often the lists are re-read and re-sent.
export const LEADERBOARD_STATS = ["bestSkill", "playTime", "level", "wins"] as const;
export type LeaderboardStat = (typeof LEADERBOARD_STATS)[number];
export const LEADERBOARD_SIZE = 10;
export const LEADERBOARD_EVERY_MS = 60 * 1000;

// Ids from the client's catalogs (slingshots, pets, trails, titles, ...): slugs, so nothing odd is stored.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// The client's per-browser fallback id for players who are not signed in to Bloxity.
// Guests are never persisted.
export const GUEST_ID_PREFIX = "guest-";

// --- Bloxity integrations (bloxity.ts, presence.ts) -----------------------------------------------
// Hosted leaderboards: the boards the server reports from each signed-in player's save (the client's
// bloxity.js LEADERBOARDS must declare the same ids), how many scores per report call and how often.
// `stat` = the PlayerDoc field a board reads.
export const LB_BOARDS = [
  { id: "level", label: "Level", order: "desc", mode: "best", format: "number", reset: "none", stat: "level" },
  { id: "skill", label: "Best Skill", order: "desc", mode: "best", format: "compact", reset: "none", stat: "bestSkill" },
  { id: "wins", label: "Wins", order: "desc", mode: "best", format: "compact", reset: "none", stat: "wins" },
  { id: "distance", label: "Longest Flight (m)", order: "desc", mode: "best", format: "number", reset: "none", stat: "bestDistance" },
  { id: "rebirths", label: "Rebirths", order: "desc", mode: "best", format: "number", reset: "none", stat: "rebirths" },
] as const;
export const LB_REPORT_MAX = 200;
export const LB_REPORT_EVERY_MS = 30 * 1000;
// The emote a player plays (roster `emote`: a Bloxity emote catalogue id, `emoteAt` = server ms it
// started; "" = none) and the shape of a Bloxity account id (roster `uid`, for chat bubbles).
export const EMOTE_PATTERN = /^[A-Za-z0-9_-]{0,48}$/;
export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Bloxity game stats (bloxity.ts reportStats; docs.bloxity.io "Report your game's stats"): shown on the
// player's Bloxity profile and usable by missions. `key` = lowercase a-z 0-9 _ (max 32), `type` only
// formats; `stat` reads a PlayerDoc field (or "stats.<k>" / "pets.length"). Bloxity REJECTS (never
// clamps) a value above its type's ceiling (number 1e9, seconds 3.1536e10, currency 1e12, percent 100),
// so the server clamps to STAT_CEILING first. At most 50 definitions; 200 players per call; ~every 60 s.
export const STAT_DEFS = [
  { key: "level", label: "Level", type: "number", sortOrder: 1, from: "level" },
  { key: "best_skill", label: "Best Skill", type: "currency", sortOrder: 2, from: "bestSkill" },
  { key: "wins", label: "Wins", type: "currency", sortOrder: 3, from: "wins" },
  { key: "rebirths", label: "Rebirths", type: "number", sortOrder: 4, from: "rebirths" },
  { key: "best_distance", label: "Longest Flight (m)", type: "number", sortOrder: 5, from: "bestDistance" },
  { key: "flights", label: "Flights", type: "number", sortOrder: 6, from: "flights" },
  { key: "eggs_hatched", label: "Eggs Hatched", type: "number", sortOrder: 7, from: "stats.hatched" },
  { key: "pets_owned", label: "Pets Owned", type: "number", sortOrder: 8, from: "pets.length" },
  { key: "chests_opened", label: "Chests Opened", type: "number", sortOrder: 9, from: "stats.chests" },
  { key: "play_time", label: "Play Time", type: "seconds", sortOrder: 10, from: "playTime" },
] as const;
export const STAT_CEILING = { number: 1e9, seconds: 31_536_000_000, currency: 1e12, percent: 100 } as const;
export const STATS_REPORT_MAX = 200;
export const STATS_REPORT_EVERY_MS = 60 * 1000;

// Invites (invite.ts): the most direct invites remembered per player and the friends-joined ceiling.
export const INVITES_SENT_MAX = 200;
export const INVITES_MAX = 1e6;
