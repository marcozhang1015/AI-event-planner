// ChangeSet 是乐观事务：提交时发现读过或要写的行被别的回合先改了，就抛 StaleWriteError。

import { describe, expect, test } from "bun:test";
import { Store } from "../src/store/db";
import { ChangeSet, StaleWriteError } from "../src/store/changes";
import type { Event } from "../src/shared/types";

function setUp() {
  const store = new Store(":memory:");
  const event: Event = { id: "evt", organizer: "alex", title: "dinner", status: "COLLECTING", timezone: "UTC", candidateVenueIds: [], inputVersion: 1, createdAt: "" };
  store.saveEvent(event);
  return { store, event };
}

describe("乐观事务", () => {
  test("别人先改了同一行：提交失败，什么都不写", () => {
    const { store, event } = setUp();
    const sam = new ChangeSet(store);
    const organizer = new ChangeSet(store);
    sam.putEvent({ ...sam.event("evt")!, inputVersion: 2 });
    sam.putAnswer({ eventId: "evt", handle: "sam", confirmed: true, version: 1 });
    organizer.putEvent({ ...organizer.event("evt")!, status: "REVIEW" });
    organizer.commit();
    expect(() => sam.commit()).toThrow(StaleWriteError);
    expect(store.getEvent("evt")).toEqual({ ...event, status: "REVIEW" });
    expect(store.getAnswer("evt", "sam")).toBeUndefined();
  });

  test("只读过、没写的行不比对；地点这类参考数据也不比对", () => {
    const { store } = setUp();
    const turn = new ChangeSet(store);
    turn.event("evt");
    turn.putPlace({ id: "p1", name: "Library", lat: 0, lng: 0, source: "sample" });
    store.saveEvent({ ...store.getEvent("evt")!, status: "REVIEW" });
    store.savePlace({ id: "p1", name: "Library", lat: 0, lng: 0, source: "sample" });
    turn.putAnswer({ eventId: "evt", handle: "sam", confirmed: false, version: 0 });
    expect(() => turn.commit()).not.toThrow();
    expect(store.getAnswer("evt", "sam")).toBeDefined();
  });

  test("列表里读到的行也记下原样；暂存的改动叠在列表上", () => {
    const { store } = setUp();
    store.saveMember({ eventId: "evt", handle: "sam", name: "Sam", linkToken: "t1", role: "attendee", status: "invited", simulated: false });
    const turn = new ChangeSet(store);
    const [sam] = turn.membersOf("evt");
    turn.putMember({ ...sam!, status: "confirmed" });
    turn.putMember({ eventId: "evt", handle: "mia", name: "Mia", linkToken: "t2", role: "attendee", status: "invited", simulated: false });
    expect(turn.membersOf("evt").map((m) => [m.name, m.status])).toEqual([
      ["Sam", "confirmed"],
      ["Mia", "invited"],
    ]);
    store.saveMember({ ...sam!, email: "sam@example.com" });
    expect(() => turn.commit()).toThrow(StaleWriteError);
  });

  test("commit 的回调和写入在同一个事务里：回调失败就都不写", () => {
    const { store } = setUp();
    const turn = new ChangeSet(store);
    turn.putEvent({ ...turn.event("evt")!, inputVersion: 9 });
    expect(() =>
      turn.commit(() => {
        throw new Error("mark handled failed");
      }),
    ).toThrow("mark handled failed");
    expect(store.getEvent("evt")?.inputVersion).toBe(1);
  });

  test("forget me：这一轮删掉的人读出来是 undefined，提交后库里也没有", () => {
    const { store } = setUp();
    store.savePerson({ handle: "sam", allergies: [], updatedAt: "" });
    const turn = new ChangeSet(store);
    turn.forgetPerson("sam");
    expect(turn.person("sam")).toBeUndefined();
    turn.commit();
    expect(store.getPerson("sam")).toBeUndefined();
  });
});
