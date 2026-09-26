// LLM 关掉（offlineBrain）时，§4.3 流程 1–2 靠规则解析和模板也要能走通。

import { describe, expect, test } from "bun:test";
import { offlineBrain, type Brain } from "../src/brain/extract";
import { organizerView } from "../src/core/privacy";
import { ALEX, Harness, SAM, textsTo } from "./harness";

async function setUpEvent(h: Harness) {
  await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
  await h.send(ALEX, "2-10");
  await h.send(ALEX, h.tapback(ALEX));
  return h.send(ALEX, "sam, priya, leo, mia. I'm in too and can drive 2");
}

describe("组织者发起", () => {
  test("第一句话里能认出的都记下，只问缺的", async () => {
    const h = new Harness();
    const out = await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
    expect(textsTo(out, ALEX)).toEqual(["What window works on Saturday — say 2 to 10 PM?"]);

    const [event] = h.store.listEvents();
    expect(event).toMatchObject({ title: "hike + dinner", day: "2026-09-26", budgetCapCents: 4000, headcount: 5, status: "DRAFT" });
    expect(event?.area?.label).toBe("near campus");
  });

  test("标题在日期词前停下", async () => {
    const h = new Harness();
    await h.send(ALEX, "plan a picnic + dinner sunday near campus, max $30 each");
    expect(h.store.listEvents()[0]).toMatchObject({ title: "picnic + dinner", day: "2026-09-27" });
  });

  test("信息齐了发摘要；对摘要点 👍 算确认，然后问邀请谁", async () => {
    const h = new Harness();
    await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
    const summary = await h.send(ALEX, "2-10");
    expect(textsTo(summary, ALEX)[0]).toContain("Sat");
    expect(textsTo(summary, ALEX)[0]).toContain("2–10 PM");
    expect(textsTo(summary, ALEX)[0]).toContain("Up to $40 per person (hard cap)");

    const confirmed = await h.send(ALEX, h.tapback(ALEX));
    expect(textsTo(confirmed, ALEX)).toEqual(["Who's coming? Share their contacts or just type names."]);
    const [event] = h.store.listEvents();
    expect(event?.status).toBe("COLLECTING");
    expect(event?.inputVersion).toBe(1);
    expect(event?.area?.lat).toBeDefined();
    expect(event?.candidateVenueIds.length).toBeGreaterThan(0);
  });

  test("回 no 不会确认，而是问要改什么", async () => {
    const h = new Harness();
    await h.send(ALEX, "plan a hike + dinner saturday near campus, max $40");
    await h.send(ALEX, "2-10");
    const out = await h.send(ALEX, "no");
    expect(textsTo(out, ALEX)).toEqual(["What should I change?"]);
    expect(h.store.listEvents()[0]?.status).toBe("DRAFT");
  });

  test("按名字邀请：组织者收到看板链接，每个人收到纯文本开场白", async () => {
    const h = new Harness();
    const out = await setUpEvent(h);
    const [reply, dashboard] = textsTo(out, ALEX);
    expect(reply).toBe("Got it. Texting Sam, Priya, Leo and Mia now — you can watch replies come in here:");
    expect(dashboard).toMatch(/^https:\/\/juno\.test\/o\/[\w-]+$/);

    const opener = textsTo(out, SAM);
    expect(opener).toHaveLength(1);
    expect(opener[0]).toStartWith("Hi Sam, it's Juno — Alex is putting together hike + dinner this Saturday");
    expect(opener[0]).not.toContain("http"); // 首条消息不带链接（deliverability）
  });

  test("通讯录里没有的名字会问号码", async () => {
    const h = new Harness();
    await h.send(ALEX, "plan a hike + dinner saturday near campus, max $40");
    await h.send(ALEX, "2-10");
    await h.send(ALEX, "yes");
    const out = await h.send(ALEX, "sam and bob");
    expect(textsTo(out, ALEX).at(-1)).toBe("I don't have a number for Bob yet — could you share their contact?");
  });
});

describe("参与者私聊", () => {
  test("§4.3 流程 2：四个问题 → 摘要 → 确认 → 邮箱", async () => {
    const h = new Harness();
    await setUpEvent(h);

    expect(textsTo(await h.send(SAM, "sure"), SAM)).toEqual(["What part of Saturday 2–10 PM are you free?"]);
    // 连发的两条在同一轮里处理
    expect(textsTo(await h.send(SAM, "after 3", "need to be home by 10 though"), SAM)).toEqual(["Any food allergies or things you don't eat?"]);
    expect(textsTo(await h.send(SAM, "peanuts, pretty severe"), SAM)[0]).toStartWith("Do you drive, or need a ride?");
    expect(textsTo(await h.send(SAM, "need a ride, I'm near the library"), SAM)).toEqual([
      "Last one: Alex set $40/person as the max. Does that work for you?",
    ]);

    const summary = textsTo(await h.send(SAM, "yeah"), SAM)[0];
    expect(summary).toContain("• Free 3–10 PM, home by 10 PM");
    expect(summary).toContain("• Allergic to peanuts");
    expect(summary).toContain("• Needs a ride, pickup at Main Library (north entrance)");
    expect(summary).toContain("• Budget up to $40");

    const confirmed = await h.send(SAM, "yep");
    expect(confirmed[0]).toMatchObject({ kind: "react", to: SAM, emoji: "❤️" });
    expect(textsTo(confirmed, SAM)).toEqual(["Want the calendar invite by email too? Send your email, or just say skip."]);

    expect(textsTo(await h.send(SAM, "sam.lee@example.com"), SAM)).toEqual(["Perfect. I'll text you as soon as the plan is set."]);

    const [event] = h.store.listEvents();
    const answer = h.store.getAnswer(event!.id, SAM);
    expect(answer).toMatchObject({ confirmed: true, free: [{ start: "15:00", end: "22:00" }], homeBy: "22:00", allergies: ["peanuts"], drives: "no", budgetCapCents: 4000 });
    expect(h.store.getMember(event!.id, SAM)).toMatchObject({ status: "confirmed", email: "sam.lee@example.com" });
    expect(event?.inputVersion).toBe(2);
  });

  test("确认后改答案：重新发摘要，等本人再确认", async () => {
    const h = new Harness();
    await setUpEvent(h);
    for (const text of ["sure", "after 3", "none", "need a ride, I'm near the library", "yeah", "yep", "skip"]) await h.send(SAM, text);

    const out = await h.send(SAM, "actually I'm free after 5");
    expect(textsTo(out, SAM)[0]).toStartWith("Updated — here's what I've got:");
    expect(textsTo(out, SAM)[0]).toContain("• Free 5–10 PM");
    const [event] = h.store.listEvents();
    expect(h.store.getAnswer(event!.id, SAM)?.confirmed).toBe(false);
  });

  test("确认后说 thanks：只点 tapback，不再发消息", async () => {
    const h = new Harness();
    await setUpEvent(h);
    for (const text of ["sure", "after 3", "none", "need a ride, I'm near the library", "yeah", "yep", "skip"]) await h.send(SAM, text);
    const out = await h.send(SAM, "thanks!");
    expect(out).toEqual([{ kind: "react", to: SAM, messageId: expect.any(String), emoji: "❤️" }]);
  });

  test("地图上找不到集合点：请本人换个地标", async () => {
    const h = new Harness();
    await setUpEvent(h);
    for (const text of ["sure", "after 3", "none"]) await h.send(SAM, text);
    const out = await h.send(SAM, "need a ride, I'm near the old mill");
    expect(textsTo(out, SAM)).toEqual(['I couldn\'t find "the old mill" on the map. Is there a landmark nearby?']);
    expect(textsTo(await h.send(SAM, "the library"), SAM)[0]).toStartWith("Last one:");
  });
});

describe("Claude 的输出只是提议", () => {
  const fakeBrain = (askingAbout: string, reply: string): Brain => ({
    ...offlineBrain,
    attendee: async () => ({ intent: "answer", patch: { free: { start: "15:00" }, homeBy: "22:00" }, askingAbout, reply }),
  });

  test("问的正是下一个缺失字段：用 Claude 的措辞", async () => {
    const h = new Harness(fakeBrain("allergies", "Got it, after 3. Any food allergies?"));
    await setUpEvent(h);
    await h.send(SAM, "sure");
    const out = await h.send(SAM, "after 3, home by 10");
    expect(textsTo(out, SAM)).toEqual(["Got it, after 3. Any food allergies?"]);
  });

  test("问的不是代码算出的下一个字段：改用模板", async () => {
    const h = new Harness(fakeBrain("budget", "Great! What's your budget?"));
    await setUpEvent(h);
    await h.send(SAM, "sure");
    const out = await h.send(SAM, "after 3, home by 10");
    expect(textsTo(out, SAM)).toEqual(["Any food allergies or things you don't eat?"]);
  });
});

describe("组织者看板", () => {
  test("只有聚合信息：不带名字的过敏、不带任何人的预算", async () => {
    const h = new Harness();
    await setUpEvent(h);
    for (const text of ["sure", "after 3", "peanuts", "need a ride, I'm near the library", "$30", "yep"]) await h.send(SAM, text);

    const view = organizerView(h.store, h.store.listEvents()[0]!);
    expect(view.counts).toEqual({ total: 4, confirmed: 1, waiting: 3 });
    expect(view.aggregates).toMatchObject({ allergies: ["peanuts"], needRides: 1 });
    expect(JSON.stringify(view.members)).not.toContain("peanut");
    expect(JSON.stringify(view)).not.toContain("3000");
    expect(view.members.find((member) => member.name === "Sam")?.pickup).toBe("Main Library (north entrance)");
  });
});
