// 确定性求解器（hackathon-plan.md §5.10）：小规模穷举，同样的输入永远得到同样的输出。
// 内部时间一律用"当天第几分钟"，输出时再换成 "HH:MM"。
//
// 每个"活动 × 餐厅 × 开始时间"：
//   1. 预算、过敏（UNSUPPORTED 排除，UNKNOWN 记为待核实）；
//   2. 按直达车程估算，时间肯定不行的人先排除；
//   3. 从少到多地试"排除谁 × 用哪些可选司机 × 乘客怎么分车"，每辆车取可行的接人、送人顺序里最快的；
// 然后按字典序排出 Plan A，Plan B 是地点不同、不用核实的最好方案。

import { fromMinutes, toMinutes } from "../shared/time";
import type { Answer, Candidate, Exclusion, ExclusionReason, Fact, Handle, PlanOption, PlanResult, Ride, Stop, TimeWindow, Unknown, Venue } from "../shared/types";
import { allergenKey, isSevere } from "./allergens";

/** 开始时间的步长、每段车程的缓冲、默认时长（分钟）。 */
const SLOT_MINUTES = 30;
const BUFFER_MINUTES = 10;
const DEFAULT_ACTIVITY_MINUTES = 120;
const DINNER_MINUTES = 90;
/** 穷举能处理的人数上限（plan §5.10：≤ 8 人）。 */
const MAX_PEOPLE = 8;
/** 晚餐开始时间取整到一刻钟（订座一般按刻）；接送时间取整到 5 分钟，接人往前取、送到往后取，只会早到不会迟到。 */
const DINNER_ROUNDING = 15;
const STOP_ROUNDING = 5;
/** 一个开始时间最多试多少种分车，保证人多时也能很快返回。 */
const MAX_TRIES = 20_000;
/** 一辆车的乘客不超过这么多时枚举全部顺序，再多就按"先接最近的"。 */
const MAX_ORDERED = 5;

export interface SolverPerson {
  handle: Handle;
  answer: Answer;
}

export interface SolverInput {
  window: TimeWindow;
  budgetCapCents?: number;
  /** 已确认答案的参与者（组织者参加的话也在这里），每人都有集合点。 */
  people: SolverPerson[];
  activities: Candidate[];
  restaurants: Candidate[];
  /** 驾车分钟数；undefined 表示未知，绝不能当成 0。同一地点之间不会问。 */
  travel: (fromPlaceId: string, toPlaceId: string) => number | undefined;
  /** 场地对某种过敏的事实，已经合并了人工核实记录。 */
  fact: (venueId: string, fact: string) => Fact;
}

type Role = "driver" | "optional" | "rider";

interface Traveler {
  handle: Handle;
  place: string;
  free: [number, number][];
  homeBy?: number;
  budget?: number;
  allergens: { key: string; severe: boolean }[];
  role: Role;
  seats: number;
}

interface Clock {
  start: number;
  activityEnd: number;
  dinnerStart: number;
  dinnerEnd: number;
}

/** 一个"活动 × 餐厅"组合共用的东西。 */
interface Pair {
  input: SolverInput;
  activity: Candidate;
  restaurant: Candidate;
  windowStart: number;
  windowEnd: number;
}

interface Car {
  driver: Traveler;
  passengers: Traveler[];
  pickups: { traveler: Traveler; at: number }[];
  dropoffs: { traveler: Traveler; at: number }[];
  detour: number;
  drive: number;
}

interface RideSolution {
  cars: Car[];
  extraDrivers: Traveler[];
}

interface Scored extends PlanOption {
  /** 排序用：待核实项的个数。 */
  checks: number;
  /** 餐厅对他的过敏不确定的参加者：选 Plan B 时尽量留住他们。 */
  flagged: Handle[];
}

export function solve(input: SolverInput): PlanResult {
  if (!input.people.length) return infeasible(["Nobody has confirmed yet."]);
  if (input.people.length > MAX_PEOPLE) return infeasible([`I can plan for up to ${MAX_PEOPLE} people at a time.`]);
  if (!input.activities.length || !input.restaurants.length) return infeasible(["I couldn't find candidate places in this area."]);

  const travelers = input.people.map((person) => toTraveler(person, input.budgetCapCents)).sort(byHandle);
  const notes = new Set<string>();
  const options: Scored[] = [];
  for (const activity of [...input.activities].sort(byVenueId)) {
    for (const restaurant of [...input.restaurants].sort(byVenueId)) {
      const pair: Pair = { input, activity, restaurant, windowStart: toMinutes(input.window.start), windowEnd: toMinutes(input.window.end) };
      const best = bestForPair(pair, travelers, notes);
      if (best) options.push(best);
    }
  }

  options.sort(compareOptions);
  const minimum = Math.min(2, travelers.length);
  const [a, ...rest] = options.filter((option) => option.attendees.length >= minimum);
  if (!a) return infeasible(explain(options[0], notes));
  // Plan B：地点不同、不用核实；优先留住 A 里有待核实过敏的人（给他们一个不用打电话的选择），而不是把他们排除掉
  const alternatives = rest.filter((option) => option.status === "FEASIBLE" && (option.activity.venueId !== a.activity.venueId || option.dinner.venueId !== a.dinner.venueId));
  const b = alternatives.find((option) => a.flagged.every((handle) => option.attendees.includes(handle))) ?? alternatives[0];
  return { status: a.status, options: [finish(a, "A"), ...(b ? [finish(b, "B")] : [])], conflicts: [] };
}

function infeasible(conflicts: string[]): PlanResult {
  return { status: "INFEASIBLE", options: [], conflicts };
}

function toTraveler(person: SolverPerson, capCents: number | undefined): Traveler {
  const { answer } = person;
  const budgets = [answer.budgetCapCents, capCents].filter((cents): cents is number => cents !== undefined);
  return {
    handle: person.handle,
    place: answer.pickupPlaceId ?? "",
    free: (answer.free ?? []).map((window) => [toMinutes(window.start), toMinutes(window.end)]),
    homeBy: answer.homeBy === undefined ? undefined : toMinutes(answer.homeBy),
    budget: budgets.length ? Math.min(...budgets) : undefined,
    allergens: (answer.allergies ?? []).map((text) => ({ key: allergenKey(text), severe: isSevere(text) })),
    role: roleOf(answer),
    seats: answer.seats ?? 0,
  };
}

function roleOf(answer: Answer): Role {
  if (answer.drives === "yes") return "driver";
  if (answer.drives !== "if_needed") return "rider";
  if (answer.agreedToDrive === undefined) return "optional";
  return answer.agreedToDrive ? "driver" : "rider";
}

/** 一段车程加缓冲；同一地点之间是 0；未知是 undefined。 */
function leg(pair: Pair, from: string, to: string): number | undefined {
  if (from === to) return 0;
  const minutes = pair.input.travel(from, to);
  return minutes === undefined ? undefined : minutes + BUFFER_MINUTES;
}

function bestForPair(pair: Pair, travelers: Traveler[], notes: Set<string>): Scored | undefined {
  const { activity, restaurant } = pair;
  const cost = maxPrice(activity.venue, restaurant.venue);
  if (cost === undefined) {
    notes.add(`I don't have prices for ${activity.venue.priceMaxCents === undefined ? activity.place.name : restaurant.place.name}.`);
    return undefined;
  }
  const hop = leg(pair, activity.place.id, restaurant.place.id);
  if (hop === undefined) {
    notes.add(`I don't have drive times between ${activity.place.name} and ${restaurant.place.name}.`);
    return undefined;
  }

  // 不随开始时间变化：预算、过敏，以及每个人到活动地点、从餐厅回去的直达车程
  const excluded: Exclusion[] = [];
  const unknowns = new Map<Handle, Unknown[]>();
  const direct = new Map<Handle, { to: number; back: number }>();
  const pool: Traveler[] = [];
  for (const person of travelers) {
    if (person.budget !== undefined && cost > person.budget) {
      excluded.push({ handle: person.handle, reason: "budget" });
      continue;
    }
    const facts = person.allergens.map((allergen) => ({ ...allergen, value: pair.input.fact(restaurant.venue.id, allergen.key) }));
    if (facts.some((fact) => fact.value === "UNSUPPORTED")) {
      excluded.push({ handle: person.handle, reason: "allergy" });
      continue;
    }
    const to = leg(pair, person.place, activity.place.id);
    const back = leg(pair, restaurant.place.id, person.place);
    if (to === undefined || back === undefined) {
      notes.add(`I don't have drive times for everyone's pickup spot to ${activity.place.name} and ${restaurant.place.name}.`);
      return undefined;
    }
    unknowns.set(
      person.handle,
      facts.filter((fact) => fact.value === "UNKNOWN").map((fact) => ({ venueId: restaurant.venue.id, fact: fact.key, severe: fact.severe })),
    );
    direct.set(person.handle, { to, back });
    pool.push(person);
  }

  const duration = activity.venue.durationMinutes ?? DEFAULT_ACTIVITY_MINUTES;
  let best: Scored | undefined;
  for (let start = pair.windowStart; start + duration + hop + DINNER_MINUTES <= pair.windowEnd; start += SLOT_MINUTES) {
    const dinnerStart = roundUp(start + duration + hop, DINNER_ROUNDING);
    const clock: Clock = { start, activityEnd: start + duration, dinnerStart, dinnerEnd: dinnerStart + DINNER_MINUTES };
    // 直达都赶不上的人，怎么分车都不行
    const timeExcluded: Exclusion[] = [];
    const candidates = pool.filter((person) => {
      const { to, back } = direct.get(person.handle)!;
      const reason = timeProblem(person, clock.start - to, clock.dinnerEnd + back);
      if (reason) timeExcluded.push({ handle: person.handle, reason });
      return !reason;
    });
    const found = searchRides(pair, candidates, clock, unknowns);
    const option = toOption(pair, clock, cost, found.rides, [...excluded, ...timeExcluded, ...found.excluded], unknowns);
    if (!best || compareOptions(option, best) < 0) best = option;
  }
  return best;
}

function maxPrice(activity: Venue, restaurant: Venue): number | undefined {
  if (activity.priceMaxCents === undefined || restaurant.priceMaxCents === undefined) return undefined;
  return activity.priceMaxCents + restaurant.priceMaxCents;
}

/** 这个人能不能在 pickup 之前出门、dropoff 之后才到家。 */
function timeProblem(person: Traveler, pickup: number, dropoff: number): ExclusionReason | undefined {
  if (!person.free.some(([from, to]) => from <= pickup && dropoff <= to)) return "time";
  if (person.homeBy !== undefined && dropoff > person.homeBy) return "home_by";
  return undefined;
}

/**
 * 在还能参加的人里分车：先让尽量多的人参加，同样多人时按排序规则取最好的。
 * 谁都分不上车时返回空车组、所有人都排除，没有可行方案时用它说明卡在哪。
 */
function searchRides(pair: Pair, people: Traveler[], clock: Clock, unknowns: Map<Handle, Unknown[]>): { rides: RideSolution; excluded: Exclusion[] } {
  const tries = { count: 0 };
  const routes = new Map<string, Car | null>();
  const exclude = (dropped: Traveler[]) => dropped.map((person) => ({ handle: person.handle, reason: dropReason(person, people) }));
  for (let drop = 0; drop < people.length && tries.count <= MAX_TRIES; drop++) {
    let best: { rides: RideSolution; dropped: Traveler[]; checks: number } | undefined;
    for (const dropped of combinations(people, drop)) {
      const kept = people.filter((person) => !dropped.includes(person));
      const rides = bestAssignment(pair, kept, clock, routes, tries);
      if (rides) {
        const checks = countChecks(kept, unknowns);
        if (!best || compareRides(rides, checks, best.rides, best.checks) < 0) best = { rides, dropped, checks };
      }
      if (tries.count > MAX_TRIES) break;
    }
    if (best) return { rides: best.rides, excluded: exclude(best.dropped) };
  }
  return { rides: { cars: [], extraDrivers: [] }, excluded: exclude(people) };
}

/** 被分车排除的人：乘客比所有能开车的人的空座还多，就是座位不够；否则是绕路之后时间对不上。 */
function dropReason(person: Traveler, people: Traveler[]): ExclusionReason {
  if (person.role === "driver") return "time";
  const seats = people.filter((p) => p.role !== "rider").reduce((sum, p) => sum + p.seats, 0);
  const riders = people.filter((p) => p.role === "rider").length;
  return riders > seats ? "seats" : "time";
}

/** 这些人全部参加时最好的分车：可选司机用得越少越好，其次比绕路和总车程。 */
function bestAssignment(pair: Pair, kept: Traveler[], clock: Clock, routes: Map<string, Car | null>, tries: { count: number }): RideSolution | undefined {
  const fixed = kept.filter((person) => person.role === "driver");
  const optional = kept.filter((person) => person.role === "optional");
  for (let extra = 0; extra <= optional.length; extra++) {
    let best: RideSolution | undefined;
    for (const extraDrivers of combinations(optional, extra)) {
      const drivers = [...fixed, ...extraDrivers];
      const riders = kept.filter((person) => !drivers.includes(person));
      if (drivers.reduce((sum, driver) => sum + driver.seats, 0) < riders.length) continue;
      for (const loads of assignments(riders, drivers)) {
        tries.count++;
        const cars = drivers.map((driver, index) => route(pair, driver, loads[index] ?? [], clock, routes));
        if (cars.every((car): car is Car => car !== null)) {
          const rides = { cars, extraDrivers };
          if (!best || compareRides(rides, 0, best, 0) < 0) best = rides;
        }
        if (tries.count > MAX_TRIES) return best;
      }
    }
    if (best) return best;
  }
  return undefined;
}

function countChecks(kept: Traveler[], unknowns: Map<Handle, Unknown[]>): number {
  return new Set(kept.flatMap((person) => (unknowns.get(person.handle) ?? []).map((unknown) => unknown.fact))).size;
}

function compareRides(a: RideSolution, aChecks: number, b: RideSolution, bChecks: number): number {
  return a.extraDrivers.length - b.extraDrivers.length || aChecks - bChecks || maxDetour(a) - maxDetour(b) || totalDrive(a) - totalDrive(b);
}

function maxDetour(rides: RideSolution): number {
  return Math.max(0, ...rides.cars.map((car) => car.detour));
}

function totalDrive(rides: RideSolution): number {
  return rides.cars.reduce((sum, car) => sum + car.drive, 0);
}

/** 一辆车：接人顺序和送人顺序各取可行的里面最快的；时间对不上返回 null。结果按车上的人和开始时间缓存。 */
function route(pair: Pair, driver: Traveler, passengers: Traveler[], clock: Clock, routes: Map<string, Car | null>): Car | null {
  const key = [driver.handle, ...passengers.map((p) => p.handle).sort()].join("|");
  const cached = routes.get(key);
  if (cached !== undefined) return cached;
  const car = buildCar(pair, driver, passengers, clock);
  routes.set(key, car);
  return car;
}

function buildCar(pair: Pair, driver: Traveler, passengers: Traveler[], clock: Clock): Car | null {
  const direct = leg(pair, driver.place, pair.activity.place.id);
  if (direct === undefined) return null;
  let pickups: Car["pickups"] | undefined;
  for (const order of orders(pair, passengers, driver.place)) {
    const timed = pickupTimes(pair, driver, order, clock.start);
    if (timed && (!pickups || timed[0]!.at > pickups[0]!.at)) pickups = timed;
  }
  let dropoffs: Car["dropoffs"] | undefined;
  for (const order of orders(pair, passengers, pair.restaurant.place.id)) {
    const timed = dropoffTimes(pair, driver, order, clock.dinnerEnd);
    if (timed && (!dropoffs || timed.at(-1)!.at < dropoffs.at(-1)!.at)) dropoffs = timed;
  }
  if (!pickups || !dropoffs) return null;
  // 同一个人的接和送要落在他同一段有空的时间里
  const pickupAt = new Map(pickups.map((stop) => [stop.traveler.handle, stop.at]));
  for (const stop of dropoffs) {
    if (timeProblem(stop.traveler, pickupAt.get(stop.traveler.handle)!, stop.at)) return null;
  }
  const departure = pickups[0]!.at;
  const home = dropoffs.at(-1)!.at;
  const hop = leg(pair, pair.activity.place.id, pair.restaurant.place.id) ?? 0;
  return { driver, passengers, pickups, dropoffs, detour: clock.start - departure - direct, drive: clock.start - departure + hop + (home - clock.dinnerEnd) };
}

/** 从活动开始时间往回推：最后一个乘客接上之后直接去活动地点，司机最先出发。 */
function pickupTimes(pair: Pair, driver: Traveler, order: Traveler[], start: number): Car["pickups"] | undefined {
  const stops: Car["pickups"] = [];
  let at = start;
  let next = pair.activity.place.id;
  for (const traveler of [...order].reverse()) {
    const minutes = leg(pair, traveler.place, next);
    if (minutes === undefined) return undefined;
    at = roundDown(at - minutes, STOP_ROUNDING);
    if (!canLeaveAt(traveler, at)) return undefined;
    stops.unshift({ traveler, at });
    next = traveler.place;
  }
  const minutes = leg(pair, driver.place, next);
  if (minutes === undefined) return undefined;
  at = roundDown(at - minutes, STOP_ROUNDING);
  if (at < pair.windowStart || !canLeaveAt(driver, at)) return undefined;
  return [{ traveler: driver, at }, ...stops];
}

/** 从晚餐结束往后推：按顺序送人，最后司机到家。 */
function dropoffTimes(pair: Pair, driver: Traveler, order: Traveler[], dinnerEnd: number): Car["dropoffs"] | undefined {
  const stops: Car["dropoffs"] = [];
  let at = dinnerEnd;
  let previous = pair.restaurant.place.id;
  for (const traveler of [...order, driver]) {
    const minutes = leg(pair, previous, traveler.place);
    if (minutes === undefined) return undefined;
    at = roundUp(at + minutes, STOP_ROUNDING);
    if (at > pair.windowEnd || !canArriveBy(traveler, at)) return undefined;
    stops.push({ traveler, at });
    previous = traveler.place;
  }
  return stops;
}

function canLeaveAt(person: Traveler, at: number): boolean {
  return person.free.some(([from, to]) => from <= at && at <= to);
}

function canArriveBy(person: Traveler, at: number): boolean {
  return person.free.some(([from, to]) => from <= at && at <= to) && (person.homeBy === undefined || at <= person.homeBy);
}

/** 乘客的接送顺序：人少时枚举全部排列，人多时从起点开始每次接最近的。 */
function* orders(pair: Pair, passengers: Traveler[], from: string): Generator<Traveler[]> {
  if (passengers.length <= MAX_ORDERED) {
    yield* permutations(passengers);
    return;
  }
  const left = [...passengers];
  const order: Traveler[] = [];
  let at = from;
  while (left.length) {
    left.sort((a, b) => (leg(pair, at, a.place) ?? Infinity) - (leg(pair, at, b.place) ?? Infinity) || byHandle(a, b));
    const next = left.shift()!;
    order.push(next);
    at = next.place;
  }
  yield order;
}

function toOption(
  pair: Pair,
  clock: Clock,
  cost: number,
  rides: RideSolution,
  excluded: Exclusion[],
  unknowns: Map<Handle, Unknown[]>,
): Scored {
  const attendees = rides.cars.flatMap((car) => [car.driver.handle, ...car.passengers.map((p) => p.handle)]).sort();
  const merged = new Map<string, Unknown>();
  for (const unknown of attendees.flatMap((handle) => unknowns.get(handle) ?? [])) {
    const seen = merged.get(unknown.fact);
    merged.set(unknown.fact, { ...unknown, severe: unknown.severe || Boolean(seen?.severe) });
  }
  const checks = [...merged.values()].sort((a, b) => a.fact.localeCompare(b.fact));
  return {
    label: "",
    status: checks.length ? "NEEDS_VERIFICATION" : "FEASIBLE",
    activity: { venueId: pair.activity.venue.id, start: fromMinutes(clock.start), end: fromMinutes(clock.activityEnd) },
    dinner: { venueId: pair.restaurant.venue.id, start: fromMinutes(clock.dinnerStart), end: fromMinutes(clock.dinnerEnd) },
    attendees,
    excluded: [...excluded].sort((a, b) => a.handle.localeCompare(b.handle)),
    rides: rides.cars.map(toRide),
    costMaxCents: cost,
    unknowns: checks,
    ifNeededDrivers: rides.extraDrivers.map((driver) => driver.handle).sort(),
    maxDetourMinutes: maxDetour(rides),
    driveMinutes: totalDrive(rides),
    checks: checks.length,
    flagged: attendees.filter((handle) => unknowns.get(handle)?.length),
  };
}

function toRide(car: Car): Ride {
  const stop = ({ traveler, at }: { traveler: Traveler; at: number }): Stop => ({ at: fromMinutes(at), placeId: traveler.place, handle: traveler.handle });
  return {
    driver: car.driver.handle,
    passengers: car.passengers.map((p) => p.handle),
    pickups: car.pickups.map(stop),
    dropoffs: car.dropoffs.map(stop),
    detourMinutes: car.detour,
  };
}

function finish(option: Scored, label: string): PlanOption {
  const { checks: _checks, flagged: _flagged, ...rest } = option;
  return { ...rest, label };
}

/** 字典序：参加人数多 → 可选司机少 → 待核实少 → 最大绕路少 → 总车程少 → 费用低 → 开始早 → 场地 id。 */
function compareOptions(a: Scored, b: Scored): number {
  return (
    b.attendees.length - a.attendees.length ||
    a.ifNeededDrivers.length - b.ifNeededDrivers.length ||
    a.checks - b.checks ||
    a.maxDetourMinutes - b.maxDetourMinutes ||
    a.driveMinutes - b.driveMinutes ||
    a.costMaxCents - b.costMaxCents ||
    a.activity.start.localeCompare(b.activity.start) ||
    a.activity.venueId.localeCompare(b.activity.venueId) ||
    a.dinner.venueId.localeCompare(b.dinner.venueId)
  );
}

const REASON_HINTS: Partial<Record<ExclusionReason, string>> = {
  time: "Nobody's free for the whole outing in that window — try a wider window or a shorter plan.",
  home_by: "Some people need to be home too early for this — try starting earlier.",
  budget: "The places I found are over some people's budgets — try a higher cap or cheaper places.",
  allergy: "None of the restaurants I found is safe for everyone's allergies.",
  seats: "There aren't enough seats — more people need rides than there are free seats.",
};

/** 没有可行方案时：拿人最多的那个不完整方案，说它主要卡在哪条约束。 */
function explain(closest: Scored | undefined, notes: Set<string>): string[] {
  const counts = new Map<ExclusionReason, number>();
  for (const { reason } of closest?.excluded ?? []) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const [main] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const hint = main ? REASON_HINTS[main[0]] : undefined;
  const conflicts = [...(hint ? [hint] : []), ...notes];
  return conflicts.length ? conflicts : ["I couldn't find a time and place that works for at least two people."];
}

function roundUp(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step;
}

function roundDown(minutes: number, step: number): number {
  return Math.floor(minutes / step) * step;
}

function byHandle(a: { handle: Handle }, b: { handle: Handle }): number {
  return a.handle.localeCompare(b.handle);
}

function byVenueId(a: Candidate, b: Candidate): number {
  return a.venue.id.localeCompare(b.venue.id);
}

/** 从 items 里取 k 个的所有组合，按原顺序。 */
function* combinations<T>(items: T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i]!, ...rest];
  }
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (const [index, item] of items.entries()) {
    for (const rest of permutations([...items.slice(0, index), ...items.slice(index + 1)])) yield [item, ...rest];
  }
}

/** 把乘客分到各辆车（不超座）的所有方式：返回每个司机名下的乘客列表。 */
function* assignments(riders: Traveler[], drivers: Traveler[]): Generator<Traveler[][]> {
  const loads: Traveler[][] = drivers.map(() => []);
  function* place(index: number): Generator<Traveler[][]> {
    if (index === riders.length) {
      yield loads.map((load) => [...load]);
      return;
    }
    for (const [slot, driver] of drivers.entries()) {
      const load = loads[slot]!;
      if (load.length >= driver.seats) continue;
      load.push(riders[index]!);
      yield* place(index + 1);
      load.pop();
    }
  }
  yield* place(0);
}
