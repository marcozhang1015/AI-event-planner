// 收集一个人的约束（§4.3 流程 2）：参与者和报名参加的组织者共用。
// 抽取 → 地理编码 → 问下一个缺的字段 / 发摘要 → 确认 → 可选邮箱。确认之后随时可以改：改了就重新发摘要，等本人再确认。

import type { BrainContext } from "../brain/extract";
import {
  isDecline,
  isSkip,
  parseBudgetReply,
  parseChoice,
  parseDayPart,
  parseDrives,
  parseDrivesReply,
  parseEmail,
  parseFood,
  parseHomeBy,
  parseSeats,
  parseSeatsReply,
  parseTimeWindow,
  parseYesNo,
  rejectsAmount,
} from "../brain/parse";
import { distanceKm } from "../core/geo";
import { correctsProfile, dropRemembered, remember } from "../core/memory";
import { bumpInput } from "../core/state";
import { regionQuery } from "../maps";
import { react, say, summary, type Outbound } from "../out/actions";
import { templates as t } from "../out/imessage";
import { ownFields } from "../out/privacy";
import { fmtMoney, fmtWindow, weekdayName } from "../shared/time";
import type { Answer, AnswerPatch, Area, Event, Extraction, Member, Place, Session } from "../shared/types";
import { organizerName, participantsOf, venuesOf } from "../store/changes";
import { brainContext, confirmsSummary, lastTextId, nextQuestion, onlyReactions, textOf, type FlowDeps, type Turn } from "./context";
import { afterConfirm } from "./planning";

const ATTENDEE_FIELDS = ["free", "remembered", "allergies", "drives", "seats", "pickup", "budget"] as const;
type AttendeeField = (typeof ATTENDEE_FIELDS)[number];
/** 上一个问题问的是什么：一般是某个字段；own_budget 是本人不接受组织者的上限之后，改问他自己最多花多少。 */
type Asked = AttendeeField | "own_budget";

/** 这个人现在是什么状态、答到哪了。 */
export interface Collecting {
  session: Session;
  event: Event;
  member: Member;
  answer: Answer;
}

/** 确认（和问完邮箱）之后回本人的话：参与者和组织者不一样；undefined 表示不用说。 */
export type Done = () => string | undefined;

export function missingAttendeeFields(answer: Answer): AttendeeField[] {
  const missing: AttendeeField[] = [];
  if (!answer.free) missing.push("free");
  // 从记忆预填的偏好：一句话请本人确认，代替逐项再问
  if (answer.remembered) missing.push("remembered");
  if (!answer.allergies) missing.push("allergies");
  if (!answer.drives) missing.push("drives");
  if ((answer.drives === "yes" || answer.drives === "if_needed") && answer.seats === undefined) missing.push("seats");
  // 集合点要地理编码成功才算有（司机的出发点也是它）
  if (answer.drives && !answer.pickupPlaceId) missing.push("pickup");
  if (answer.budgetCapCents === undefined) missing.push("budget");
  return missing;
}

export function applyAnswerPatch(answer: Answer, patch: AnswerPatch, event: Event): Answer {
  const next: Answer = { ...answer };
  if (patch.free) {
    // "after 3" 只给了开始时间：另一头用活动时间窗补上
    const start = patch.free.start ?? event.window?.start;
    const end = patch.free.end ?? event.window?.end;
    if (start && end) next.free = [{ start, end }];
  }
  if (patch.homeBy) next.homeBy = patch.homeBy;
  if (patch.budgetCapCents !== undefined) next.budgetCapCents = patch.budgetCapCents;
  if (patch.allergies) next.allergies = patch.allergies;
  if (patch.diet) next.diet = patch.diet;
  if (patch.drives) {
    next.drives = patch.drives;
    if (patch.drives === "no") next.seats = undefined;
    // 改了开车的意愿，之前"这次开不开"的答复就不作数了
    if (patch.drives !== answer.drives) next.agreedToDrive = undefined;
  }
  if (patch.seats !== undefined) next.seats = patch.seats;
  if (patch.pickupQuery && patch.pickupQuery !== answer.pickupQuery) {
    next.pickupQuery = patch.pickupQuery;
    next.pickupPlaceId = undefined;
  }
  return next;
}

function answerChanged(before: Answer, after: Answer): boolean {
  const fields = (answer: Answer) => JSON.stringify(ownFields({ ...answer, confirmed: false }));
  return fields(before) !== fields(after);
}

/** "I'm near the library" / "from North Station" → 位置描述。 */
function parseNear(text: string): string | undefined {
  return text.match(/\b(?:near|by|at|from|around)\s+((?:the\s+)?[\w' -]{3,40}?)(?=[?,.!;]|$| and\b| but\b)/i)?.[1]?.trim();
}

/** LLM 不可用时的规则解析。`asked` 是上一个问题问的字段；没有就只试不容易误判的几项。 */
function fallbackAnswerPatch(text: string, event: Event, asked?: Asked): AnswerPatch {
  const patch: AnswerPatch = {};
  // 确认记忆时，回复里也可能顺带改了开车、座位或集合点
  const tryAll = asked === undefined || asked === "remembered";
  if (tryAll || asked === "free") {
    // 正在问有空的时间时，"evening"、"yes"（整段都行）也算回答
    const free = parseTimeWindow(text, event.window) ?? (asked === "free" ? (parseDayPart(text) ?? (parseYesNo(text) === true ? {} : undefined)) : undefined);
    if (free) patch.free = free;
  }
  const homeBy = parseHomeBy(text, event.window);
  if (homeBy) patch.homeBy = homeBy;
  if (asked === "allergies") {
    const food = parseFood(text);
    if (food) {
      patch.allergies = food.allergies;
      if (food.diet) patch.diet = food.diet;
    }
  }
  // 正在问的问题才认 yes / no、"just one" 这类短回答；其他时候要说得明确
  if (tryAll || asked === "drives") {
    const drives = asked === "drives" ? parseDrivesReply(text) : parseDrives(text);
    if (drives) patch.drives = drives;
  }
  if (tryAll || asked === "seats" || asked === "drives") {
    const seats = asked === "seats" ? parseSeatsReply(text) : parseSeats(text);
    if (seats !== undefined) patch.seats = seats;
  }
  if (asked === "pickup") patch.pickupQuery = parseNear(text) ?? text.trim();
  else if (tryAll || asked === "drives") {
    const near = parseNear(text);
    if (near) patch.pickupQuery = near;
  }
  if (asked === "budget" || asked === "own_budget") {
    const cents = parseBudgetReply(text);
    if (cents !== undefined) patch.budgetCapCents = cents;
    // 回 yes 只能是接受组织者定的上限
    else if (asked === "budget" && parseYesNo(text) === true && event.budgetCapCents !== undefined) patch.budgetCapCents = event.budgetCapCents;
  }
  const email = parseEmail(text);
  if (email) patch.email = email;
  return patch;
}

function answerContext(deps: FlowDeps, turn: Turn, event: Event, answer: Answer): BrainContext {
  return brainContext(deps, turn, {
    eventLine: [
      event.title,
      event.day ? `${weekdayName(event.day)} ${event.day}` : undefined,
      event.window ? fmtWindow(event.window) : undefined,
      event.area?.label,
      event.budgetCapCents !== undefined ? `organizer's max ${fmtMoney(event.budgetCapCents)}/person (${event.budgetCapCents} cents)` : undefined,
      `organized by ${organizerName(deps.db, event)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    known: ownFields(answer),
    missing: missingAttendeeFields(answer),
  });
}

/**
 * 一轮收集。本人已经确认过、这次又什么都没改（"thanks!"、提问）时返回 undefined，交给调用方回应。
 */
export async function collectTurn(deps: FlowDeps, turn: Turn, c: Collecting, done: Done): Promise<Outbound[] | undefined> {
  const { session, event, member, answer } = c;
  const text = textOf(turn);
  const confirming = session.awaiting === "summary_confirm";
  if (confirming && onlyReactions(turn) && confirmsSummary(turn, session.summaryMessageId)) return confirmAnswer(deps, turn, c, done);
  // 发布后原来的司机不能开了："Still want to come?" 回 no 就是不来了
  if (confirming && session.asked === "still_coming" && isDecline(text)) return decline(deps, turn, c);
  if (session.awaiting === "pickup_choice") {
    const chosen = choosePickup(deps, text, session);
    if (chosen) return saveAndAsk(deps, turn, c, { ...answer, pickupPlaceId: chosen.id, pickupQuery: answer.pickupQuery ?? chosen.name }, undefined);
  }

  const ai = text ? await deps.brain.attendee(answerContext(deps, turn, event, answer)) : undefined;
  const asked = confirming || answer.confirmed ? undefined : session.awaiting === "pickup_choice" ? "pickup" : (session.asked as Asked | undefined);
  const patch = ai?.patch ?? fallbackAnswerPatch(text, event, asked);
  let next = applyAnswerPatch(answer, patch, event);

  if (asked === "remembered" && answer.remembered) {
    const verdict = ai?.intent === "confirm" ? true : parseYesNo(text);
    // 确认了，或者具体改了某一项（其余视为没变）：记忆这次就算确认过了
    if (verdict === true || correctsProfile(patch)) next = { ...next, remembered: false };
    // 只说"不对"：清掉预填的偏好，一项项重新问
    else if (verdict === false) next = dropRemembered(next);
  }
  const changed = answerChanged(answer, next);

  if (confirming && !changed) {
    if (ai?.intent === "confirm" || confirmsSummary(turn, session.summaryMessageId)) return confirmAnswer(deps, turn, c, done);
    return [say(turn.handle, t.whatToChange())];
  }
  if (answer.confirmed && !changed && !patch.email) return undefined;

  deps.db.putMember({
    ...member,
    email: patch.email ?? member.email,
    // 改了已经确认的答案：等本人再确认之前算"收集中"
    status: member.status === "invited" || (changed && member.status === "confirmed") ? "collecting" : member.status,
  });

  if (next.pickupQuery && !next.pickupPlaceId) {
    const resolved = await resolvePickup(deps, turn, c, next);
    if ("reply" in resolved) return resolved.reply;
    next = resolved;
  }
  // 不接受组织者定的上限（回了 no），或者已经在问本人的上限：接着问他自己最多花多少，而不是把原来的问题再问一遍
  const ownBudget = asked === "own_budget" || (asked === "budget" && next.budgetCapCents === undefined && rejectsAmount(text));
  return saveAndAsk(deps, turn, c, changed ? { ...next, confirmed: false } : next, ai, ownBudget);
}

/** 存下答案，问下一个缺的字段；都齐了就发摘要。`ownBudget`：问预算时改问本人最多花多少。 */
function saveAndAsk(deps: FlowDeps, turn: Turn, c: Collecting, next: Answer, ai: Extraction<AnswerPatch> | undefined, ownBudget = false): Outbound[] {
  const { event, answer } = c;
  const session = withoutPickupState(c.session);
  deps.db.putAnswer(next);
  const field = missingAttendeeFields(next)[0];
  const pickup = next.pickupPlaceId ? deps.db.place(next.pickupPlaceId) : undefined;
  if (!field) {
    // 发布后原来开车、现在不开：用专门的说法先问还来不来
    const dropped = event.status === "PUBLISHED" && answer.confirmed && answer.drives !== "no" && next.drives === "no";
    deps.db.putSession({ ...session, awaiting: "summary_confirm", asked: dropped ? "still_coming" : undefined });
    const firstTime = !deps.db.person(turn.handle);
    return [summary(turn.handle, dropped ? t.driverDropped(pickup?.name) : t.attendeeSummary(next, pickup, answer.confirmed, firstTime))];
  }
  const ask: Asked = field === "budget" && ownBudget ? "own_budget" : field;
  deps.db.putSession({ ...session, awaiting: undefined, asked: ask });
  const question = t.attendeeAsk(ask, event, organizerName(deps.db, event), next, pickup);
  // 同一个问题又要问一遍，说明上一句没听懂：换个说法、给个例子，而不是原样重复
  const template = c.session.asked === ask ? t.attendeeRetry(ask, event, question) : question;
  return [say(turn.handle, nextQuestion(ai, field, template))];
}

/** 确认摘要：记下答案和记忆，版本号 +1，再看要不要重新求解。第一次确认时问邮箱。 */
async function confirmAnswer(deps: FlowDeps, turn: Turn, c: Collecting, done: Done): Promise<Outbound[]> {
  const { session, member, answer } = c;
  const confirmed: Answer = { ...answer, remembered: false, confirmed: true, version: answer.version + 1 };
  deps.db.putAnswer(confirmed);
  deps.db.putMember({ ...member, status: "confirmed" });
  const event = bumpInput(deps.db.event(c.event.id) ?? c.event);
  deps.db.putEvent(event);
  // 本人确认过的才记；摘要里已经提前告诉过本人（firstTime 那一行）
  deps.db.putPerson(remember(deps.db.person(turn.handle), member, confirmed, deps.now));

  const planning = await afterConfirm(deps, event);
  const askEmail = answer.version === 0 && !member.email;
  deps.db.putSession({ ...session, awaiting: askEmail ? "email" : undefined, asked: undefined, summaryMessageId: undefined });
  const textId = lastTextId(turn);
  const reply = askEmail ? t.askEmail() : (planning.reply ?? done());
  return [...(textId ? [react(turn.handle, textId, "❤️")] : []), ...(reply ? [say(turn.handle, reply)] : []), ...planning.outbound];
}

/** 不来了：标成谢绝，重新求解（发布后会给组织者一份变更提议）。 */
async function decline(deps: FlowDeps, turn: Turn, c: Collecting): Promise<Outbound[]> {
  deps.db.putMember({ ...c.member, status: "declined" });
  deps.db.putSession({ ...c.session, awaiting: undefined, asked: undefined, summaryMessageId: undefined });
  const event = bumpInput(deps.db.event(c.event.id) ?? c.event);
  deps.db.putEvent(event);
  const planning = await afterConfirm(deps, event);
  return [say(turn.handle, t.declined(organizerName(deps.db, event))), ...planning.outbound];
}

/** 问邮箱那一步：给了邮箱或说跳过就结束；都不是返回 undefined（可能是在改答案）。 */
export function emailTurn(deps: FlowDeps, turn: Turn, c: Collecting, done: Done): Outbound[] | undefined {
  const text = textOf(turn);
  const email = parseEmail(text);
  if (!email && !isSkip(text)) return undefined;
  if (email) {
    deps.db.putMember({ ...c.member, email });
    const person = deps.db.person(turn.handle);
    if (person) deps.db.putPerson({ ...person, email, updatedAt: deps.now.toISOString() });
  }
  deps.db.putSession({ ...c.session, awaiting: undefined });
  const reply = done();
  return reply ? [say(turn.handle, reply)] : [];
}

// 集合点

const MIN_RADIUS_KM = 10;

/** 离活动区域中心太远的结果（别的城市）不要。区域还没定位时全留着。 */
function nearby(places: Place[], area: Area | undefined): Place[] {
  if (area?.lat === undefined || area.lng === undefined) return places;
  const center = { lat: area.lat, lng: area.lng };
  return places.filter((place) => distanceKm(place, center) <= Math.max(area.radiusKm * 2, MIN_RADIUS_KM));
}

/** 只有一个词（"library"）的查询容易有歧义：找到好几个就让本人选。 */
function isGeneric(query: string): boolean {
  return query.replace(/\b(?:the|a|an|near|by|at)\b/gi, " ").trim().split(/\s+/).length <= 1;
}

/** 一直找不到时的候选：别人已经确认的集合点；还没有人确认时，用候选的活动地点。 */
function meetingPoints(deps: FlowDeps, event: Event, handle: string): Place[] {
  const pickups = participantsOf(deps.db, event)
    .filter(({ member, answer }) => member.handle !== handle && answer.pickupPlaceId)
    .map(({ answer }) => answer.pickupPlaceId!);
  if (!pickups.length) return venuesOf(deps.db, event.candidateVenueIds).filter(({ venue }) => venue.kind === "activity").slice(0, 2).map(({ place }) => place);
  return [...new Set(pickups)].slice(0, 3).flatMap((id) => deps.db.place(id) ?? []);
}

/** 地理编码集合点：找到了返回带 pickupPlaceId 的答案；有歧义或找不到时返回要发的问题。 */
async function resolvePickup(deps: FlowDeps, turn: Turn, c: Collecting, next: Answer): Promise<Answer | { reply: Outbound[] }> {
  const query = next.pickupQuery!;
  const hits = nearby(await deps.maps.searchPlaces(regionQuery(query, deps.mapsRegion), c.event.area), c.event.area);
  for (const hit of hits.slice(0, 3)) deps.db.putPlace(hit);

  if (hits.length > 1 && isGeneric(query)) {
    const choices = hits.slice(0, 3);
    deps.db.putAnswer({ ...next, confirmed: false });
    deps.db.putSession({ ...c.session, awaiting: "pickup_choice", asked: "pickup", choices: choices.map((place) => place.id) });
    return { reply: [say(turn.handle, t.pickupChoices(choices.map((place) => place.name), "ambiguous"))] };
  }
  const [place] = hits;
  if (place) return { ...next, pickupPlaceId: place.id };

  const misses = (c.session.misses ?? 0) + 1;
  const fallback = misses >= 2 ? meetingPoints(deps, c.event, c.member.handle) : [];
  deps.db.putAnswer({ ...next, pickupQuery: undefined, confirmed: false });
  if (fallback.length) {
    deps.db.putSession({ ...c.session, awaiting: "pickup_choice", asked: "pickup", choices: fallback.map((p) => p.id), misses });
    return { reply: [say(turn.handle, t.pickupChoices(fallback.map((p) => p.name), "fallback"))] };
  }
  deps.db.putSession({ ...c.session, awaiting: undefined, asked: "pickup", misses });
  return { reply: [say(turn.handle, t.pickupNotFound(query))] };
}

/** 回编号或候选的名字就选中；否则返回 undefined，这条消息当成新的地标来找。 */
function choosePickup(deps: FlowDeps, text: string, session: Session): Place | undefined {
  const places = (session.choices ?? []).flatMap((id) => deps.db.place(id) ?? []);
  const number = parseChoice(text, places.length);
  if (number) return places[number - 1];
  const lower = text.trim().toLowerCase();
  return lower ? places.find((place) => place.name.toLowerCase().includes(lower)) : undefined;
}

/** 集合点找到以后，候选和"没找到几次"都清掉。 */
function withoutPickupState(session: Session): Session {
  const { choices: _choices, misses: _misses, ...rest } = session;
  return rest;
}
