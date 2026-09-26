// §4.3 流程 3–5：方案 → 核实 → 批准 → 个人通知（iMessage + 邮件）→ 发布后变更。LLM 关掉时也要能走通。

import { beforeAll, describe, expect, test } from "bun:test";
import { attendeeView, organizerView } from "../src/out/privacy";
import type { Outbound } from "../src/out/actions";
import { ALEX, answer, Harness, LEO, MIA, PRIYA, recipients, SAM, setUpEvent, textsTo, VIEWS } from "./harness";

/** 幕 1–2：所有人答完并确认。最后一个确认的人触发方案（发给 Alex）。 */
async function everyoneConfirms(h: Harness): Promise<Outbound[]> {
  await setUpEvent(h);
  await answer(h, ALEX, "none", "campus gate", "yep", "skip");
  await h.send(SAM, "sure");
  await h.send(SAM, "after 3", "need to be home by 10 though");
  await answer(h, SAM, "peanuts, pretty severe", "need a ride, I'm near the library", "yeah", "yep", "sam.lee@example.com");
  await answer(h, PRIYA, "sure", "anytime", "none", "I can drive", "2", "north station", "yes", "yep", "skip");
  await answer(h, LEO, "sure", "anytime", "none", "I have a car but prefer not to drive", "3", "north station", "$30", "yep", "skip");
  await answer(h, MIA, "sure", "anytime", "none", "need a ride", "town square", "yes");
  return h.send(MIA, "yep");
}

/** 发出去的最终安排或更新：带送达记录的消息和邮件。 */
function finals(outbox: Outbound[]): Outbound[] {
  return outbox.filter((action) => action.kind === "email" || (action.kind === "send" && action.delivery));
}

describe("幕 3：方案、核实、批准", () => {
  const h = new Harness();
  let planOut: Outbound[] = [];
  let verifyOut: Outbound[] = [];
  let approveOut: Outbound[] = [];
  let beforeApprove: Outbound[] = [];
  let statusAfterPlan = "";

  beforeAll(async () => {
    planOut = await everyoneConfirms(h);
    statusAfterPlan = h.event().status;
    verifyOut = await h.send(ALEX, "just called, they said they can do it");
    beforeApprove = [...h.log];
    approveOut = await h.send(ALEX, "approve A");
  });

  test("最后一个人确认 → 方案发给组织者：接人、活动、晚餐、待核实项和电话、Plan B", () => {
    expect(recipients(planOut)).toEqual([MIA, ALEX]);
    const [message, link, prompt] = textsTo(planOut, ALEX);
    expect(message).toStartWith("All 5 ready. Here's what works:\nPlan A works for all 5:");
    expect(message).toContain("Pine Ridge Trail (free)");
    expect(message).toContain("Maple Kitchen (~$22–30 per person)");
    expect(message).toContain("⚠️ One thing I can't confirm: whether Maple Kitchen can handle a severe peanut allergy. Could you give them a call? 555-0142");
    expect(message).toContain("Plan B: Olive Tree (up to $38 per person) needs no call, but Leo (over budget) would have to sit this one out.");
    expect(link).toMatch(/^https:\/\/juno\.test\/o\//);
    expect(prompt).toBe(`Reply "approve A" once it's confirmed (or "approve B"), or tell me what to change.`);
    // 只给聚合信息：不说谁过敏，不写任何人的预算数字
    expect(message).not.toMatch(/Sam[^\n]*peanut|peanut[^\n]*Sam/);
    expect(message).not.toContain("$30 budget");
    expect(statusAfterPlan).toBe("REVIEW");
  });

  test("核实之后 Plan A 可以批准，记下来源和时间", () => {
    expect(textsTo(verifyOut, ALEX)).toEqual([`Noted — confirmed by you by phone at 10 AM. Plan A is ready. Reply "approve A" and I'll send everyone their details.`]);
    expect(h.store.verificationsOf(h.event().id)).toEqual([
      { eventId: h.event().id, venueId: "sample:maple-kitchen", fact: "peanut", value: "SUPPORTED", by: ALEX, at: h.now.toISOString(), note: "by phone" },
    ]);
  });

  test("未经 approve 不会发出任何最终安排（iMessage 和邮件都算）", () => {
    expect(finals(beforeApprove)).toEqual([]);
    expect(h.emails).toHaveLength(1); // 只有批准之后那一封
  });

  test("approve A → 发布；每人收到自己的安排（confetti + 行程页链接），组织者也有一份", () => {
    expect(textsTo(approveOut, ALEX)[0]).toBe("Sent to all 5 🎉");
    expect(h.event()).toMatchObject({ status: "PUBLISHED", published: { label: "A" }, publications: 1 });
    for (const handle of [ALEX, SAM, PRIYA, LEO, MIA]) {
      const notice = approveOut.find((action) => action.kind === "send" && action.to === handle && action.delivery?.kind === "final");
      expect(notice).toBeDefined();
      if (notice?.kind !== "send") continue;
      const [headline, link] = notice.parts;
      expect(typeof headline === "object" && headline.type === "celebrate" && headline.text.startsWith("You're all set for Saturday 🎉")).toBe(true);
      expect(link).toMatchObject({ type: "link" });
    }
    const [sam] = textsTo(approveOut, SAM);
    expect(sam).toMatch(/— (Alex|Priya) picks you up at Main Library/);
    expect(sam).toContain("Maple Kitchen — Alex confirmed with them that they can handle your peanut allergy");
    expect(sam).toContain("• Your cost: up to $30");
  });

  test("留了邮箱的人收到个性化邮件，附 METHOD:REQUEST 的日历邀请", () => {
    const [email] = h.emails;
    expect(email).toMatchObject({ to: "sam.lee@example.com", subject: "Saturday: hike + dinner — your plan" });
    expect(email!.calendar).toContain("METHOD:REQUEST");
    expect(email!.calendar).toContain("SEQUENCE:0");
    expect(email!.html).toContain("Map and details");
  });

  test("发布之后提问：把本人的安排再发一遍（不带 confetti）", async () => {
    const out = await h.send(MIA, "wait what time is pickup?");
    const [text, url] = textsTo(out, MIA);
    expect(text).toStartWith("Here's your plan for Saturday:\n• ");
    expect(text).toContain("picks you up at Town Square");
    expect(url).toMatch(/^https:\/\/juno\.test\/i\//);
  });

  test("看板显示已发布的方案和每人的通知状态；行程页只有本人和同车人", () => {
    const event = h.event();
    const view = organizerView(h.reader(), event, VIEWS);
    expect(view.plan).toMatchObject({ state: "live", publishedLabel: "A" });
    expect(view.me?.role).toBe("driver");
    const sam = attendeeView(h.reader(), event, h.store.getMember(event.id, SAM)!, VIEWS);
    expect(sam.itinerary).toMatchObject({ role: "rider", version: 1, changes: [], calendarUrl: expect.stringMatching(/\/i\/[\w-]+\/calendar\.ics$/) });
    expect(sam.itinerary!.dinner.note).toContain("peanut");
    const carmates = sam.itinerary!.carmates.map((mate) => mate.person.name);
    const others = ["Alex", "Priya", "Leo", "Mia"].filter((name) => !carmates.includes(name));
    expect(JSON.stringify(sam.itinerary)).not.toContain(others[0]!);
  });
});

describe("批准检查", () => {
  test("方案没核实完、选项不明确、还没有方案：都不发", async () => {
    const h = new Harness();
    await everyoneConfirms(h);
    const unverified = await h.send(ALEX, "approve A");
    expect(textsTo(unverified, ALEX)).toEqual(["I still need to know whether Maple Kitchen can handle it before I send anything. Could you give them a call?"]);
    expect(textsTo(await h.send(ALEX, "approve"), ALEX)).toEqual([`Which one — "approve A" or "approve B"?`]);
    expect(finals(h.log)).toEqual([]);

    const fresh = new Harness();
    await setUpEvent(fresh);
    expect(textsTo(await fresh.send(ALEX, "approve A"), ALEX)).toEqual([`There's no plan to approve yet — say "plan it" when you're ready.`]);
  });

  test("approve B：不用核实的方案可以直接批准，被排除的人收到一条说明", async () => {
    const h = new Harness();
    await everyoneConfirms(h);
    const out = await h.send(ALEX, "approve B");
    expect(textsTo(out, ALEX)[0]).toBe("Sent to all 4 🎉");
    expect(textsTo(out, LEO)).toEqual([
      "Heads up — Alex locked in Saturday's plan, but the spots that worked were over your budget, so you're not in this one. If anything changes on your side, just text me.",
    ]);
    expect(out.find((action) => action.kind === "send" && action.to === LEO)).toMatchObject({ delivery: { kind: "excluded" } });
  });

  test("核实结果是不行：那家店不再出现在 Sam 参加的方案里", async () => {
    const h = new Harness();
    await everyoneConfirms(h);
    const out = await h.send(ALEX, "called them, they can't guarantee it");
    const [message] = textsTo(out, ALEX);
    expect(message).toStartWith("Noted — Maple Kitchen can't handle it, so I've taken it off the table.\nPlan A works for");
    const plan = h.store.latestPlan(h.event().id)!;
    for (const option of plan.options) if (option.attendees.includes(SAM)) expect(option.dinner.venueId).not.toBe("sample:maple-kitchen");
  });

  test("组织者改设置（can we start at 4?）：新方案版本号更大，从 4 点以后开始；旧方案不能再批准", async () => {
    const h = new Harness();
    await everyoneConfirms(h);
    const before = h.store.latestPlan(h.event().id)!;
    const out = await h.send(ALEX, "can we start at 4?");
    expect(textsTo(out, ALEX)[0]).toStartWith("Noted.\nPlan A works for");
    const after = h.store.latestPlan(h.event().id)!;
    expect(after.inputVersion).toBeGreaterThan(before.inputVersion);
    expect(h.event().window).toEqual({ start: "16:00", end: "22:00" });
    for (const ride of after.options[0]!.rides) expect(ride.pickups[0]!.at >= "16:00").toBe(true);
  });

  test("同名的两个人在看板和方案里加编号区分", async () => {
    const h = new Harness({ contacts: [{ name: "Alex", handle: ALEX }, { name: "Sam", handle: SAM }, { name: "Sam", handle: PRIYA }] });
    await setUpEvent(h, "sam. count me out");
    const names = organizerView(h.reader(), h.event(), VIEWS).members.map((member) => member.name);
    expect(names).toEqual(["Alex", "Sam", "Sam 2"]);
  });

  test("发布时还没回复的人：行程页照常显示收集中，不说这次去不了", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await answer(h, ALEX, "none", "campus gate", "yep", "skip");
    await answer(h, SAM, "sure", "after 3", "none", "need a ride, I'm near the library", "yeah", "yep", "skip");
    await h.send(ALEX, "plan it");
    await h.send(ALEX, "approve A");
    const event = h.event();
    expect(event.status).toBe("PUBLISHED");
    expect(attendeeView(h.reader(), event, h.store.getMember(event.id, MIA)!, VIEWS).excluded).toBeUndefined();
  });

  test("plan it：不等还没回复的人，他们记为 no_answer", async () => {
    const h = new Harness();
    await setUpEvent(h);
    await answer(h, ALEX, "none", "campus gate", "yep", "skip");
    await answer(h, SAM, "sure", "after 3", "none", "need a ride, I'm near the library", "yeah", "yep", "skip");
    const out = await h.send(ALEX, "ok plan it");
    expect(textsTo(out, ALEX)[0]).toStartWith("Plan A works for 2 of 5:");
    expect(textsTo(out, ALEX)[0]).toContain("Not in Plan A: Priya (hasn't replied), Leo (hasn't replied) and Mia (hasn't replied).");
    expect(recipients(out)).toEqual([ALEX]);
  });
});

describe("幕 4：发布后司机退出", () => {
  const h = new Harness();
  const steps: Record<string, Outbound[]> = {};

  beforeAll(async () => {
    await everyoneConfirms(h);
    await h.send(ALEX, "just called, they said they can do it");
    await h.send(ALEX, "approve A");
    h.emails.length = 0;
    steps.change = await h.send(PRIYA, "ugh my car's in the shop, can't drive tomorrow");
    steps.stillComing = await h.send(PRIYA, "yes please");
    steps.consent = await h.send(LEO, "sure, happy to");
    steps.approve = await h.send(ALEX, "approve");
  });

  test("Priya 说车坏了：先问她还来不来，接人地点就近", () => {
    expect(textsTo(steps.change!, PRIYA)).toEqual(["Thanks for the heads-up. Still want to come? I can get you picked up near North Station."]);
  });

  test("她确认之后，先私聊征得 Leo 同意（带谁、多绕几分钟），组织者还不会收到任何东西", () => {
    expect(recipients(steps.stillComing!)).toEqual([PRIYA, LEO]);
    expect(textsTo(steps.stillComing!, PRIYA)).toEqual(["Thanks — I'll work out the change with Alex and text you the update."]);
    expect(textsTo(steps.stillComing!, LEO)[0]).toMatch(
      /^Hey Leo — Priya can't drive Saturday anymore\. You mentioned you could drive if needed: could you take .*Priya.*\? It's about \d+ extra minutes\.$/,
    );
  });

  test("Leo 同意 → 组织者收到变更提议：改了什么、谁受影响", () => {
    expect(textsTo(steps.consent!, LEO)).toEqual(["Thanks! I'll send you the details once Alex approves."]);
    const [proposal] = textsTo(steps.consent!, ALEX);
    expect(proposal).toStartWith("Change for Saturday: Priya isn't driving anymore; Leo drives");
    expect(proposal).toContain("Reply \"approve\" to send the update to the 3 people affected.");
    expect(finals(steps.consent!)).toEqual([]);
  });

  test("组织者 approve → 只有受影响的人收到更新（iMessage + 邮件，SEQUENCE +1），版本号变大", () => {
    const out = steps.approve!;
    expect(textsTo(out, ALEX)[0]).toBe("Update sent to the 3 people affected.");
    const updated = finals(out).map((action) => action.to);
    expect(new Set(updated).size).toBe(3);
    expect(updated).toContain(PRIYA);
    expect(updated).toContain(LEO);
    expect(updated).not.toContain(ALEX);
    for (const action of finals(out)) if (action.kind === "send") expect(action.delivery?.kind).toBe("update");
    expect(textsTo(out, LEO)[0]).toStartWith("Update for Saturday — you're driving now.");
    expect(textsTo(out, PRIYA)[0]).toStartWith("Update for Saturday — Leo picks you up now.");
    expect(h.event()).toMatchObject({ publications: 2, published: { label: "A" } });
    for (const email of h.emails) expect(email.calendar).toContain("SEQUENCE:1");
  });

  test("等 Leo 答复期间别人又改了答案：不会再问 Leo 一遍", async () => {
    const other = new Harness();
    await everyoneConfirms(other);
    await other.send(ALEX, "just called, they said they can do it");
    await other.send(ALEX, "approve A");
    await other.send(PRIYA, "ugh my car's in the shop, can't drive tomorrow");
    const asked = await other.send(PRIYA, "yes please");
    expect(recipients(asked)).toContain(LEO);
    await other.send(MIA, "actually I'm free after 2:30");
    const again = await other.send(MIA, "yep");
    expect(recipients(again)).not.toContain(LEO);
    expect(textsTo(again, MIA)).toEqual(["Thanks — I'll work out the change with Alex and text you the update."]);
  });

  test("新方案不再需要 Leo 开车：之前的请求作废，他后面的消息按普通消息处理", async () => {
    const other = new Harness();
    await everyoneConfirms(other);
    await other.send(ALEX, "just called, they said they can do it");
    await other.send(ALEX, "approve A");
    await other.send(PRIYA, "ugh my car's in the shop, can't drive tomorrow");
    await other.send(PRIYA, "yes please");
    expect(other.store.getSession(LEO)?.awaiting).toBe("drive_consent");
    await other.send(PRIYA, "actually it's fixed, I can drive");
    await other.send(PRIYA, "2");
    await other.send(PRIYA, "yep");
    expect(other.store.getSession(LEO)?.awaiting).toBeUndefined();
    expect(await other.send(LEO, "thanks!")).toEqual([{ kind: "react", to: LEO, messageId: expect.any(String), emoji: "❤️" }]);
  });

  test("行程页标出 Updated 和改了什么", () => {
    const event = h.event();
    const priya = attendeeView(h.reader(), event, h.store.getMember(event.id, PRIYA)!, VIEWS);
    expect(priya.itinerary).toMatchObject({ role: "rider", version: 2, changes: ["Leo picks you up now"] });
  });
});
