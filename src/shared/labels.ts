// 网页和 iMessage 共用的说法：排除原因类别、价格区间、过敏的说法。只依赖类型和格式化工具，网页也直接引用。

import type { VenueRef } from "./views";
import { fmtMoney } from "./time";
import type { ExclusionReason } from "./types";

/** 给组织者看的排除原因类别：只有类别，没有预算数字或具体过敏。 */
export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  time: "schedule doesn't fit",
  home_by: "needs to be home earlier",
  budget: "over budget",
  allergy: "allergy",
  seats: "not enough seats",
  no_answer: "hasn't replied",
};

/** 场地价格："$22–30"、"$30"；免费是 "free"；没有价格数据时是 undefined。 */
export function priceSpan(venue: Pick<VenueRef, "priceMinCents" | "priceMaxCents">): string | undefined {
  const { priceMinCents: min, priceMaxCents: max } = venue;
  if (max === undefined) return undefined;
  if (max === 0) return "free";
  return min === undefined || min === max ? fmtMoney(max) : `${fmtMoney(min)}–${fmtMoney(max).slice(1)}`;
}

/** "a severe peanut allergy"、"an egg allergy"。 */
export function allergyPhrase(fact: string, severe: boolean): string {
  const words = `${severe ? "severe " : ""}${fact} allergy`;
  return `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;
}
