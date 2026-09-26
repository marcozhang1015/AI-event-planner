import { describe, expect, test } from "bun:test";
import { affectedHandles, checkApproval, transition } from "../src/core/state";
import { zonedToUtc } from "../src/core/time";
import { buildEml } from "../src/out/email";
import { buildIcs } from "../src/out/ics";
import type { Event, Plan, PlanOption } from "../src/types";

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

const option = (rides: PlanOption["rides"]): PlanOption => ({
  label: "A",
  attendees: ["alex", "sam", "mia"],
  excluded: [],
  itinerary: [],
  rides,
  costMaxCents: {},
  unknowns: [],
  ifNeededDrivers: [],
});

describe("状态与批准", () => {
  const plan: Plan = { id: "plan_1", eventId: event.id, inputVersion: 4, status: "FEASIBLE", options: [], conflicts: [], createdAt: "" };

  test("只认组织者、只认当前版本、只认可行方案", () => {
    expect(checkApproval(event, plan, event.organizer)).toEqual({ ok: true });
    expect(checkApproval(event, plan, "+15550000002")).toEqual({ ok: false, reason: "not_organizer" });
    expect(checkApproval({ ...event, inputVersion: 5 }, plan, event.organizer)).toEqual({ ok: false, reason: "stale" });
    expect(checkApproval(event, { ...plan, status: "NEEDS_VERIFICATION" }, event.organizer)).toEqual({ ok: false, reason: "needs_verification" });
  });

  test("不允许跳状态", () => {
    expect(() => transition({ ...event, status: "DRAFT" }, "PUBLISHED")).toThrow();
    expect(transition({ ...event, status: "DRAFT" }, "COLLECTING").status).toBe("COLLECTING");
  });

  test("受影响的人：个人视图变了的才算", () => {
    const before = option([{ driver: "alex", passengers: ["mia"], stops: [], detourMinutes: 0 }, { driver: "priya", passengers: ["sam"], stops: [], detourMinutes: 5 }]);
    const after = option([{ driver: "alex", passengers: ["mia"], stops: [], detourMinutes: 0 }, { driver: "leo", passengers: ["sam"], stops: [], detourMinutes: 10 }]);
    const view = (o: PlanOption, handle: string) => o.rides.find((ride) => ride.driver === handle || ride.passengers.includes(handle));
    expect(affectedHandles(before, after, view)).toEqual(["sam"]);
  });
});

describe("日历和邮件", () => {
  test("活动时区的本地时刻换成 UTC", () => {
    expect(zonedToUtc("2026-09-26", "15:00", "America/Chicago").toISOString()).toBe("2026-09-26T20:00:00.000Z");
    expect(zonedToUtc("2026-12-05", "15:00", "America/Chicago").toISOString()).toBe("2026-12-05T21:00:00.000Z");
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
