import { describe, expect, test } from "bun:test";
import {
  hasChangeCue,
  isDecline,
  isDeferral,
  isInviteRequest,
  isPlanRequest,
  isQuestion,
  isSkip,
  parseApproval,
  parseChoice,
  parseDay,
  parseDrives,
  parseEmail,
  parseHomeBy,
  parseJoining,
  parseList,
  parseMoneyCents,
  parseSeats,
  parseTimeWindow,
  parseVerification,
  parseYesNo,
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
    expect(parseList("none")).toEqual([]);
    expect(parseList("nope, I eat everything")).toEqual([]);
    expect(parseList("peanuts, pretty severe")).toEqual(["peanuts (severe)"]);
    expect(parseList("shellfish and gluten")).toEqual(["shellfish", "gluten"]);
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
    for (const text of ["not now", "later", "busy right now", "in a meeting", "nope"]) expect(isDeferral(text)).toBe(true);
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
    expect(parseJoining("sam, priya. I'm in too and can drive 2")).toBe(true);
    expect(parseJoining("count me out, just organizing")).toBe(false);
    expect(parseJoining("sam and priya")).toBeUndefined();
  });

  test("回编号选候选", () => {
    expect(parseChoice("2", 3)).toBe(2);
    expect(parseChoice("#1", 3)).toBe(1);
    expect(parseChoice("the second one", 3)).toBe(2);
    expect(parseChoice("4", 3)).toBeUndefined();
    expect(parseChoice("north station", 3)).toBeUndefined();
  });
});
