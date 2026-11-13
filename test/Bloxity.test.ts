import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setFetchForTest, reportId, reportScores, reportStats, scoresFromDoc, statsFromDoc, verifyToken } from "../src/bloxity.js";
import { STAT_DEFS } from "../src/constants.js";
import { __setPlayersForTest } from "../src/db.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("bloxity", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    __setFetchForTest(null);
    __setPlayersForTest(null);
  });

  it("builds board scores from the saved doc and ids the way the report wants", () => {
    assert.deepStrictEqual(scoresFromDoc({ level: 12.7, bestSkill: 5e9, wins: 100, bestDistance: 250.9, rebirths: 0 }), { level: 12, skill: 5e9, wins: 100, distance: 250, rebirths: 0 });
    assert.deepStrictEqual(scoresFromDoc(null), {});
    assert.strictEqual(reportId("abc#m1"), "legion_abc");
    assert.strictEqual(reportId("legion_abc"), "legion_abc");
    assert.strictEqual(reportId("guest-x"), "");
  });

  it("verifies a game token with the platform and treats a refusal as a guest", async () => {
    process.env.BLOXITY_API_URL = "https://api.test";
    let seen: any = null;
    __setFetchForTest(async (url: any, init: any) => {
      seen = { url, init };
      return json({ valid: true, user: { _id: "u9", displayName: "Zed", pfp: "https://x/y.png" } });
    });
    assert.deepStrictEqual(await verifyToken("tok"), { id: "u9", username: "Zed", pfp: "https://x/y.png" });
    assert.strictEqual(seen.url, "https://api.test/v1/auth/game-token/verify");
    assert.strictEqual(seen.init.headers.Authorization, "Bearer tok");
    assert.deepStrictEqual(JSON.parse(seen.init.body), { gameSlug: "fly-over-slime" });
    __setFetchForTest(async () => json({}, false));
    assert.strictEqual(await verifyToken("bad"), null);
    assert.strictEqual(await verifyToken(""), null);
  });

  it("reports signed-in scores to the hosted leaderboard, skipping guests and zeros", async () => {
    process.env.BLOXITY_API_URL = "https://api.test";
    process.env.BLOXITY_REPORT_TOKEN = "rt";
    process.env.BLOXITY_GAME_ID = "fly-over-slime";
    let call: any = null;
    __setFetchForTest(async (url: any, init: any) => {
      call = { url, init, body: JSON.parse(init.body) };
      return json({ ok: true, accepted: call.body.scores.length });
    });
    const n = await reportScores([
      { userId: "u1", scores: { level: 5, wins: 0, skill: 10 } },
      { userId: "guest-a", scores: { level: 9 } },
    ]);
    assert.strictEqual(n, 2);
    assert.strictEqual(call.url, "https://api.test/v1/leaderboards/hosted/fly-over-slime/report");
    assert.strictEqual(call.init.headers.Authorization, "Bearer rt");
    assert.deepStrictEqual(call.body.scores, [
      { board: "level", userId: "legion_u1", score: 5 },
      { board: "skill", userId: "legion_u1", score: 10 },
    ]);
    assert.deepStrictEqual(call.body.boards.map((b: any) => b.id), ["level", "skill", "wins", "distance", "rebirths"]);
    assert.ok(!("stat" in call.body.boards[0]));
    process.env.BLOXITY_REPORT_TOKEN = "";
    assert.strictEqual(await reportScores([{ userId: "u1", scores: { level: 5 } }]), 0, "no token: nothing is sent");
  });

  it("builds stat values from the saved doc, clamped to Bloxity's ceilings", () => {
    const v = statsFromDoc({
      level: 12.7,
      bestSkill: 5e20, // over the currency ceiling: clamped, because Bloxity rejects rather than clamps
      wins: 100,
      rebirths: 3,
      bestDistance: 250.9,
      flights: 7,
      playTime: 3600.5,
      stats: { hatched: 40, chests: 6 },
      pets: [{ uid: 1, id: "pup", tier: "", equipped: true }, { uid: 2, id: "cat", tier: "g", equipped: false }],
    });
    assert.deepStrictEqual(v, { level: 12, best_skill: 1e12, wins: 100, rebirths: 3, best_distance: 250, flights: 7, eggs_hatched: 40, pets_owned: 2, chests_opened: 6, play_time: 3600 });
    assert.deepStrictEqual(statsFromDoc({ wins: -5, level: NaN }), {}, "negative / non-finite values are left out");
    assert.deepStrictEqual(statsFromDoc(null), {});
    for (const d of STAT_DEFS) assert.ok(/^[a-z0-9_]{1,32}$/.test(d.key) && d.label.length <= 40, d.key);
    assert.ok(STAT_DEFS.length <= 50);
  });

  it("reports stats to the game's stats endpoint with the definitions, skipping guests", async () => {
    process.env.BLOXITY_API_URL = "https://api.test";
    process.env.BLOXITY_REPORT_TOKEN = "rt";
    process.env.BLOXITY_GAME_ID = "fly-over-slime";
    let call: any = null;
    __setFetchForTest(async (url: any, init: any) => {
      call = { url, init, body: JSON.parse(init.body) };
      return json({ ok: true, accepted: call.body.players.length });
    });
    const n = await reportStats([
      { userId: "u1#m3", values: { level: 5, wins: 9 } },
      { userId: "guest-a", values: { level: 1 } },
      { userId: "u2", values: {} },
    ]);
    assert.strictEqual(n, 1);
    assert.strictEqual(call.url, "https://api.test/v1/games/fly-over-slime/stats");
    assert.strictEqual(call.init.headers.Authorization, "Bearer rt");
    assert.deepStrictEqual(call.body.players, [{ userId: "legion_u1", values: { level: 5, wins: 9 } }]);
    assert.strictEqual(call.body.definitions.length, STAT_DEFS.length);
    assert.deepStrictEqual(Object.keys(call.body.definitions[0]).sort(), ["key", "label", "sortOrder", "type"]);
    process.env.BLOXITY_REPORT_TOKEN = "";
    assert.strictEqual(await reportStats([{ userId: "u1", values: { level: 5 } }]), 0, "no token: nothing is sent");
  });

  describe("in the room", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;
    before(async () => (colyseus = await testServer()));
    beforeEach(async () => await colyseus.cleanup());

    it("trusts only a verified token when deployed, and exposes uid + emotes on the roster", async () => {
      process.env.BLOXITY_API_URL = "https://api.test";
      __setFetchForTest(async (_u: any, init: any) => (init.headers.Authorization === "Bearer good" ? json({ valid: true, user: { _id: "acct1", displayName: "Real" } }) : json({}, false)));
      const fake = fakePlayers();
      __setPlayersForTest(fake);
      fake.release();
      const room = await colyseus.createRoom<WorldState>("world", {});
      const a = await colyseus.connectTo(room, { userId: "forged-id", token: "good", username: "x" });
      const b = await colyseus.connectTo(room, { userId: "forged-id", token: "nope" });
      for (const c of [a, b]) for (const t of ["noProgress", "progress", "leaderboard"]) c.onMessage(t, () => {});
      await sleep(250);
      const pa = room.state.players.get(a.sessionId)!;
      const pb = room.state.players.get(b.sessionId)!;
      assert.strictEqual(pa.uid, "acct1");
      assert.strictEqual(pa.username, "Real");
      assert.strictEqual(pa.signedIn, true);
      assert.strictEqual(pb.uid, "", "a bad token plays as a guest: the client-sent id is ignored");
      a.send("saveProgress", { wins: 5 });
      b.send("saveProgress", { wins: 7 });
      await sleep(150);
      assert.deepStrictEqual([...fake.docs.keys()], ["acct1"]);

      a.send("emote", { id: "wave" });
      b.send("emote", { id: "Bad Id!" });
      await sleep(100);
      assert.strictEqual(pa.emote, "wave");
      assert.ok(pa.emoteAt > 0);
      assert.strictEqual(pb.emote, "", "a malformed emote id is ignored");
      a.send("emote", { id: "" });
      await sleep(80);
      assert.deepStrictEqual([pa.emote, pa.emoteAt], ["", 0]);
    });
  });
});
