import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest, type PlayerDoc } from "../src/db.js";
import { SPIN_CAP, SPIN_EVERY_MS, SPIN_START, SPIN_WEDGES } from "../src/constants.js";
import { accrue, rollWedge, spinStateFrom } from "../src/spin.js";
import { testServer } from "./server.js";
import { fakePlayers, sleep } from "./fakePlayers.js";

describe("spin wheel", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("accrues one free spin per interval up to the cap", () => {
    const s = { spins: 0, nextAt: 1000 };
    accrue(s, 999);
    assert.strictEqual(s.spins, 0);
    accrue(s, 1000 + SPIN_EVERY_MS);
    assert.strictEqual(s.spins, 2);
    assert.strictEqual(s.nextAt, 1000 + 2 * SPIN_EVERY_MS);
    accrue(s, 1e15);
    assert.strictEqual(s.spins, SPIN_CAP);
    assert.strictEqual(s.nextAt, 1e15 + SPIN_EVERY_MS, "the clock waits while capped");
  });

  it("starts new players with SPIN_START spins and caps a bogus saved clock", () => {
    assert.strictEqual(spinStateFrom(null, 0).spins, SPIN_START);
    const s = spinStateFrom({ spins: 0, spinAt: 1e18 }, 5000);
    assert.strictEqual(s.nextAt, 5000 + SPIN_EVERY_MS);
  });

  it("rolls wedges by weight", () => {
    assert.strictEqual(rollWedge(0).id, SPIN_WEDGES[0].id);
    assert.strictEqual(rollWedge(0.9999999).id, "hugePet");
    assert.strictEqual(rollWedge(0.36).id, "wins50");
  });

  it("spends a spin, rolls the prize on the server and saves the count", async () => {
    const fake = fakePlayers([{ _id: "s1", trophies: 5, spins: 2, spinAt: Date.now() + 60_000, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "s1" });
    const got: any[] = [];
    let state: any = null;
    c.onMessage("progress", () => {});
    c.onMessage("spins", (m: any) => (state = m));
    c.onMessage("spinResult", (m: any) => got.push(m));
    c.onMessage("daily", () => {});
    fake.release();
    await sleep(150);
    assert.strictEqual(state?.spins, 2);

    c.send("spin");
    c.send("spin");
    c.send("spin");
    await sleep(200);
    assert.strictEqual(got.length, 3);
    assert.ok(got[0].ok && got[1].ok);
    assert.ok(SPIN_WEDGES.some((w) => w.id === got[0].id));
    assert.strictEqual(got[1].spins, 0);
    assert.deepStrictEqual([got[2].ok, got[2].reason], [false, "none"]);
    assert.strictEqual(fake.docs.get("s1")?.spins, 0);
    assert.strictEqual(fake.docs.get("s1")?.trophies, 5, "the rest of the save is untouched");

    // A client save can't hand itself spins.
    c.send("saveProgress", { spins: 99, spinAt: 0 });
    await sleep(150);
    assert.strictEqual(fake.docs.get("s1")?.spins, 0);
  });

  it("lets a guest spin without saving anything", async () => {
    const fake = fakePlayers();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "guest-q" });
    let res: any = null;
    c.onMessage("noProgress", () => {});
    c.onMessage("spins", () => {});
    c.onMessage("spinResult", (m: any) => (res = m));
    c.onMessage("daily", () => {});
    fake.release();
    await sleep(150);
    c.send("spin");
    await sleep(150);
    assert.ok(res?.ok);
    assert.strictEqual(res.spins, SPIN_START - 1);
    assert.strictEqual(fake.docs.size, 0);
  });
});
