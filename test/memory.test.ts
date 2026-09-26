// 跨活动记忆：只记确认过的；下次只当提议，本人确认才用；只在本人私聊里用；"forget me" 就删。

import { describe, expect, test } from "bun:test";
import { organizerView } from "../src/out/privacy";
import { prefill } from "../src/core/memory";
import type { Answer, Person, Place } from "../src/shared/types";
import { ALEX, Harness, SAM, textsTo, VIEWS } from "./harness";

/** 第一次活动：Sam 答完四个问题、确认、留邮箱。 */
async function firstEvent(h: Harness) {
  await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
  await h.send(ALEX, "2-10");
  await h.send(ALEX, "yes");
  await h.send(ALEX, "sam");
  for (const text of ["sure", "after 3", "peanuts", "need a ride, I'm near the library", "yeah", "yep", "sam@example.com"]) await h.send(SAM, text);
  await h.send(ALEX, "nope"); // 组织者只组织，不参加
}

/** 之后的另一场活动：Alex 又发起、又邀请 Sam。返回 Sam 收到的开场白。 */
async function secondEvent(h: Harness): Promise<string | undefined> {
  h.store.saveSession({ handle: ALEX }); // 上一场结束了
  await h.send(ALEX, "plan a picnic + dinner sunday near campus, max $30 each");
  await h.send(ALEX, "12-8");
  await h.send(ALEX, "yes");
  return textsTo(await h.send(ALEX, "sam"), SAM)[0];
}

describe("跨活动记忆", () => {
  test("第一次：摘要里先告诉本人会记住；确认后只记偏好，不记时间和预算", async () => {
    const h = new Harness();
    await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
    await h.send(ALEX, "2-10");
    await h.send(ALEX, "yes");
    await h.send(ALEX, "sam");
    for (const text of ["sure", "after 3", "peanuts", "need a ride, I'm near the library"]) await h.send(SAM, text);

    const summary = textsTo(await h.send(SAM, "yeah"), SAM)[0];
    expect(summary).toContain("I'll also remember your food and ride details for next time (say “forget me” to undo).");
    expect(h.store.getPerson(SAM)).toBeUndefined(); // 确认之前不记

    await h.send(SAM, "yep");
    await h.send(SAM, "sam@example.com");
    const person = h.store.getPerson(SAM);
    expect(person).toMatchObject({ allergies: ["peanuts"], drives: "no", pickupPlaceId: "sample:main-library", email: "sam@example.com" });
    expect(person).not.toHaveProperty("budgetCapCents");
    expect(person).not.toHaveProperty("free");
  });

  test("下一场活动：先预填、一句话确认，少问三个问题，也不再问邮箱", async () => {
    const h = new Harness();
    await firstEvent(h);

    expect(await secondEvent(h)).toEndWith("I remember your details from last time, so this'll be quick — got a sec?");
    expect(textsTo(await h.send(SAM, "sure"), SAM)).toEqual(["What part of Sunday 12–8 PM are you free?"]);
    expect(textsTo(await h.send(SAM, "after 2"), SAM)).toEqual([
      "From last time I have: allergic to peanuts · needs a ride from Main Library (north entrance). Still right?",
    ]);
    expect(textsTo(await h.send(SAM, "yep"), SAM)).toEqual(["Last one: Alex set $30/person as the max. Does that work for you?"]);

    const summary = textsTo(await h.send(SAM, "yeah"), SAM)[0];
    expect(summary).toContain("• Allergic to peanuts");
    expect(summary).not.toContain("remember"); // 已经告诉过一次

    const done = await h.send(SAM, "yep");
    expect(textsTo(done, SAM)).toEqual(["Perfect. I'll text you as soon as the plan is set."]);
    const second = h.store.listEvents()[1]!;
    expect(h.store.getAnswer(second.id, SAM)).toMatchObject({ confirmed: true, remembered: false, allergies: ["peanuts"], budgetCapCents: 3000 });
  });

  test("本人说不对：清掉预填，一项项重新问", async () => {
    const h = new Harness();
    await firstEvent(h);
    await secondEvent(h);
    await h.send(SAM, "sure");
    await h.send(SAM, "after 2");

    expect(textsTo(await h.send(SAM, "no"), SAM)).toEqual(["Any food allergies or things you don't eat?"]);
    const answer = h.store.getAnswer(h.store.listEvents()[1]!.id, SAM);
    expect(answer?.allergies).toBeUndefined();
    expect(answer?.drives).toBeUndefined();
  });

  test("只改其中一项：其余沿用", async () => {
    const h = new Harness();
    await firstEvent(h);
    await secondEvent(h);
    await h.send(SAM, "sure");
    await h.send(SAM, "after 2");

    expect(textsTo(await h.send(SAM, "no, I can drive now, 3 seats"), SAM)[0]).toStartWith("Last one:");
    expect(h.store.getAnswer(h.store.listEvents()[1]!.id, SAM)).toMatchObject({ remembered: false, drives: "yes", seats: 3, allergies: ["peanuts"] });
  });

  test("组织者看不到还没确认的记忆", async () => {
    const h = new Harness();
    await firstEvent(h);
    await secondEvent(h);
    const view = organizerView(h.reader(), h.store.listEvents()[1]!, VIEWS);
    expect(view.aggregates.allergies).toEqual([]);
    expect(view.members.find((member) => member.name === "Sam")?.status).toBe("invited");
  });

  test("forget me：删掉记忆，下一场按新人对待", async () => {
    const h = new Harness();
    await firstEvent(h);
    expect(textsTo(await h.send(SAM, "forget me"), SAM)).toEqual(["Done — I've forgotten your saved details. This plan still has what you told me."]);
    expect(h.store.getPerson(SAM)).toBeUndefined();
    expect(h.store.getAnswer(h.store.listEvents()[0]!.id, SAM)?.confirmed).toBe(true); // 这次活动不受影响

    expect(await secondEvent(h)).toEndWith("Got a sec for a few quick questions?");
  });

  test("记住的集合点离新活动太远（换了城市）就不预填", () => {
    const answer: Answer = { eventId: "evt", handle: SAM, confirmed: false, version: 0 };
    const person: Person = { handle: SAM, allergies: [], drives: "no", pickupQuery: "the library", pickupPlaceId: "far", updatedAt: "" };
    const farAway: Place = { id: "far", name: "Library", lat: 40.7128, lng: -74.006, source: "sample" };
    const area = { label: "near campus", lat: 39.8283, lng: -98.5795, radiusKm: 15 };
    expect(prefill(answer, person, area, farAway)).toMatchObject({ remembered: true, drives: "no", pickupPlaceId: undefined });
  });
});
