import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { AVATAR_MAX_LEN, POSE_BOUNDS, PRESENCE_PETS_MAX } from "../src/constants.js";
import { sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("presence", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());

  it("takes the pose, gear and look from the join options", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, {
      userId: "guest-a",
      pose: { x: 3, y: 0.5, z: -12, yaw: Math.PI, speed: 4 },
      loadout: { boat: "canoe", engine: "ladder-3", trail: "red", partner: "", pets: [{ kind: "dog", tier: 0 }], world: "city" },
      avatar: '{"equipped":{}}',
    });
    await sleep(50);
    const p = room.state.players.get(a.sessionId)!;
    assert.deepStrictEqual([p.x, p.y, p.z, p.speed], [3, 0.5, -12, 4]);
    assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 1e-5);
    assert.deepStrictEqual([p.boat, p.engine, p.trail, p.partner, p.pets, p.world], ["canoe", "ladder-3", "red", "", "dog:0", "city"]);
    assert.strictEqual(p.avatar, '{"equipped":{}}');
  });

  it("bounds poses and gear and relays them to the others", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { userId: "guest-a" });
    const b = await colyseus.connectTo(room, { userId: "guest-b" });
    await sleep(50);
    a.send("pose", { x: 1e9, y: "high", z: -1e12, yaw: 7, speed: -3 });
    const pets = Array.from({ length: 20 }, () => ({ kind: "cat", tier: 1 }));
    a.send("loadout", { boat: "Bad Id!", engine: "basic", trail: "", partner: "jester", pets: [...pets, { kind: "x", tier: 99 }], world: "Bad World!" });
    a.send("setAvatar", { avatar: "x".repeat(AVATAR_MAX_LEN + 1) });
    await sleep(100);
    const p = room.state.players.get(a.sessionId)!;
    assert.strictEqual(p.x, POSE_BOUNDS.xy);
    assert.strictEqual(p.y, 0, "a non-number is ignored");
    assert.strictEqual(p.z, -POSE_BOUNDS.z);
    assert.ok(Math.abs(p.yaw - Math.atan2(Math.sin(7), Math.cos(7))) < 1e-5, "yaw wrapped to -PI..PI");
    assert.strictEqual(p.speed, 0);
    assert.strictEqual(p.boat, "", "a malformed id is ignored");
    assert.strictEqual(p.world, "", "a malformed world is ignored");
    assert.deepStrictEqual([p.engine, p.partner], ["basic", "jester"]);
    assert.strictEqual(p.pets.split(",").length, PRESENCE_PETS_MAX);
    assert.strictEqual(p.avatar, "", "an oversized look is ignored");

    // b's synced copy of the roster sees a's presence.
    const seen = (b.state as any).players.get(a.sessionId);
    assert.strictEqual(seen.engine, "basic");
    assert.strictEqual(seen.x, POSE_BOUNDS.xy);
  });
});
