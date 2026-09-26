// 真机彩排用的种子数据：按名字从通讯录找 handle，三个阶段都能载入。

import { describe, expect, test } from "bun:test";
import { Store } from "../src/store/db";
import { seedDemo, type SeedStage } from "../src/demo/seed";

async function seed(stage: SeedStage, contacts = [{ name: "Alex", handle: "+15550000001" }]) {
  const store = new Store(":memory:");
  const result = await seedDemo(store, { stage, contacts, now: new Date("2026-09-24T15:00:00Z"), timezone: "America/Chicago", baseUrl: "https://juno.test", emailFrom: "Juno <juno@example.com>" });
  return { store, ...result };
}

describe("种子数据", () => {
  test("真手机的 handle 从通讯录来，其余的人在模拟器里", async () => {
    const { store, event, links } = await seed("collecting");
    expect(event).toMatchObject({ organizer: "+15550000001", status: "COLLECTING", day: "2026-09-26" });
    expect(store.getMember(event.id, "sim:sam")).toMatchObject({ name: "Sam", simulated: true });
    expect(store.getMember(event.id, "+15550000001")).toMatchObject({ role: "organizer", simulated: false });
    expect(links.map((l) => l.url)).toContain("https://juno.test/o/demo-alex");
    expect(store.getSession("sim:mia")).toMatchObject({ awaiting: "opener" });
  });

  test("ready：全员已确认，还没有方案", async () => {
    const { store, event } = await seed("ready");
    expect(store.answersOf(event.id).every((answer) => answer.confirmed)).toBe(true);
    expect(store.latestPlan(event.id)).toBeUndefined();
  });

  test("published：Plan A 已发布（花生过敏已核实），可以直接演幕 4", async () => {
    const { store, event } = await seed("published");
    expect(event).toMatchObject({ status: "PUBLISHED", published: { label: "A" }, publications: 1 });
    const plan = store.getPlan(event.published!.planId)!;
    expect(plan.options[0]).toMatchObject({ status: "FEASIBLE", dinner: { venueId: "sample:maple-kitchen" } });
    expect(plan.options[0]!.attendees).toHaveLength(5);
    expect(store.verificationsOf(event.id)).toHaveLength(1);
  });
});
