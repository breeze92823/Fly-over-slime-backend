import assert from "assert";

import { CURRENCY_MAX } from "../src/constants.js";
import { sanitizeProgress } from "../src/sanitize.js";

describe("sanitizeProgress", () => {
  it("rejects non-objects and bounds numbers", () => {
    assert.strictEqual(sanitizeProgress(null), null);
    assert.strictEqual(sanitizeProgress([1]), null);
    const out = sanitizeProgress({ wins: 1e40, skill: -5, tokens: NaN, rebirths: 3.7, autoFly: "yes", hack: "x" })!;
    assert.strictEqual(out.wins, CURRENCY_MAX);
    assert.strictEqual(out.skill, 0);
    assert.strictEqual(out.tokens, undefined);
    assert.strictEqual(out.rebirths, 3);
    assert.strictEqual(out.autoFly, undefined);
    assert.ok(!("hack" in out));
  });

  it("keeps well-formed catalog ids and only equips an owned one", () => {
    const out = sanitizeProgress({ slingshots: ["twig", "wrap", "wrap", "Bad Id!", 7], equippedSling: "wrap", trails: ["red"], trail: "blue" })!;
    assert.deepStrictEqual(out.slingshots, ["twig", "wrap"]);
    assert.strictEqual(out.equippedSling, "wrap");
    assert.strictEqual(out.trail, undefined, "an unowned trail is not equipped");
    assert.strictEqual(sanitizeProgress({ trail: "" })!.trail, "");
    assert.strictEqual(sanitizeProgress({ equippedSling: "steel" })!.equippedSling, "steel", "shape only when the list is absent");
  });

  it("keeps well-formed pets and discovered keys", () => {
    const out = sanitizeProgress({
      pets: [
        { uid: 1, id: "pup", tier: "", equipped: true },
        { uid: 2, id: "cat", tier: "x", equipped: true },
        { uid: 3, id: "Bad Id!", tier: "" },
        { uid: 4, id: "fox", tier: "g", equipped: true },
        "x",
      ],
      discovered: ["pup", "pup:g", "pup:z", "Bad Id!", "pup"],
    })!;
    assert.deepStrictEqual(out.pets, [
      { uid: 1, id: "pup", tier: "", equipped: true },
      { uid: 4, id: "fox", tier: "g", equipped: true },
    ]);
    assert.deepStrictEqual(out.discovered, ["pup", "pup:g"]);
  });

  it("bounds maps, daily and settings", () => {
    const out = sanitizeProgress({
      hatchMax: 99,
      potions: { skill: 2.9, "bad id": 1, wins: "x" },
      passes: { wins2x: true, bad: 1 },
      daily: { unlocked: 99, last: 20000, claimed: [0, 0, 3, 99, "1"] },
      settings: { sfx: false, volume: 0.5, name: "x".repeat(99) },
    })!;
    assert.strictEqual(out.hatchMax, 16);
    assert.deepStrictEqual(out.potions, { skill: 2.9 });
    assert.deepStrictEqual(out.passes, { wins2x: true });
    assert.deepStrictEqual(out.daily, { unlocked: 31, last: 20000, claimed: [0, 3] });
    assert.deepStrictEqual(out.settings, { sfx: false, volume: 0.5 });
  });

  it("keeps Flight Gear levels as bounded whole numbers", () => {
    const out = sanitizeProgress({ gear: { dash: 2.7, shield: 999, suit: -3, "bad id": 1, wings: "x" } })!;
    assert.deepStrictEqual(out.gear, { dash: 2, shield: 20, suit: 0 });
  });
});
