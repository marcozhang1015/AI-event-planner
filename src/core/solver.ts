// 确定性求解器（§5.10）。C 负责实现；先照 test/solver.test.ts 里的不变量写测试。

import type { Answer, Event, Member, Place, PlanResult, Venue, Verification } from "../types";

export interface SolverInput {
  event: Event;
  /** 已确认答案的参与者（组织者如果参加，也在这里）。 */
  attendees: { member: Member; answer: Answer }[];
  places: Map<string, Place>;
  venues: Venue[];
  /** 驾车分钟数；返回 undefined 表示未知，绝不能当成 0。 */
  travel: (fromPlaceId: string, toPlaceId: string) => number | undefined;
  verifications: Verification[];
}

export function solve(_input: SolverInput): PlanResult {
  // TODO(C, M2)：枚举日程 → 逐人判断 → 分车 → 字典序排序 → 最多两个方案
  return { status: "INFEASIBLE", options: [], conflicts: ["solver not implemented yet"] };
}
