// 求解器的不变量（§5.10）：每个选项都要满足全部硬约束；demo 场景得到预期方案。

import { describe, expect, test } from "bun:test";
import { allergenKey } from "../src/core/allergens";
import { solve, type SolverInput, type SolverPerson } from "../src/core/solver";
import { SampleMaps, sampleCenter } from "../src/maps/sample";
import { toMinutes } from "../src/shared/time";
import type { Answer, Candidate, Fact, Place, PlanOption, PlanResult } from "../src/shared/types";

const maps = new SampleMaps();
const WINDOW = { start: "14:00", end: "22:00" };

async function landmark(query: string): Promise<Place> {
  const [place] = await maps.searchPlaces(query);
  if (!place) throw new Error(query);
  return place;
}

const [library, northStation, campusGate, townSquare] = await Promise.all(["library", "north station", "campus gate", "town square"].map(landmark));
const activities: Candidate[] = (await maps.searchVenues("hike", "activity", sampleCenter)).slice(0, 2);
const restaurants: Candidate[] = await maps.searchVenues("restaurant", "restaurant", sampleCenter);
const allPlaces = [library!, northStation!, campusGate!, townSquare!, ...activities.map((c) => c.place), ...restaurants.map((c) => c.place)];
const travelRows = await maps.travelMinutes(allPlaces, allPlaces);
const table = new Map(travelRows.map((row) => [`${row.fromPlaceId}|${row.toPlaceId}`, row.minutes]));
const travel = (from: string, to: string) => table.get(`${from}|${to}`);

function person(handle: string, answer: Partial<Answer>): SolverPerson {
  return { handle, answer: { eventId: "evt", handle, free: [WINDOW], allergies: [], confirmed: true, version: 1, budgetCapCents: 4000, ...answer } };
}

/** plan §4.2 的五个人。 */
function demoPeople(): SolverPerson[] {
  return [
    person("alex", { drives: "yes", seats: 2, pickupPlaceId: campusGate!.id }),
    person("sam", { free: [{ start: "15:00", end: "22:00" }], homeBy: "22:00", allergies: ["peanuts (severe)"], drives: "no", pickupPlaceId: library!.id }),
    person("priya", { drives: "yes", seats: 2, pickupPlaceId: northStation!.id }),
    person("leo", { drives: "if_needed", seats: 3, pickupPlaceId: northStation!.id, budgetCapCents: 3000 }),
    person("mia", { drives: "no", pickupPlaceId: townSquare!.id }),
  ];
}

function input(overrides: Partial<SolverInput> = {}): SolverInput {
  const venues = [...activities, ...restaurants].map((c) => c.venue);
  const fact = (venueId: string, key: string): Fact => venues.find((venue) => venue.id === venueId)?.facts[key] ?? "UNKNOWN";
  return { window: WINDOW, budgetCapCents: 4000, people: demoPeople(), activities, restaurants, travel, fact, ...overrides };
}

const only = (id: string) => restaurants.filter((c) => c.venue.id === id);

/** 每个选项都必须满足的硬约束。 */
function expectValid(result: PlanResult, source: SolverInput) {
  const people = new Map(source.people.map((p) => [p.handle, p.answer]));
  for (const option of result.options) {
    const seen = new Map<string, number>();
    for (const ride of option.rides) {
      const driver = people.get(ride.driver)!;
      // 只有本人愿意才开车；不超座
      expect(driver.drives === "yes" || (driver.drives === "if_needed" && driver.agreedToDrive !== false)).toBe(true);
      expect(ride.passengers.length).toBeLessThanOrEqual(driver.seats ?? 0);
      for (const handle of [ride.driver, ...ride.passengers]) {
        seen.set(handle, (seen.get(handle) ?? 0) + 1);
        // 去程、回程各恰好一站
        expect(ride.pickups.filter((stop) => stop.handle === handle)).toHaveLength(1);
        expect(ride.dropoffs.filter((stop) => stop.handle === handle)).toHaveLength(1);
      }
      // 路线上每一段车程都是已知的（缺失的不能当成 0）
      const route = [...ride.pickups.map((s) => s.placeId), placeOf(option.activity.venueId), placeOf(option.dinner.venueId), ...ride.dropoffs.map((s) => s.placeId)];
      for (const [index, from] of route.entries()) {
        const to = route[index + 1];
        if (to && to !== from) expect(source.travel(from, to)).toBeDefined();
      }
      expect(toMinutes(ride.pickups[0]!.at)).toBeGreaterThanOrEqual(toMinutes(source.window.start));
      expect(toMinutes(ride.dropoffs.at(-1)!.at)).toBeLessThanOrEqual(toMinutes(source.window.end));
    }
    for (const handle of option.attendees) {
      const answer = people.get(handle)!;
      expect(seen.get(handle)).toBe(1); // 每人恰好在一辆车上
      expect(option.costMaxCents).toBeLessThanOrEqual(Math.min(answer.budgetCapCents ?? Infinity, source.budgetCapCents ?? Infinity));
      const ride = option.rides.find((r) => r.driver === handle || r.passengers.includes(handle))!;
      const pickup = toMinutes(ride.pickups.find((s) => s.handle === handle)!.at);
      const dropoff = toMinutes(ride.dropoffs.find((s) => s.handle === handle)!.at);
      expect(answer.free!.some((w) => toMinutes(w.start) <= pickup && dropoff <= toMinutes(w.end))).toBe(true);
      if (answer.homeBy) expect(dropoff).toBeLessThanOrEqual(toMinutes(answer.homeBy));
      for (const allergy of answer.allergies ?? []) {
        const value = source.fact(option.dinner.venueId, allergenKey(allergy));
        expect(value).not.toBe("UNSUPPORTED");
        if (value === "UNKNOWN") expect(option.unknowns.map((u) => u.fact)).toContain(allergenKey(allergy));
      }
    }
    expect(option.status).toBe(option.unknowns.length ? "NEEDS_VERIFICATION" : "FEASIBLE");
  }
}

function placeOf(venueId: string): string {
  return [...activities, ...restaurants].find((c) => c.venue.id === venueId)!.place.id;
}

function driverOf(option: PlanOption, handle: string) {
  return option.rides.find((ride) => ride.passengers.includes(handle) || ride.driver === handle)?.driver;
}

describe("求解器不变量", () => {
  test("不超座：乘客比空座多时，多出来的人因为座位被排除", () => {
    const people = [
      person("alex", { drives: "yes", seats: 2, pickupPlaceId: campusGate!.id }),
      ...["b", "c", "d", "e"].map((handle) => person(handle, { drives: "no", pickupPlaceId: library!.id })),
    ];
    const source = input({ people });
    const result = solve(source);
    expectValid(result, source);
    const [a] = result.options;
    expect(a!.attendees).toHaveLength(3);
    expect(a!.excluded.map((e) => e.reason)).toEqual(["seats", "seats"]);
  });

  test("每个需要接送的人，去程和回程都恰好坐一辆车", () => {
    const source = input();
    expectValid(solve(source), source);
  });

  test("每人费用上界不超过本人预算", () => {
    const source = input({ restaurants: only("sample:olive-tree") });
    const result = solve(source);
    expectValid(result, source);
    expect(result.options[0]!.excluded).toContainEqual({ handle: "leo", reason: "budget" });
  });

  test("对某人过敏标为 UNSUPPORTED 的餐厅，不会出现在他参加的方案里", () => {
    const source = input({ restaurants: only("sample:golden-wok") });
    const result = solve(source);
    expectValid(result, source);
    expect(result.options[0]!.attendees).not.toContain("sam");
    expect(result.options[0]!.excluded).toContainEqual({ handle: "sam", reason: "allergy" });
  });

  test("UNKNOWN 的过敏事实不算通过：方案状态是 NEEDS_VERIFICATION，并列出这一项", () => {
    const source = input({ restaurants: only("sample:maple-kitchen") });
    const result = solve(source);
    expectValid(result, source);
    expect(result.status).toBe("NEEDS_VERIFICATION");
    expect(result.options[0]!.unknowns).toEqual([{ venueId: "sample:maple-kitchen", fact: "peanut", severe: true }]);
  });

  test("车程缺失的组合不会被当成 0 分钟", () => {
    const olive = placeOf("sample:olive-tree");
    const missing = input({ travel: (from, to) => (from === olive || to === olive ? undefined : travel(from, to)) });
    const result = solve(missing);
    expectValid(result, missing);
    expect(result.options.map((o) => o.dinner.venueId)).not.toContain("sample:olive-tree");

    const none = solve(input({ travel: () => undefined }));
    expect(none.status).toBe("INFEASIBLE");
    expect(none.conflicts.join(" ")).toContain("drive times");
  });

  test("送回时间不晚于每个人的最晚到家时间；赶不上的人被排除（原因是时间）", () => {
    const homeBy = (time: string) => demoPeople().map((p) => (p.handle === "sam" ? { ...p, answer: { ...p.answer, homeBy: time } } : p));
    const relaxed = input({ people: homeBy("21:00"), restaurants: only("sample:maple-kitchen") });
    expectValid(solve(relaxed), relaxed);
    expect(solve(relaxed).options[0]!.attendees).toContain("sam");

    const tight = input({ people: homeBy("18:30"), restaurants: only("sample:maple-kitchen") });
    const result = solve(tight);
    expectValid(result, tight);
    // 早的场次他还没空，晚的场次送不回去：排除原因按选中的那一场算
    expect(result.options[0]!.attendees).not.toContain("sam");
    expect(["home_by", "time"]).toContain(result.options[0]!.excluded.find((e) => e.handle === "sam")!.reason);
  });

  test("优先不用 if_needed 司机；用到时列进 ifNeededDrivers，答应之后就不再算", () => {
    expect(solve(input()).options[0]!.ifNeededDrivers).toEqual([]);

    const noPriya = demoPeople().map((p) => (p.handle === "priya" ? { ...p, answer: { ...p.answer, drives: "no" as const, seats: undefined } } : p));
    const needLeo = solve(input({ people: noPriya }));
    expectValid(needLeo, input({ people: noPriya }));
    expect(needLeo.options[0]!.ifNeededDrivers).toEqual(["leo"]);
    expect(needLeo.options[0]!.attendees).toHaveLength(5);

    const agreed = noPriya.map((p) => (p.handle === "leo" ? { ...p, answer: { ...p.answer, agreedToDrive: true } } : p));
    const a = solve(input({ people: agreed })).options[0]!;
    expect(a.ifNeededDrivers).toEqual([]);
    expect(driverOf(a, "leo")).toBe("leo");

    const declined = noPriya.map((p) => (p.handle === "leo" ? { ...p, answer: { ...p.answer, agreedToDrive: false } } : p));
    const withoutLeo = solve(input({ people: declined }));
    expectValid(withoutLeo, input({ people: declined }));
    // Leo 不开了：只剩 Alex 的 2 个空座，4 个要搭车的人里有 2 个去不了
    expect(withoutLeo.options[0]!.rides.map((ride) => ride.driver)).toEqual(["alex"]);
    expect(withoutLeo.options[0]!.attendees).toHaveLength(3);
    expect(withoutLeo.options[0]!.excluded.map((e) => e.reason)).toContain("seats");
  });

  test("同样的输入得到同样的输出，输入的顺序也不影响", () => {
    const first = solve(input());
    expect(solve(input())).toEqual(first);
    expect(solve(input({ people: [...demoPeople()].reverse(), restaurants: [...restaurants].reverse(), activities: [...activities].reverse() }))).toEqual(first);
  });

  test("demo 场景：Plan A 是 Pine Ridge + Maple Kitchen，5/5 人待核实；Plan B 是 Olive Tree，Leo 因预算被排除", () => {
    const result = solve(input());
    const [a, b] = result.options;
    expect(result.status).toBe("NEEDS_VERIFICATION");
    expect(a).toMatchObject({ label: "A", status: "NEEDS_VERIFICATION", activity: { venueId: "sample:pine-ridge-trail" }, dinner: { venueId: "sample:maple-kitchen" } });
    expect(a!.attendees).toHaveLength(5);
    expect(b).toMatchObject({ label: "B", status: "FEASIBLE", dinner: { venueId: "sample:olive-tree" }, excluded: [{ handle: "leo", reason: "budget" }] });
    // Plan B 给有待核实过敏的人一个不用打电话的选择，而不是把他排除掉
    expect(b!.attendees).toContain("sam");
  });

  test("没有可行方案时，说明主要卡在哪条约束，不写个人预算数字", () => {
    const result = solve(input({ budgetCapCents: 1000 }));
    expect(result.status).toBe("INFEASIBLE");
    expect(result.options).toEqual([]);
    expect(result.conflicts[0]).toContain("budget");
    expect(result.conflicts.join(" ")).not.toMatch(/\$\d/);
  });
});
