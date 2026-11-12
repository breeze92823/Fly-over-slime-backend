import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { DAILY_DAYS } from "../src/constants.js";
import { claimDaily, readDaily, rollDaily, utcDay } from "../src/daily.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("daily reward rules", () => {
  it("unlocks one day per new UTC day and starts over once every day is claimed", () => {
    const s = readDaily(null);
    assert.ok(rollDaily(s, 100));
    assert.deepStrictEqual(s, { day: 1, last: 100, claimed: [] });
    assert.ok(!rollDaily(s, 100), "once per day");
    assert.ok(rollDaily(s, 105), "days need not be consecutive");
    assert.strictEqual(s.day, 2);
    for (let d = 106; d < 120; d++) rollDaily(s, d);
    assert.strictEqual(s.day, DAILY_DAYS, "capped while days are unclaimed");
    for (let i = 0; i < DAILY_DAYS; i++) assert.ok(claimDaily(s, i));
    assert.ok(rollDaily(s, 120));
    assert.deepStrictEqual(s, { day: 1, last: 120, claimed: [] });
  });

  it("only claims unlocked, unclaimed days and bounds a stored state", () => {
    const s = readDaily({ dailyDay: 2, dailyLast: 7, dailyClaimed: [0, 0, 5, -1, 1.5] as number[] });
    assert.deepStrictEqual(s.claimed, [0]);
    assert.ok(!claimDaily(s, 0), "already claimed");
    assert.ok(!claimDaily(s, 2), "not unlocked yet");
    assert.ok(!claimDaily(s, "1"));
    assert.ok(claimDaily(s, 1));
    assert.ok(!rollDaily(s, 6), "a clock going back unlocks nothing");
    assert.strictEqual(readDaily({ dailyDay: 99 }).day, DAILY_DAYS);
  });
});

describe("daily reward room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("unlocks today on join, stores claims and refuses a second claim", async () => {
    const today = utcDay();
    const fake = fakePlayers([{ _id: "d1", dailyDay: 1, dailyLast: today - 1, dailyClaimed: [0], version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "d1" });
    let daily: any = null;
    const results: any[] = [];
    c.onMessage("progress", () => {});
    c.onMessage("daily", (m: any) => (daily = m));
    c.onMessage("dailyResult", (m: any) => results.push(m));
    fake.release();
    await sleep(150);
    assert.strictEqual(daily?.unlocked, 2);
    assert.deepStrictEqual(daily?.claimed, [0]);
    assert.strictEqual(daily?.nextAt, (today + 1) * 86_400_000);
    assert.strictEqual((fake.docs.get("d1") as any).dailyLast, today);

    c.send("claimDaily", { day: 1 });
    c.send("claimDaily", { day: 1 });
    c.send("claimDaily", { day: 2 });
    await sleep(150);
    // The good claim answers after its write, so the refusals may come first.
    assert.strictEqual(results.length, 3);
    assert.deepStrictEqual(results.filter((r) => r.ok).map((r) => r.day), [1]);
    assert.deepStrictEqual((fake.docs.get("d1") as any).dailyClaimed, [0, 1]);

    // saveProgress can't touch the server-owned fields.
    c.send("saveProgress", { trophies: 1, dailyDay: 7, dailyClaimed: [] });
    await sleep(150);
    assert.strictEqual((fake.docs.get("d1") as any).dailyDay, 2);
    assert.deepStrictEqual((fake.docs.get("d1") as any).dailyClaimed, [0, 1]);
  });

  it("gives a guest a session-only calendar", async () => {
    const fake = fakePlayers();
    __setPlayersForTest(fake);
    fake.release();
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "guest-q" });
    let result: any = null;
    c.onMessage("noProgress", () => {});
    c.onMessage("daily", () => {});
    c.onMessage("dailyResult", (m: any) => (result = m));
    await sleep(150);
    c.send("claimDaily", { day: 0 });
    await sleep(150);
    assert.strictEqual(result?.ok, true);
    assert.strictEqual(fake.docs.size, 0, "a guest is never written");
  });
});
