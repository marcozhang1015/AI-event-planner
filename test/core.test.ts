import { describe, expect, test } from "bun:test";
import { allergenKey, allergenLabel, isSevere } from "../src/core/allergens";
import { isValidHandle, normalizeHandle, normalizePhone, platformOf } from "../src/core/handle";
import { affectedHandles, checkApproval, transition } from "../src/core/state";
import { localTimeIn, parseQuietHours, quietUntil, zonedToUtc } from "../src/shared/time";
import { buildEml } from "../src/out/email";
import { allergyPhrase, priceSpan } from "../src/shared/labels";
import { buildIcs, calendarUid } from "../src/out/ics";
import type { Event, Plan, PlanOption, Ride } from "../src/shared/types";

const event: Event = {
  id: "evt_1",
  organizer: "+15550000001",
  title: "hike + dinner",
  status: "REVIEW",
  timezone: "America/Chicago",
  candidateVenueIds: [],
  inputVersion: 4,
  createdAt: "2026-09-24T00:00:00Z",
};

function ride(driver: string, passengers: string[], at = "15:00"): Ride {
  const stops = [driver, ...passengers].map((handle) => ({ at, placeId: `place:${handle}`, handle }));
  return { driver, passengers, pickups: stops, dropoffs: [...stops.slice(1), stops[0]!], detourMinutes: 0 };
}

function option(rides: Ride[], extra: Partial<PlanOption> = {}): PlanOption {
  return {
    label: "A",
    status: "FEASIBLE",
    activity: { venueId: "trail", start: "15:30", end: "17:30" },
    dinner: { venueId: "maple", start: "18:00", end: "19:30" },
    attendees: rides.flatMap((r) => [r.driver, ...r.passengers]).sort(),
    excluded: [],
    rides,
    costMaxCents: 3000,
    unknowns: [],
    ifNeededDrivers: [],
    maxDetourMinutes: 0,
    driveMinutes: 0,
    ...extra,
  };
}

describe("状态与批准", () => {
  const a = option([ride("alex", ["mia"])]);
  const plan: Plan = { id: "plan_1", eventId: event.id, inputVersion: 4, status: "FEASIBLE", options: [a], conflicts: [], createdAt: "" };

  test("只认组织者、只认当前版本、只认不用核实、不在等司机的选项", () => {
    expect(checkApproval(event, plan, event.organizer)).toEqual({ ok: true, option: a });
    expect(checkApproval(event, plan, "+15550000002")).toEqual({ ok: false, reason: "not_organizer" });
    expect(checkApproval({ ...event, inputVersion: 5 }, plan, event.organizer)).toEqual({ ok: false, reason: "stale" });
    const unknown = { ...plan, options: [{ ...a, status: "NEEDS_VERIFICATION" as const, unknowns: [{ venueId: "maple", fact: "peanut", severe: true }] }] };
    expect(checkApproval(event, unknown, event.organizer)).toEqual({ ok: false, reason: "needs_verification" });
    const waiting = { ...plan, options: [{ ...a, ifNeededDrivers: ["leo"] }] };
    expect(checkApproval(event, waiting, event.organizer)).toEqual({ ok: false, reason: "waiting_on_driver" });
    expect(checkApproval(event, { ...plan, options: [] }, event.organizer)).toEqual({ ok: false, reason: "infeasible" });
  });

  test("两个选项时要说选哪个；发布后的更新默认 A", () => {
    const two = { ...plan, options: [a, { ...a, label: "B" }] };
    expect(checkApproval(event, two, event.organizer)).toEqual({ ok: false, reason: "ambiguous" });
    expect(checkApproval(event, two, event.organizer, "B")).toMatchObject({ ok: true, option: { label: "B" } });
    expect(checkApproval(event, two, event.organizer, "C")).toEqual({ ok: false, reason: "no_option" });
    expect(checkApproval({ ...event, published: { planId: "plan_0", label: "A" } }, two, event.organizer)).toMatchObject({ ok: true, option: { label: "A" } });
  });

  test("不允许跳状态，发布后不回退", () => {
    expect(() => transition({ ...event, status: "DRAFT" }, "PUBLISHED")).toThrow();
    expect(() => transition({ ...event, status: "PUBLISHED" }, "COLLECTING")).toThrow();
    expect(transition({ ...event, status: "DRAFT" }, "COLLECTING").status).toBe("COLLECTING");
    expect(transition({ ...event, status: "PUBLISHED" }, "PUBLISHED").status).toBe("PUBLISHED");
  });

  test("受影响的人：个人视图变了的才算（换了司机的乘客、新旧司机）", () => {
    const before = option([ride("alex", ["mia"]), ride("priya", ["sam", "leo"])]);
    const after = option([ride("alex", ["mia"]), ride("leo", ["sam", "priya"])]);
    expect(affectedHandles(before, after).sort()).toEqual(["leo", "priya", "sam"]);
  });
});

describe("handle", () => {
  test("号码转 E.164，邮箱转小写，sim: / term: 原样保留", () => {
    expect(normalizeHandle("(314) 555-0101")).toBe("+13145550101");
    expect(normalizeHandle(" +1 314-555-0101 ")).toBe("+13145550101");
    expect(normalizeHandle("Sam.Lee@iCloud.com")).toBe("sam.lee@icloud.com");
    expect(normalizeHandle("sim:Sam")).toBe("sim:Sam");
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
    expect(platformOf("term:chat-1")).toBe("terminal");
    expect(platformOf("+13145550101")).toBe("imessage");
  });

  test("认得出能发 iMessage 的地址", () => {
    expect(isValidHandle("+13145550101")).toBe(true);
    expect(isValidHandle("sam@icloud.com")).toBe(true);
    expect(isValidHandle("555-0101")).toBe(false);
    expect(isValidHandle("sim:")).toBe(false);
  });
});

describe("夜间免打扰", () => {
  const quiet = parseQuietHours("22-8")!;

  test("QUIET_HOURS 的写法；写错直接报错", () => {
    expect(quiet).toEqual({ start: "22:00", end: "08:00" });
    expect(parseQuietHours("21:30-07:15")).toEqual({ start: "21:30", end: "07:15" });
    expect(parseQuietHours("off")).toBeUndefined();
    expect(() => parseQuietHours("late")).toThrow();
  });

  test("跨午夜：晚上 11 点到第二天 8 点；白天不在时段里", () => {
    const night = new Date("2026-09-25T04:00:00Z"); // 芝加哥 9 月 24 日 23:00
    expect(localTimeIn("America/Chicago", night)).toBe("23:00");
    expect(quietUntil(night, "America/Chicago", quiet)?.toISOString()).toBe("2026-09-25T13:00:00.000Z");
    const early = new Date("2026-09-25T11:30:00Z"); // 06:30
    expect(quietUntil(early, "America/Chicago", quiet)?.toISOString()).toBe("2026-09-25T13:00:00.000Z");
    expect(quietUntil(new Date("2026-09-25T15:00:00Z"), "America/Chicago", quiet)).toBeUndefined();
    expect(quietUntil(night, "America/Chicago", undefined)).toBeUndefined();
  });
});

describe("过敏", () => {
  test("不同说法对到同一个事实键", () => {
    expect(allergenKey("peanuts (severe)")).toBe("peanut");
    expect(allergenKey("Peanut butter")).toBe("peanut");
    expect(allergenKey("tree nuts")).toBe("tree_nut");
    expect(allergenKey("shrimp")).toBe("shellfish");
    expect(allergenKey("kiwi (mild)")).toBe("kiwi");
    expect(allergenLabel("tree_nut")).toBe("tree nut");
    expect(isSevere("peanuts (severe)")).toBe(true);
    expect(isSevere("peanuts")).toBe(false);
  });

  test("网页和 iMessage 共用的说法：冠词、价格", () => {
    expect(allergyPhrase("peanut", true)).toBe("a severe peanut allergy");
    expect(allergyPhrase("egg", false)).toBe("an egg allergy");
    expect(allergyPhrase("tree nut", false)).toBe("a tree nut allergy");
    expect(priceSpan({ priceMinCents: 2200, priceMaxCents: 3000 })).toBe("$22–30");
    expect(priceSpan({ priceMinCents: 0, priceMaxCents: 0 })).toBe("free");
    expect(priceSpan({})).toBeUndefined();
  });
});

describe("日历和邮件", () => {
  test("活动时区的本地时刻换成 UTC", () => {
    expect(zonedToUtc("2026-09-26", "15:00", "America/Chicago").toISOString()).toBe("2026-09-26T20:00:00.000Z");
    expect(zonedToUtc("2026-12-05", "15:00", "America/Chicago").toISOString()).toBe("2026-12-05T21:00:00.000Z");
  });

  test("UID 每人每场活动固定，不含号码", () => {
    const uid = calendarUid("evt_1", "+15550000002");
    expect(uid).toBe(calendarUid("evt_1", "+15550000002"));
    expect(uid).not.toBe(calendarUid("evt_1", "+15550000003"));
    expect(uid).not.toContain("5550000002");
  });

  test("ICS：固定 UID、SEQUENCE、CRLF 换行、文本转义", () => {
    const ics = buildIcs(
      {
        uid: "evt_1-sam@juno",
        sequence: 2,
        method: "REQUEST",
        day: "2026-09-26",
        start: "15:05",
        end: "20:40",
        timezone: "America/Chicago",
        summary: "Hike + dinner, with Alex",
        organizer: { name: "Juno", email: "juno@example.com" },
        attendee: { name: "Sam", email: "sam@example.com" },
      },
      new Date("2026-09-25T12:00:00Z"),
    );
    expect(ics).toContain("UID:evt_1-sam@juno\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("DTSTART:20260926T200500Z\r\n");
    expect(ics).toContain("DTEND:20260927T014000Z\r\n");
    expect(ics).toContain("SUMMARY:Hike + dinner\\, with Alex\r\n");
    expect(ics).toContain("ATTENDEE;CN=Sam;ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:sam@example.com\r\n");
  });

  test("eml 带上 method=REQUEST 的日历附件", () => {
    const eml = buildEml("Juno <juno@example.com>", { to: "sam@example.com", subject: "Saturday: your plan", text: "hi", html: "<p>hi</p>", calendar: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" });
    expect(eml).toContain("Content-Type: text/calendar; charset=utf-8; method=REQUEST");
    expect(eml).toContain("Subject: Saturday: your plan");
  });
});
