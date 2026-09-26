// 状态与版本规则（§5.9）。

import type { Event, EventStatus, Handle, Plan, PlanOption } from "../types";

const NEXT: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["COLLECTING"],
  COLLECTING: ["REVIEW"],
  REVIEW: ["PUBLISHED", "COLLECTING"],
  // 发布后的修订不回退状态：旧方案继续有效，直到替换方案被批准
  PUBLISHED: ["PUBLISHED"],
};

export function transition(event: Event, to: EventStatus): Event {
  if (!NEXT[event.status].includes(to)) throw new Error(`不能从 ${event.status} 变成 ${to}`);
  return { ...event, status: to };
}

/** 答案、设置、核实记录或地图数据有任何变化都要调用：之前的方案随之作废。 */
export function bumpInput(event: Event): Event {
  return { ...event, inputVersion: event.inputVersion + 1 };
}

export type ApprovalCheck = { ok: true } | { ok: false; reason: "not_organizer" | "stale" | "needs_verification" | "infeasible" };

/** 批准检查：只认组织者、只认当前版本、只认可行方案。 */
export function checkApproval(event: Event, plan: Plan, sender: Handle): ApprovalCheck {
  if (sender !== event.organizer) return { ok: false, reason: "not_organizer" };
  if (plan.inputVersion !== event.inputVersion) return { ok: false, reason: "stale" };
  if (plan.status === "NEEDS_VERIFICATION") return { ok: false, reason: "needs_verification" };
  if (plan.status !== "FEASIBLE") return { ok: false, reason: "infeasible" };
  return { ok: true };
}

/** 受影响的人：新旧方案里个人视图不同的人。`view` 由调用方给（一般是个人行程投影）。 */
export function affectedHandles(before: PlanOption | undefined, after: PlanOption, view: (option: PlanOption, handle: Handle) => unknown): Handle[] {
  const handles = new Set([...(before?.attendees ?? []), ...(before?.excluded.map((e) => e.handle) ?? []), ...after.attendees, ...after.excluded.map((e) => e.handle)]);
  return [...handles].filter((handle) => JSON.stringify(before ? view(before, handle) : undefined) !== JSON.stringify(view(after, handle)));
}
