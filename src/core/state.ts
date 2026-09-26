// 状态与版本规则（§5.9）。

import type { Event, EventStatus, Handle, Plan, PlanOption, Ride, Stop } from "../shared/types";

const NEXT: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["COLLECTING"],
  COLLECTING: ["REVIEW"],
  REVIEW: ["PUBLISHED"],
  // 发布后的修订不回退状态：旧方案继续有效，直到替换方案被批准
  PUBLISHED: ["PUBLISHED"],
};

export function transition(event: Event, to: EventStatus): Event {
  if (!NEXT[event.status].includes(to)) throw new Error(`不能从 ${event.status} 变成 ${to}`);
  return { ...event, status: to };
}

/** 答案、设置、核实记录、参与的人有任何变化都要调用：之前的方案随之作废。 */
export function bumpInput(event: Event): Event {
  return { ...event, inputVersion: event.inputVersion + 1 };
}

export type ApprovalProblem = "not_organizer" | "stale" | "infeasible" | "ambiguous" | "no_option" | "needs_verification" | "waiting_on_driver";

export type ApprovalCheck = { ok: true; option: PlanOption } | { ok: false; reason: ApprovalProblem };

/**
 * 批准检查：只认组织者、只认当前版本、只认存在的、不用核实、不在等司机答复的选项。
 * 没说选哪个时：发布后的更新默认 A，只有一个选项时就是它，否则要问。
 */
export function checkApproval(event: Event, plan: Plan, sender: Handle, label?: string): ApprovalCheck {
  if (sender !== event.organizer) return { ok: false, reason: "not_organizer" };
  if (plan.inputVersion !== event.inputVersion) return { ok: false, reason: "stale" };
  if (!plan.options.length) return { ok: false, reason: "infeasible" };
  if (!label && !event.published && plan.options.length > 1) return { ok: false, reason: "ambiguous" };
  const option = label ? plan.options.find((candidate) => candidate.label === label) : plan.options[0];
  if (!option) return { ok: false, reason: "no_option" };
  if (option.unknowns.length) return { ok: false, reason: "needs_verification" };
  if (option.ifNeededDrivers.length) return { ok: false, reason: "waiting_on_driver" };
  return { ok: true, option };
}

/** 某个人在某个选项里坐哪辆车、在哪上下车。不在方案里返回 undefined。 */
export function rideOf(option: PlanOption, handle: Handle): { ride: Ride; pickup: Stop; dropoff: Stop } | undefined {
  const ride = option.rides.find((candidate) => candidate.driver === handle || candidate.passengers.includes(handle));
  const pickup = ride?.pickups.find((stop) => stop.handle === handle);
  const dropoff = ride?.dropoffs.find((stop) => stop.handle === handle);
  return ride && pickup && dropoff ? { ride, pickup, dropoff } : undefined;
}

/** 个人视图：时间、地点、车、上下车点、费用上界。受影响名单比较的就是它。 */
export function personalView(option: PlanOption, handle: Handle): unknown {
  const seat = rideOf(option, handle);
  if (!seat) return { excluded: option.excluded.find((exclusion) => exclusion.handle === handle)?.reason ?? "absent" };
  const { ride, pickup, dropoff } = seat;
  return {
    activity: option.activity,
    dinner: option.dinner,
    cost: option.costMaxCents,
    driver: ride.driver,
    carmates: [ride.driver, ...ride.passengers].filter((other) => other !== handle).sort(),
    pickup,
    dropoff,
    // 司机要知道整条路线
    route: ride.driver === handle ? [ride.pickups, ride.dropoffs] : undefined,
  };
}

/** 这个人在新旧两个选项里的个人视图不一样。 */
export function isAffected(before: PlanOption, after: PlanOption, handle: Handle): boolean {
  return JSON.stringify(personalView(before, handle)) !== JSON.stringify(personalView(after, handle));
}

/** 受影响的人：新旧方案里个人视图不同的人（两边出现过的人都算上，包括被排除的）。 */
export function affectedHandles(before: PlanOption, after: PlanOption): Handle[] {
  const handles = new Set([...before.attendees, ...before.excluded.map((e) => e.handle), ...after.attendees, ...after.excluded.map((e) => e.handle)]);
  return [...handles].filter((handle) => isAffected(before, after, handle));
}
