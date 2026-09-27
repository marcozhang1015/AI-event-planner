import { describe, expect, test } from "bun:test";
import {
  hasChangeCue,
  isDecline,
  isDeferral,
  isInviteRequest,
  isPlanRequest,
  looksLikeNewEvent,
  isQuestion,
  isSkip,
  parseApproval,
  parseBudgetReply,
  parseChoice,
  parseDay,
  parseDrives,
  parseDrivesReply,
  parseEmail,
  parseHomeBy,
  parseJoining,
  parseDayPart,
  parseFood,
  parseMoneyCents,
  parseNewPlan,
  parseSeats,
  parseSeatsReply,
  parseTimeWindow,
  parseVerification,
  parseYesNo,
  rejectsAmount,
} from "../src/brain/parse";

const WINDOW = { start: "14:00", end: "22:00" };

describe("规则解析", () => {
  test("时间窗：没写 am/pm 时按下午理解", () => {
    expect(parseTimeWindow("2-10")).toEqual({ start: "14:00", end: "22:00" });
    expect(parseTimeWindow("2pm to 10pm")).toEqual({ start: "14:00", end: "22:00" });
    expect(parseTimeWindow("9-5")).toEqual({ start: "09:00", end: "17:00" });
    expect(parseTimeWindow("after 3", WINDOW)).toEqual({ start: "15:00" });
    expect(parseTimeWindow("free until 9", WINDOW)).toEqual({ end: "21:00" });
    expect(parseTimeWindow("anytime")).toEqual({});
    expect(parseTimeWindow("3点以后")).toEqual({ start: "15:00" });
    expect(parseTimeWindow("no idea")).toBeUndefined();
    expect(parseTimeWindow("can we start at 4?")).toEqual({ start: "16:00" });
  });

  test("最晚到家", () => {
    expect(parseHomeBy("need to be home by 10 though", WINDOW)).toBe("22:00");
    expect(parseHomeBy("home by 9:30pm")).toBe("21:30");
    expect(parseHomeBy("after 3")).toBeUndefined();
  });

  test("日期：按今天往后找", () => {
    const thursday = "2026-09-24";
    expect(parseDay("this saturday", thursday)).toBe("2026-09-26");
    expect(parseDay("sat afternoon", thursday)).toBe("2026-09-26");
    expect(parseDay("tomorrow", thursday)).toBe("2026-09-25");
    expect(parseDay("周四", thursday)).toBe("2026-09-24");
    expect(parseDay("9/27", thursday)).toBe("2026-09-27");
    expect(parseDay("1/5", thursday)).toBe("2027-01-05");
  });

  test("金额", () => {
    expect(parseMoneyCents("max $40 each")).toBe(4000);
    expect(parseMoneyCents("30 max")).toBe(3000);
    expect(parseMoneyCents("40")).toBe(4000);
    expect(parseMoneyCents("5 of us")).toBeUndefined();
    // 别的时候没有 $ 之类的说法就不算钱："can we do 4?" 不是 $4
    expect(parseMoneyCents("I want to do 50")).toBeUndefined();
  });

  test("回答预算问题：唯一一个不像时刻或人数的数字就是金额", () => {
    expect(parseBudgetReply("I want to do 50")).toBe(5000);
    expect(parseBudgetReply("maybe 25")).toBe(2500);
    expect(parseBudgetReply("no, I can only do 30. home by 10")).toBe(3000);
    expect(parseBudgetReply("我最多 35")).toBe(3500);
    expect(parseBudgetReply("$45 works")).toBe(4500);
    expect(parseBudgetReply("no, I need to be home by 9")).toBeUndefined();
    expect(parseBudgetReply("it'd be 2 of us")).toBeUndefined();
    expect(parseBudgetReply("7:30 works")).toBeUndefined();
    expect(parseBudgetReply("after 7pm")).toBeUndefined();
    expect(parseBudgetReply("between 30 and 40")).toBeUndefined();
    expect(parseBudgetReply("no")).toBeUndefined();
  });

  test("是 / 否 / 跳过", () => {
    expect(parseYesNo("yep")).toBe(true);
    expect(parseYesNo("Sounds good!")).toBe(true);
    expect(parseYesNo("对的")).toBe(true);
    expect(parseYesNo("nope")).toBe(false);
    expect(parseYesNo("none")).toBeUndefined();
    expect(isSkip("skip")).toBe(true);
    expect(isSkip("sam@example.com")).toBe(false);
  });

  test("开车", () => {
    expect(parseDrives("need a ride, I'm near the library")).toBe("no");
    expect(parseDrives("I can drive")).toBe("yes");
    expect(parseDrives("I have a car but prefer not to drive")).toBe("if_needed");
    expect(parseDrives("I'm in too and can drive 2")).toBe("yes");
    expect(parseDrives("ugh my car's in the shop, can't drive tomorrow")).toBe("no");
    expect(parseSeats("I'm in too and can drive 2")).toBe(2);
    expect(parseSeats("I can take 3")).toBe(3);
    expect(parseSeats("2 seats")).toBe(2);
  });

  test("过敏：没有 → []；有 → 拆开，程度词换成 (severe) 标记", () => {
    expect(parseFood("none")).toEqual({ allergies: [], diet: [] });
    expect(parseFood("nope, I eat everything")).toEqual({ allergies: [], diet: [] });
    expect(parseFood("peanuts, pretty severe")).toEqual({ allergies: ["peanuts (severe)"] });
    expect(parseFood("shellfish and gluten")).toEqual({ allergies: ["shellfish", "gluten"] });
  });

  test("邮箱", () => {
    expect(parseEmail("it's Sam.Lee@Example.com thanks")).toBe("sam.lee@example.com");
  });

  test("明确说不来才算谢绝", () => {
    expect(isDecline("no")).toBe(true);
    expect(isDecline("I can't make it anymore")).toBe(true);
    expect(isDecline("no, I'll find my own ride")).toBe(false);
    expect(isDecline("yes please")).toBe(false);
  });

  test("晚点再说、提问", () => {
    for (const text of ["not now", "later", "busy right now", "in a meeting", "nope", "hold on", "one sec", "not sure"]) expect(isDeferral(text)).toBe(true);
    expect(isDeferral("sure")).toBe(false);
    expect(isDeferral("I'm free later in the day")).toBe(false);
    expect(isQuestion("where are we going for dinner?")).toBe(true);
    expect(isQuestion("what time again")).toBe(true);
    expect(isQuestion("thanks!")).toBe(false);
  });
});

describe("组织者的命令", () => {
  test("approve 只认明确的文字", () => {
    expect(parseApproval("approve A")).toEqual({ label: "A" });
    expect(parseApproval("ok, approve plan b")).toEqual({ label: "B" });
    expect(parseApproval("approve")).toEqual({ label: undefined });
    expect(parseApproval("批准 A")).toEqual({ label: "A" });
    expect(parseApproval("I approve of the idea but let's wait")).toBeUndefined();
    expect(parseApproval("approved?")).toBeUndefined();
    expect(parseApproval("looks good")).toBeUndefined();
  });

  test("核实：打过电话 + 能 / 不能", () => {
    expect(parseVerification("just called, they said they can do it")).toBe(true);
    expect(parseVerification("checked with them — they can't guarantee it")).toBe(false);
    expect(parseVerification("called, not safe for nuts")).toBe(false);
    expect(parseVerification("they can do it")).toBeUndefined();
  });

  test("plan it、邀请、改设置、自己去不去", () => {
    expect(isPlanRequest("ok plan it")).toBe(true);
    expect(isPlanRequest("go ahead")).toBe(true);
    expect(isInviteRequest("also invite bob")).toBe(true);
    expect(isInviteRequest("has sam answered yet?")).toBe(false);
    expect(hasChangeCue("can we start at 4?")).toBe(true);
    expect(hasChangeCue("none")).toBe(false);
    expect(hasChangeCue("max $50 each")).toBe(true);
    expect(parseJoining("sam, priya. I'm in too and can drive 2")).toBe(true);
    expect(parseJoining("count me out, just organizing")).toBe(false);
    expect(parseJoining("sam and priya")).toBeUndefined();
  });

  test("重新开始、看起来是一个新活动", () => {
    for (const text of ["new plan", "ok, start over", "let's start over", "start a new plan", "重新开始"]) expect(parseNewPlan(text)).toEqual({ rest: "" });
    expect(parseNewPlan("start over: plan a picnic sunday")).toEqual({ rest: "plan a picnic sunday" });
    for (const text of ["what's the new plan?", "new plan?", "send me the new plan", "is there a new plan", "new planning session"]) expect(parseNewPlan(text)).toBeUndefined();
    expect(looksLikeNewEvent("plan a hike + dinner saturday near campus")).toBe(true);
    expect(looksLikeNewEvent("can you plan a picnic sunday?")).toBe(true);
    expect(looksLikeNewEvent("organize a game night friday")).toBe(true);
    expect(looksLikeNewEvent("plan it")).toBe(false);
    expect(looksLikeNewEvent("let's plan")).toBe(false);
  });

  test("回编号选候选", () => {
    expect(parseChoice("2", 3)).toBe(2);
    expect(parseChoice("#1", 3)).toBe(1);
    expect(parseChoice("the second one", 3)).toBe(2);
    expect(parseChoice("4", 3)).toBeUndefined();
    expect(parseChoice("north station", 3)).toBeUndefined();
  });
});

// 排查时发现会让对话原地打转或被误解的常见说法
describe("常见说法", () => {
  test("是：口语里的肯定也算", () => {
    for (const text of ["yea", "k", "all good", "looks right", "that's right", "sounds right", "exactly", "fine", "that's fine", "for sure", "definitely", "👌"]) {
      expect(parseYesNo(text)).toBe(true);
    }
    expect(parseYesNo("not fine")).toBeUndefined();
    expect(parseYesNo("kinda")).toBeUndefined();
  });

  test("开车：I'll drive、need a lift；只有说的是开车，rather not 才算 if_needed", () => {
    expect(parseDrives("I'll drive")).toBe("yes");
    expect(parseDrives("need a lift")).toBe("no");
    expect(parseDrives("I'd rather not drive")).toBe("if_needed");
    expect(parseDrives("I'd rather not")).toBeUndefined();
    // 正在问开不开车时：yes / no / rather not 都有意思
    expect(parseDrivesReply("yes")).toBe("yes");
    expect(parseDrivesReply("no")).toBe("no");
    expect(parseDrivesReply("driving")).toBe("yes");
    expect(parseDrivesReply("I can but rather not")).toBe("if_needed");
  });

  test("不接受这个金额：no、too much、can't afford", () => {
    for (const text of ["no", "too much", "that's too expensive", "can't afford that"]) expect(rejectsAmount(text)).toBe(true);
    expect(rejectsAmount("sure")).toBe(false);
  });

  test("座位：英文数字、a couple、up to 3、4 including me（算乘客）、none", () => {
    expect(parseSeats("I can take two")).toBe(2);
    expect(parseSeatsReply("three")).toBe(3);
    expect(parseSeatsReply("a couple")).toBe(2);
    expect(parseSeatsReply("up to 3")).toBe(3);
    expect(parseSeatsReply("just one")).toBe(1);
    expect(parseSeatsReply("4 including me")).toBe(3);
    expect(parseSeatsReply("none")).toBe(0);
    // 不在问座位时，"just one question" 不是一个座位
    expect(parseSeats("just one question")).toBeUndefined();
  });

  test("有空的时间：整段都行、3pm onwards、noon、until late；上午 / 下午 / 晚上", () => {
    expect(parseTimeWindow("I'm free")).toEqual({});
    expect(parseTimeWindow("whole day")).toEqual({});
    expect(parseTimeWindow("I'm free after 3", WINDOW)).toEqual({ start: "15:00" });
    expect(parseTimeWindow("3pm onwards")).toEqual({ start: "15:00" });
    expect(parseTimeWindow("noon to 6")).toEqual({ start: "12:00", end: "18:00" });
    expect(parseTimeWindow("from 2 until late")).toEqual({ start: "14:00", end: "22:00" });
    expect(parseDayPart("all afternoon")).toEqual({ start: "12:00", end: "17:00" });
    expect(parseDayPart("free in the evening")).toEqual({ start: "17:00", end: "22:00" });
    expect(parseDayPart("not sure")).toBeUndefined();
  });

  test("日期：Oct 3、October 3rd、3rd of october、the 3rd、this weekend", () => {
    const thursday = "2026-09-24";
    expect(parseDay("Oct 3", thursday)).toBe("2026-10-03");
    expect(parseDay("October 3rd", thursday)).toBe("2026-10-03");
    expect(parseDay("3rd of october", thursday)).toBe("2026-10-03");
    expect(parseDay("the 3rd", thursday)).toBe("2026-10-03");
    expect(parseDay("the 25th", thursday)).toBe("2026-09-25");
    expect(parseDay("this weekend", thursday)).toBe("2026-09-26");
    expect(parseDay("we may do it saturday", thursday)).toBe("2026-09-26");
  });

  test("跳过邮箱：I'd rather not、no email", () => {
    for (const text of ["I'd rather not", "rather not", "no email", "not now"]) expect(isSkip(text)).toBe(true);
  });

  test("过敏和忌口分开记：忌口不会被当成要核实的过敏", () => {
    expect(parseFood("I'm vegetarian")).toEqual({ allergies: [], diet: ["vegetarian"] });
    expect(parseFood("no pork")).toEqual({ allergies: [], diet: ["no pork"] });
    expect(parseFood("I don't eat meat")).toEqual({ allergies: [], diet: ["no meat"] });
    expect(parseFood("no allergies but vegetarian")).toEqual({ allergies: [], diet: ["vegetarian"] });
    expect(parseFood("vegan, allergic to sesame")).toEqual({ allergies: ["sesame"], diet: ["vegan"] });
    expect(parseFood("gluten free")).toEqual({ allergies: ["gluten free"] });
  });
});
