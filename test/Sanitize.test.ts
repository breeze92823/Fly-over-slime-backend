import assert from "assert";

import { CURRENCY_MAX } from "../src/constants.js";
import { sanitizeProgress } from "../src/sanitize.js";

describe("sanitizeProgress", () => {
  it("rejects non-objects and bounds numbers", () => {
    assert.strictEqual(sanitizeProgress(null), null);
    assert.strictEqual(sanitizeProgress([1]), null);
    const out = sanitizeProgress({ trophies: 1e40, gems: -5, energy: NaN, rebirths: 3.7, autoRebirth: "yes", hack: "x" })!;
    assert.strictEqual(out.trophies, CURRENCY_MAX);
    assert.strictEqual(out.gems, 0);
    assert.strictEqual(out.energy, undefined);
    assert.strictEqual(out.rebirths, 3);
    assert.strictEqual(out.autoRebirth, undefined);
    assert.ok(!("hack" in out));
  });

  it("keeps well-formed catalog ids and only equips an owned one", () => {
    const out = sanitizeProgress({ boats: ["raft", "canoe", "canoe", "Bad Id!", 7], boat: "canoe", engines: ["basic", "ladder-3"], engine: "ladder-9" })!;
    assert.deepStrictEqual(out.boats, ["raft", "canoe"]);
    assert.strictEqual(out.boat, "canoe");
    assert.deepStrictEqual(out.engines, ["basic", "ladder-3"]);
    assert.strictEqual(out.engine, undefined);
    assert.strictEqual(sanitizeProgress({ partner: "" })!.partner, "");
    assert.strictEqual(sanitizeProgress({ trail: "waterRipple" })!.trail, "waterRipple");
  });

  it("keeps well-formed pets and caps the equipped ones at the slots", () => {
    const out = sanitizeProgress({
      petSlots: 2,
      pets: [
        { kind: "dog", tier: 0, equipped: true, locked: false },
        { kind: "cat", tier: 1.5, equipped: true },
        { kind: "Bad Id!", tier: 0 },
        { kind: "fox", tier: 2, equipped: true, locked: true },
        { kind: "bear", tier: 0, equipped: true },
        "x",
      ],
    })!;
    assert.deepStrictEqual(sanitizeProgress({ eggsSeen: ["dog", "dog", "Bad Id!", "dragon"] })!.eggsSeen, ["dog", "dragon"]);
    const worlds = sanitizeProgress({ world: "city", worldsUnlocked: ["city", "city", "Bad Id!"] })!;
    assert.deepStrictEqual([worlds.world, worlds.worldsUnlocked], ["city", ["city"]]);
    assert.strictEqual(sanitizeProgress({ world: "Bad World!" })!.world, undefined);
    assert.deepStrictEqual(out.pets, [
      { kind: "dog", tier: 0, equipped: true, locked: false },
      { kind: "fox", tier: 2, equipped: true, locked: true },
      { kind: "bear", tier: 0, equipped: false, locked: false },
    ]);
  });

  it("bounds the egg hatch upgrade and counter", () => {
    const out = sanitizeProgress({ hatchMax: 99, eggsHatched: 12.8 })!;
    assert.strictEqual(out.hatchMax, 16);
    assert.strictEqual(out.eggsHatched, 12);
    assert.strictEqual(sanitizeProgress({ hatchMax: 0 })!.hatchMax, 1);
    assert.strictEqual(sanitizeProgress({ hatchMax: "8" })!.hatchMax, undefined);
  });

  it("bounds the Online Gifts state", () => {
    const out = sanitizeProgress({ giftTime: -4, giftsClaimed: [0, 0, 3, 99, "1"], potions: { golden: 2.9, "bad id": 1, doubleWin: "x" } })!;
    assert.strictEqual(out.giftTime, 0);
    assert.deepStrictEqual(out.giftsClaimed, [0, 3]);
    assert.deepStrictEqual(out.potions, { golden: 2 });
  });
});
