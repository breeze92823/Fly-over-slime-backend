import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

const quiet = (c: any) => {
  for (const t of ["progress", "noProgress", "leaderboard", "invite", "invitedBy", "friendJoined", "serverError"]) c.onMessage(t, () => {});
};

describe("invites", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("credits the inviter once when a friend joins through their link, live and in the save", async () => {
    const fake = fakePlayers([{ _id: "u1", username: "Ann", wins: 1, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { userId: "u1", username: "Ann" });
    const invites: any[] = [];
    let joinedName = "";
    for (const t of ["progress", "noProgress", "leaderboard"]) a.onMessage(t, () => {});
    a.onMessage("invite", (m: any) => invites.push(m));
    a.onMessage("friendJoined", (m: any) => (joinedName = m.name));
    fake.release();
    await sleep(200);
    assert.deepStrictEqual(invites.at(-1), { joined: 0, sent: 0 });

    const b = await colyseus.connectTo(room, { userId: "u2", username: "Bo", ref: "u1" });
    quiet(b);
    await sleep(300);
    assert.strictEqual(invites.at(-1).joined, 1, "the inviter's boost grows live");
    assert.strictEqual(joinedName, "Bo");
    assert.strictEqual((fake.docs.get("u1") as any).invites, 1);
    assert.strictEqual((fake.docs.get("u2") as any).invitedBy, "u1");

    // The same friend joining again (a new session) is never credited twice.
    await b.leave();
    const b2 = await colyseus.connectTo(room, { userId: "u2", username: "Bo", ref: "u1" });
    quiet(b2);
    await sleep(300);
    assert.strictEqual((fake.docs.get("u1") as any).invites, 1);
    // Nor can anyone credit themselves.
    const s = await colyseus.connectTo(room, { userId: "u1", username: "Ann", ref: "u1" });
    quiet(s);
    await sleep(200);
    assert.strictEqual((fake.docs.get("u1") as any).invites, 1);
  });

  it("credits a friend invited directly through Bloxity when they join", async () => {
    const fake = fakePlayers([{ _id: "u1", username: "Ann", version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    fake.release();
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room, { userId: "u1", username: "Ann" });
    quiet(a);
    await sleep(150);
    a.send("invited", { friendId: "u3" });
    a.send("invited", { friendId: "Bad Id!" });
    await sleep(150);
    assert.deepStrictEqual((fake.docs.get("u1") as any).invitesSent, ["u3"]);

    const c = await colyseus.connectTo(room, { userId: "u3", username: "Cy" });
    quiet(c);
    await sleep(300);
    assert.strictEqual((fake.docs.get("u1") as any).invites, 1);
    assert.strictEqual((fake.docs.get("u3") as any).invitedBy, "u1");
  });

  it("never credits a guest, even one holding an invite link", async () => {
    const fake = fakePlayers([{ _id: "u1", username: "Ann", version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const g = await colyseus.connectTo(room, { userId: "guest-z", ref: "u1" });
    quiet(g);
    fake.release();
    await sleep(250);
    assert.strictEqual(room.state.players.get(g.sessionId)?.signedIn, false);
    assert.strictEqual((fake.docs.get("u1") as any).invites, undefined);
  });
});
