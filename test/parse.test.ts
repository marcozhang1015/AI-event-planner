import { describe, expect, test } from "bun:test";
import {
  isSkip,
  normalizePhone,
  parseDay,
  parseDrives,
  parseEmail,
  parseHomeBy,
  parseList,
  parseMoneyCents,
  parseSeats,
  parseTimeWindow,
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
    expect(parseSeats("I can take 3")).toBe(3);
    expect(parseSeats("2 seats")).toBe(2);
  });

  test("过敏：没有 → []；有 → 拆开，去掉程度词", () => {
    expect(parseList("none")).toEqual([]);
    expect(parseList("nope, I eat everything")).toEqual([]);
    expect(parseList("peanuts, pretty severe")).toEqual(["peanuts"]);
    expect(parseList("shellfish and gluten")).toEqual(["shellfish", "gluten"]);
  });

  test("邮箱和号码", () => {
    expect(parseEmail("it's Sam.Lee@Example.com thanks")).toBe("sam.lee@example.com");
    expect(normalizePhone("(314) 555-0101")).toBe("+13145550101");
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
  });
});
