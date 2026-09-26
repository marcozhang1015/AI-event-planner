// 夜间免打扰：发给别人的消息存起来到点再发；回复当前说话的人不受影响。

import { describe, expect, test } from "bun:test";
import { Outbox } from "../src/io/outbox";
import { say } from "../src/out/actions";
import { Store } from "../src/store/db";
import { FakeTransport } from "./harness";

const ALEX = "+15550000001";
const SAM = "+15550000002";

function setUp() {
  const transport = new FakeTransport();
  const sent = transport.sent;
  const clock = { now: new Date("2026-09-25T04:00:00Z") }; // 芝加哥 23:00
  const store = new Store(":memory:");
  const outbox = new Outbox({
    store,
    transport,
    email: { send: async () => {} },
    paceMs: 0,
    timezone: "America/Chicago",
    quietHours: { start: "22:00", end: "08:00" },
    now: () => clock.now,
    log: () => {},
  });
  return { sent, store, outbox, clock };
}

describe("夜间免打扰", () => {
  test("深夜：回复组织者照发，发给 Sam 的存起来；8 点以后才发出去，而且只发一次", async () => {
    const { sent, store, outbox, clock } = setUp();
    await outbox.deliver([say(ALEX, "It's late, so I'll text Sam at 8 AM"), say(SAM, "Hi Sam, it's Juno")], ALEX);
    expect(sent.map((s) => s.to)).toEqual([ALEX]);
    expect([...store.scheduledHandles()]).toEqual([SAM]);

    clock.now = new Date("2026-09-25T12:59:00Z"); // 07:59
    await outbox.flushDue();
    expect(sent.map((s) => s.to)).toEqual([ALEX]);

    clock.now = new Date("2026-09-25T13:01:00Z"); // 08:01
    await outbox.flushDue();
    await outbox.flushDue();
    expect(sent).toEqual([
      { to: ALEX, part: "It's late, so I'll text Sam at 8 AM" },
      { to: SAM, part: "Hi Sam, it's Juno" },
    ]);
    expect(store.scheduledHandles().size).toBe(0);
  });

  test("白天照常发", async () => {
    const { sent, outbox, clock } = setUp();
    clock.now = new Date("2026-09-25T15:00:00Z");
    await outbox.deliver([say(ALEX, "ok"), say(SAM, "Hi Sam")], ALEX);
    expect(sent.map((s) => s.to)).toEqual([ALEX, SAM]);
  });
});
