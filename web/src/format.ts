// 页面文案的小工具：人名、价格、排除原因。时刻和金额的格式用 @shared/time。

import type { PersonRef, VenueRef, VisitView } from "@shared/views";
import { fmtMoney, fmtWindow } from "@shared/time";
import { priceSpan } from "@shared/labels";
import type { ExclusionReason } from "@shared/types";

/** 看页面的本人显示成 "You"。 */
export function nameOf(person: PersonRef): string {
  return person.me ? "You" : person.name;
}

/** 句子中间用：本人写成小写的 "you"。 */
export function nameInSentence(person: PersonRef): string {
  return person.me ? "you" : person.name;
}

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** ["Sam", "Priya", "Leo"] → "Sam, Priya, and Leo" */
export function listOf(items: string[]): string {
  return LIST.format(items);
}

/** 变更说明是按嵌在句子里的写法生成的（"you're driving now"）；单独成行时首字母大写。 */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 地图图例和路线名："Priya's car"；本人开的是 "Your car"。 */
export function carOf(driver: PersonRef): string {
  return driver.me ? "Your car" : `${driver.name}'s car`;
}

/** 场地价格："Free"、"$22–30"、"$30"；没有价格数据时返回 undefined。 */
function priceRange(venue: VenueRef): string | undefined {
  const span = priceSpan(venue);
  return span === "free" ? "Free" : span;
}

/** "3:45–5:45 PM · Free" */
export function activityDetail(visit: VisitView): string {
  const price = priceRange(visit.venue);
  const perPerson = price && (price === "Free" ? price : `${price} per person`);
  return [fmtWindow(visit), perPerson].filter(Boolean).join(" · ");
}

/** "~$22–30 per person"：餐厅价格是地图数据里的估计。 */
export function dinnerDetail(visit: VisitView): string | undefined {
  const price = priceRange(visit.venue);
  return price && (price === "Free" ? price : `~${price} per person`);
}

export function costText(cents: number): string {
  return cents === 0 ? "free" : `up to ${fmtMoney(cents)}`;
}

/** 被排除的人在自己的行程页上看到的说法。 */
export const EXCLUSION_NOTE: Record<ExclusionReason, string> = {
  time: "The time that works for the group doesn't fit your schedule.",
  home_by: "The plan runs later than you need to be home.",
  budget: "The plan that works for the group goes over your budget.",
  allergy: "The restaurant can't safely handle your allergy.",
  seats: "There weren't enough seats in the cars this time.",
  no_answer: "I didn't hear back from you in time.",
};

/** "555-0142" → "tel:5550142" */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
