// LLM 关掉（offlineBrain）时，§4.3 流程 1–2 靠规则解析和模板也要能走通；第二组的对话细节也在这里。

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offlineBrain, type Brain } from "../src/brain/extract";
import { organizerView } from "../src/out/privacy";
import { loadContacts } from "../src/config";
import type { Maps } from "../src/maps";
import { SampleMaps } from "../src/maps/sample";
import type { Place } from "../src/shared/types";
import { ALEX, answer, CONTACTS, Harness, SAM, setUpEvent, textsTo, VIEWS } from "./harness";

/** Sam 答完四个问题、确认、跳过邮箱。 */
async function samConfirms(h: Harness) {
  await answer(h, SAM, "sure", "after 3", "none", "need a ride, I'm near the library", "yeah", "yep", "skip");
}

describe("组织者发起", () => {
  test("第一句话里能认出的都记下，只问缺的", async () => {
    const h = new Harness();
    const out = await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
    expect(textsTo(out, ALEX)).toEqual(["What window works on Saturday — say 2 to 10 PM?"]);
    expect(h.event()).toMatchObject({ title: "hike + dinner", day: "2026-09-26", budgetCapCents: 4000, headcount: 5, status: "DRAFT" });
    expect(h.event().area?.label).toBe("near campus");
  });

  test("标题在日期词前停下", async () => {
    const h = new Harness();
    await h.send(ALEX, "plan a picnic + dinner sunday near campus, max $30 each");
    expect(h.event()).toMatchObject({ title: "picnic + dinner", day: "2026-09-27" });
  });

  test("信息齐了发摘要；对摘要点 👍 算确认，然后问邀请谁", async () => {
    const h = new Harness();
    await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
    const summary = textsTo(await h.send(ALEX, "2-10"), ALEX)[0];
    expect(summary).toContain("Sat");
    expect(summary).toContain("2–10 PM");
    expect(summary).toContain("Up to $40 per person (hard cap)");

    const confirmed = await h.send(ALEX, h.tapback(ALEX));
    expect(textsTo(confirmed, ALEX)).toEqual(["Who's coming? Share their contacts or just type names."]);
    expect(h.event()).toMatchObject({ status: "COLLECTING", inputVersion: 1 });
    expect(h.event().area?.lat).toBeDefined();
    expect(h.event().candidateVenueIds.length).toBeGreaterThan(0);
  });

  test("回 no 不会确认，而是问要改什么", async () => {
    const h = new Harness();
    await h.send(ALEX, "plan a hike + dinner saturday near campus, max $40");
    await h.send(ALEX, "2-10");
    expect(textsTo(await h.send(ALEX, "no"), ALEX)).toEqual(["What should I change?"]);
    expect(h.event().status).toBe("DRAFT");
  });
});

describe("邀请", () => {
  test("按名字邀请：组织者收到看板链接和自己的第一个问题，每个人收到纯文本开场白", async () => {
    const h = new Harness();
    const out = await setUpEvent(h);
    const [reply, dashboard, own] = textsTo(out, ALEX);
    expect(reply).toBe("Got it. Texting Sam, Priya, Leo and Mia now — you can watch replies come in here:");
    expect(dashboard).toMatch(/^https:\/\/juno\.test\/o\/[\w-]+$/);
    // "I'm in too and can drive 2"：组织者也参加，开车、2 个座位已经记下，接着问过敏
    expect(own).toBe("While they reply — any food allergies or things you don't eat?");
    expect(h.store.getAnswer(h.event().id, ALEX)).toMatchObject({ drives: "yes", seats: 2, free: [{ start: "14:00", end: "22:00" }], budgetCapCents: 4000 });

    const opener = textsTo(out, SAM);
    expect(opener).toHaveLength(1);
    expect(opener[0]).toStartWith("Hi Sam, it's Juno — Alex is putting together hike + dinner this Saturday");
    expect(opener[0]).not.toContain("http"); // 首条消息不带链接（deliverability）
    // 发给别人的消息失败了要告诉组织者，并提示怎么重试
    expect(out.find((action) => action.kind === "send" && action.to === SAM)).toMatchObject({ onFail: { notify: ALEX, name: "Sam", retry: "invite Sam" } });
  });

  test("组织者补答自己的约束，确认后计入进度", async () => {
    const h = new Harness();
    await setUpEvent(h);
    expect(textsTo(await h.send(ALEX, "none"), ALEX)).toEqual(["Where will you be driving from? A landmark near you is enough."]);
    expect(textsTo(await h.send(ALEX, "campus gate"), ALEX)[0]).toContain("• Driving, 2 seats, from Campus Gate");
    await h.send(ALEX, "yep");
    expect(textsTo(await h.send(ALEX, "skip"), ALEX)).toEqual(["1 of 5 ready · waiting on Sam, Priya, Leo and Mia"]);
  });

  test("没说自己去不去：问一句", async () => {
    const h = new Harness();
    const out = await setUpEvent(h, "sam and priya");
    expect(textsTo(out, ALEX).at(-1)).toBe("Are you coming too? If so, I'll grab your details here.");
    expect(textsTo(await h.send(ALEX, "nope"), ALEX)).toEqual(["Got it — you're just organizing."]);
    expect(h.store.getAnswer(h.event().id, ALEX)).toBeUndefined();
  });

  test("通讯录里没有的名字会问号码；名单里的普通词不当成人名", async () => {
    for (const [invite, expected] of [
      ["sam and bob", "I don't have a number for Bob yet — could you share their contact?"],
      ["invite sam and priya please", undefined],
      ["just sam for now", undefined],
      ["sam priya and leo, thanks", undefined],
    ] as const) {
      const h = new Harness();
      const texts = textsTo(await setUpEvent(h, invite), ALEX);
      expect(texts.filter((text) => text.startsWith("I don't have a number"))).toEqual(expected ? [expected] : []);
    }
  });

  test("收集阶段随口问的话不会被当成邀请", async () => {
    const h = new Harness();
    await setUpEvent(h, "sam, priya, leo, mia. count me out");
    for (const question of ["has sam answered yet?", "did priya reply"]) {
      expect(textsTo(await h.send(ALEX, question), ALEX)).toEqual(["0 of 4 ready · waiting on Sam, Priya, Leo and Mia"]);
    }
    expect(textsTo(await h.send(ALEX, "also invite bob"), ALEX)).toEqual(["I don't have a number for Bob yet — could you share their contact?"]);
  });

  test("再邀请还没回复的人：重发开场白；已经回复过的不再打扰", async () => {
    const h = new Harness();
    await setUpEvent(h);
    const again = await h.send(ALEX, "invite sam");
    expect(textsTo(again, SAM)[0]).toStartWith("Hi Sam, it's Juno");
    expect(textsTo(again, ALEX)[0]).toBe("Got it. Texting Sam now — you can watch replies come in here:");

    await h.send(SAM, "sure");
    expect(textsTo(await h.send(ALEX, "invite sam"), ALEX)).toEqual(["Sam is already in."]);
  });

  test("深夜邀请：告诉组织者几点发出", async () => {
    const h = new Harness({ quietHours: { start: "22:00", end: "08:00" } });
    h.now = new Date("2026-09-25T04:00:00Z"); // 芝加哥 23:00
    const out = await setUpEvent(h);
    expect(textsTo(out, ALEX)[0]).toBe("Got it. It's late, so I'll text Sam, Priya, Leo and Mia at 8 AM — you can watch replies come in here:");
  });

  test("通讯录的写法不统一也能对上：号码规范化成 E.164", async () => {
    const dir = mkdtempSync(join(tmpdir(), "juno-"));
    const path = join(dir, "contacts.json");
    writeFileSync(path, JSON.stringify({ _note: "x", Alex: "(555) 000-0001", Sam: "+1 555 000 0002", Mia: "Mia@Example.com", Bad: 42 }));
    const contacts = loadContacts(path);
    expect(contacts).toEqual([
      { name: "Alex", handle: ALEX },
      { name: "Sam", handle: SAM },
      { name: "Mia", handle: "mia@example.com" },
    ]);
    const h = new Harness({ contacts });
    const out = await setUpEvent(h, "sam");
    expect(textsTo(out, SAM)[0]).toStartWith("Hi Sam, it's Juno — Alex is putting together");
  });
});

describe("参与者私聊", () => {
  test("§4.3 流程 2：开场白 → 问题 → 摘要 → 确认 → 邮箱", async () => {
    const h = new Harness();
    await setUpEvent(h);

    expect(textsTo(await h.send(SAM, "sure"), SAM)).toEqual(["What part of Saturday 2–10 PM are you free?"]);
    // 连发的两条在同一轮里处理
    expect(textsTo(await h.send(SAM, "after 3", "need to be home by 10 though"), SAM)).toEqual(["Any food allergies or things you don't eat?"]);
    expect(textsTo(await h.send(SAM, "peanuts, pretty severe"), SAM)[0]).toStartWith("Do you drive, or need a ride?");
    expect(textsTo(await h.send(SAM, "need a ride, I'm near the library"), SAM)).toEqual(["Last one: Alex set $40/person as the max. Does that work for you?"]);

    const summary = textsTo(await h.send(SAM, "yeah"), SAM)[0];
    expect(summary).toContain("• Free 3–10 PM, home by 10 PM");
    expect(summary).toContain("• Allergic to peanuts (severe)");
    expect(summary).toContain("• Needs a ride, pickup at Main Library (north entrance)");
    expect(summary).toContain("• Budget up to $40");

    const confirmed = await h.send(SAM, "yep");
    expect(confirmed[0]).toMatchObject({ kind: "react", to: SAM, emoji: "❤️" });
    expect(textsTo(confirmed, SAM)).toEqual(["Want the calendar invite by email too? Send your email, or just say skip."]);
    expect(textsTo(await h.send(SAM, "sam.lee@example.com"), SAM)).toEqual(["Perfect. I'll text you as soon as the plan is set."]);

    const event = h.event();
    expect(h.store.getAnswer(event.id, SAM)).toMatchObject({
      confirmed: true,
      free: [{ start: "15:00", end: "22:00" }],
      homeBy: "22:00",
      allergies: ["peanuts (severe)"],
      drives: "no",
      budgetCapCents: 4000,
    });
    expect(h.store.getMember(event.id, SAM)).toMatchObject({ status: "confirmed", email: "sam.lee@example.com" });
  });

  test("对开场白说 not now：晚点再聊，不提问", async () => {
    const h = new Harness();
    await setUpEvent(h);
    expect(textsTo(await h.send(SAM, "not now"), SAM)).toEqual(["No worries — text me whenever you have a minute."]);
  });

  test("确认后改答案：重新发摘要，等本人再确认", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await samConfirms(h);
    const out = await h.send(SAM, "actually I'm free after 5");
    expect(textsTo(out, SAM)[0]).toStartWith("Updated — here's what I've got:");
    expect(textsTo(out, SAM)[0]).toContain("• Free 5–10 PM");
    expect(h.store.getAnswer(h.event().id, SAM)?.confirmed).toBe(false);
    expect(h.store.getMember(h.event().id, SAM)?.status).toBe("collecting");
  });

  test("确认后说 thanks：只点 tapback；提问：还没发布就说还没定", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await samConfirms(h);
    expect(await h.send(SAM, "thanks!")).toEqual([{ kind: "react", to: SAM, messageId: expect.any(String), emoji: "❤️" }]);
    expect(textsTo(await h.send(SAM, "where are we going for dinner?"), SAM)).toEqual([
      "Nothing's locked in yet — I'll text you as soon as Alex approves the plan.",
    ]);
  });

  test("地图上找不到集合点：先请本人换个地标，第二次找不到就列出别人的集合点", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await answer(h, ALEX, "none", "campus gate", "yep", "skip");
    await answer(h, SAM, "sure", "after 3", "none");
    expect(textsTo(await h.send(SAM, "need a ride, I'm near the old mill"), SAM)).toEqual(['I couldn\'t find "the old mill" on the map. Is there a landmark nearby?']);
    expect(textsTo(await h.send(SAM, "the cider barn"), SAM)).toEqual([
      "I still can't find that. Want to meet at one of these instead?\n1. Campus Gate\nReply 1, or name another landmark.",
    ]);
    expect(textsTo(await h.send(SAM, "1"), SAM)[0]).toStartWith("Last one:");
    expect(h.store.getAnswer(h.event().id, SAM)?.pickupPlaceId).toBe("sample:campus-gate");
  });

  test("只有一个词、找到好几个地方：列出来让本人选；离活动太远的结果不要", async () => {
    const libraries: Place[] = [
      { id: "lib:main", name: "Main Library", lat: 39.8301, lng: -98.5812, source: "manual" },
      { id: "lib:law", name: "Law Library", lat: 39.8266, lng: -98.5902, source: "manual" },
      { id: "lib:far", name: "Library in another city", lat: 40.7128, lng: -74.006, source: "manual" },
    ];
    const sample = new SampleMaps();
    const maps: Maps = {
      searchPlaces: async (query, near) => (/library/i.test(query) ? libraries : sample.searchPlaces(query, near)),
      searchVenues: (query, kind, near) => sample.searchVenues(query, kind, near),
      travelMinutes: (origins, destinations) => sample.travelMinutes(origins, destinations),
    };
    const h = new Harness({ maps });
    await setUpEvent(h);
    await answer(h, SAM, "sure", "after 3", "none");
    expect(textsTo(await h.send(SAM, "need a ride, I'm near the library"), SAM)).toEqual([
      "I found a few — which one?\n1. Main Library\n2. Law Library\nReply 1 or 2, or name another landmark.",
    ]);
    expect(textsTo(await h.send(SAM, "law"), SAM)[0]).toStartWith("Last one:");
    expect(h.store.getAnswer(h.event().id, SAM)?.pickupPlaceId).toBe("lib:law");
  });
});

describe("Claude 的输出只是提议", () => {
  const fakeBrain = (askingAbout: string, reply: string): Brain => ({
    ...offlineBrain,
    attendee: async () => ({ intent: "answer", patch: { free: { start: "15:00" }, homeBy: "22:00" }, askingAbout, reply }),
  });

  test("问的正是下一个缺失字段：用 Claude 的措辞", async () => {
    const h = new Harness({ brain: fakeBrain("allergies", "Got it, after 3. Any food allergies?") });
    await setUpEvent(h);
    await h.send(SAM, "sure");
    expect(textsTo(await h.send(SAM, "after 3, home by 10"), SAM)).toEqual(["Got it, after 3. Any food allergies?"]);
  });

  test("问的不是代码算出的下一个字段：改用模板", async () => {
    const h = new Harness({ brain: fakeBrain("budget", "Great! What's your budget?") });
    await setUpEvent(h);
    await h.send(SAM, "sure");
    expect(textsTo(await h.send(SAM, "after 3, home by 10"), SAM)).toEqual(["Any food allergies or things you don't eat?"]);
  });
});

describe("组织者看板", () => {
  test("只有聚合信息：不带名字的过敏、不带任何人的预算；进度把参加的组织者也算上", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await answer(h, SAM, "sure", "after 3", "peanuts", "need a ride, I'm near the library", "$29", "yep");

    const view = organizerView(h.reader(), h.event(), VIEWS);
    expect(view.counts).toEqual({ total: 5, confirmed: 1, waiting: 4 });
    expect(view.aggregates).toMatchObject({ allergies: ["peanuts"], needRides: 1 });
    expect(JSON.stringify(view.members)).not.toContain("peanut");
    expect(JSON.stringify(view)).not.toContain("2900");
    expect(view.members.find((member) => member.name === "Sam")?.pickup).toBe("Main Library (north entrance)");
    expect(CONTACTS).toHaveLength(5);
  });
});
