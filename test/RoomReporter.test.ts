import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { installRoomReporter } from "../src/legion-room-reporter.js";
import { sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

describe("room reporter", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());

  it("reports joinable rooms as not started, so Bloxity does not list them as locked", async () => {
    const env = { ...process.env };
    const realFetch = globalThis.fetch;
    let seen: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      seen = { url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) };
      return { ok: true } as Response;
    }) as typeof fetch;
    try {
      const room = await colyseus.createRoom<WorldState>("world", {});
      await colyseus.connectTo(room, { userId: "guest-a" });
      process.env.BLOXITY_REPORT_TOKEN = "rt";
      process.env.MATCHMAKER_REPORT_URL = "https://mm.test/";
      process.env.BLOXITY_GAME_ID = "fly-over-slime";
      installRoomReporter();
      await sleep(300);
      assert.strictEqual(seen.url, "https://mm.test/fly-over-slime/rooms");
      assert.strictEqual(seen.auth, "Bearer rt");
      const r = seen.body.rooms.find((x: any) => x.colyseusRoomId === room.roomId);
      assert.ok(r, "the room is listed");
      assert.strictEqual(r.clients, 1);
      assert.strictEqual(r.maxClients, 50);
      assert.strictEqual(r.started, false, "never 'started': that makes the directory show it locked");
      assert.strictEqual(r.locked, false);
      assert.strictEqual(r.private, false);
      assert.strictEqual(r.name, "world");
    } finally {
      globalThis.fetch = realFetch;
      process.env = env;
    }
  });
});
