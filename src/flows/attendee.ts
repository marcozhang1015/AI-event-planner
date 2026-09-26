// 参与者私聊（§4.3 流程 2）：开场白 → 时间、过敏/忌口、开车/接送、预算 → 摘要确认 → 可选邮箱。
// 确认之后随时可以改：改了就重新发摘要，等本人再确认。

import type { BrainContext } from "../brain/extract";
import {
  isSkip,
  parseDrives,
  parseEmail,
  parseHomeBy,
  parseList,
  parseMoneyCents,
  parseSeats,
  parseTimeWindow,
  parseYesNo,
} from "../brain/parse";
import { ownFields } from "../core/privacy";
import { bumpInput } from "../core/state";
import { fmtMoney, fmtWindow, todayIn, weekdayName } from "../core/time";
import { templates as t } from "../out/imessage";
import type { Answer, AnswerPatch, Event, Extraction, Member, Session } from "../types";
import {
  confirmsSummary,
  emptyAnswer,
  historyOf,
  lastTextId,
  onlyReactions,
  react,
  say,
  textOf,
  textsOf,
  withRegion,
  type FlowDeps,
  type Outbound,
  type Turn,
} from "./context";
import { correctsProfile, dropRemembered, remember } from "./memory";

export const ATTENDEE_FIELDS = ["free", "remembered", "allergies", "drives", "seats", "pickup", "budget"] as const;
export type AttendeeField = (typeof ATTENDEE_FIELDS)[number];

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
export function fallbackAnswerPatch(text: string, event: Event, asked?: AttendeeField): AnswerPatch {
  const patch: AnswerPatch = {};
  // 确认记忆时，回复里也可能顺带改了开车、座位或集合点
  const tryAll = asked === undefined || asked === "remembered";
  if (tryAll || asked === "free") {
    const free = parseTimeWindow(text, event.window);
    if (free) patch.free = free;
  }
  const homeBy = parseHomeBy(text, event.window);
  if (homeBy) patch.homeBy = homeBy;
  if (asked === "allergies") {
    const allergies = parseList(text);
    if (allergies) patch.allergies = allergies;
  }
  if (tryAll || asked === "drives") {
    const drives = parseDrives(text);
    if (drives) patch.drives = drives;
  }
  if (tryAll || asked === "seats") {
    const seats = parseSeats(text);
    if (seats !== undefined) patch.seats = seats;
  }
  if (asked === "pickup") patch.pickupQuery = parseNear(text) ?? text.trim();
  else if (tryAll || asked === "drives") {
    const near = parseNear(text);
    if (near) patch.pickupQuery = near;
  }
  if (asked === "budget") {
    const cents = parseMoneyCents(text);
    if (cents !== undefined) patch.budgetCapCents = cents;
    else if (parseYesNo(text) === true && event.budgetCapCents !== undefined) patch.budgetCapCents = event.budgetCapCents;
  }
  const email = parseEmail(text);
  if (email) patch.email = email;
  return patch;
}

function attendeeContext(deps: FlowDeps, turn: Turn, event: Event, answer: Answer, organizerName: string): BrainContext {
  const today = todayIn(deps.timezone, deps.now);
  return {
    today: `${today} (${weekdayName(today)})`,
    eventLine: [
      event.title,
      event.day ? `${weekdayName(event.day)} ${event.day}` : undefined,
      event.window ? fmtWindow(event.window) : undefined,
      event.area?.label,
      event.budgetCapCents !== undefined ? `organizer's max ${fmtMoney(event.budgetCapCents)}/person (${event.budgetCapCents} cents)` : undefined,
      `organized by ${organizerName}`,
    ]
      .filter(Boolean)
      .join(" · "),
    known: ownFields(answer),
    missing: missingAttendeeFields(answer),
    history: historyOf(deps, turn.handle),
    incoming: textsOf(turn),
  };
}

function askNext(
  deps: FlowDeps,
  turn: Turn,
  session: Session,
  event: Event,
  answer: Answer,
  ai: Extraction<AnswerPatch> | undefined,
  updated: boolean,
): Outbound[] {
  const next = missingAttendeeFields(answer)[0];
  const pickup = answer.pickupPlaceId ? deps.db.place(answer.pickupPlaceId) : undefined;
  if (!next) {
    const confirming: Session = { ...session, awaiting: "summary_confirm", asked: undefined };
    deps.db.putSession(confirming);
    const firstTime = !deps.db.person(turn.handle);
    return [
      {
        kind: "send",
        to: turn.handle,
        parts: [t.attendeeSummary(answer, pickup, updated, firstTime)],
        onSent: ([id]) => deps.db.store.saveSession({ ...confirming, summaryMessageId: id }),
      },
    ];
  }
  deps.db.putSession({ ...session, awaiting: undefined, asked: next });
  const organizerName = deps.db.member(event.id, event.organizer)?.name ?? "The organizer";
  const question = ai?.askingAbout === next && ai.reply ? ai.reply : t.attendeeAsk(next, event, organizerName, answer, pickup);
  return [say(turn.handle, question)];
}

function confirmAnswer(deps: FlowDeps, turn: Turn, session: Session, event: Event, member: Member, answer: Answer): Outbound[] {
  const confirmed: Answer = { ...answer, remembered: false, confirmed: true, version: answer.version + 1 };
  deps.db.putAnswer(confirmed);
  deps.db.putMember({ ...member, status: "confirmed" });
  deps.db.putEvent(bumpInput(deps.db.event(event.id) ?? event));
  // 本人确认过的才记；摘要里已经提前告诉过本人（firstTime 那一行）
  deps.db.putPerson(remember(deps.db.person(turn.handle), member, confirmed, deps.now));

  const textId = lastTextId(turn);
  const ack = textId ? [react(turn.handle, textId, "❤️")] : [];
  if (member.email) {
    deps.db.putSession({ ...session, awaiting: undefined, summaryMessageId: undefined });
    return [...ack, say(turn.handle, t.attendeeDone())];
  }
  deps.db.putSession({ ...session, awaiting: "email", summaryMessageId: undefined });
  return [...ack, say(turn.handle, t.askEmail())];
}

export async function attendeeTurn(deps: FlowDeps, turn: Turn, session: Session): Promise<Outbound[]> {
  const event = session.eventId ? deps.db.event(session.eventId) : undefined;
  const member = event ? deps.db.member(event.id, turn.handle) : undefined;
  if (!event || !member) return [say(turn.handle, t.intro(deps.agentName))];

  const text = textOf(turn);
  const answer = deps.db.answer(event.id, turn.handle) ?? emptyAnswer(event.id, turn.handle);

  if (session.awaiting === "opener" && parseYesNo(text) === false) return [say(turn.handle, t.openerLater())];

  if (session.awaiting === "email") {
    const email = parseEmail(text);
    if (email || isSkip(text)) {
      if (email) {
        deps.db.putMember({ ...member, email });
        const person = deps.db.person(turn.handle);
        if (person) deps.db.putPerson({ ...person, email, updatedAt: deps.now.toISOString() });
      }
      deps.db.putSession({ ...session, awaiting: undefined });
      return [say(turn.handle, t.attendeeDone())];
    }
    // 既不是邮箱也不是跳过：可能是在改答案，往下按普通消息处理
  }

  const confirming = session.awaiting === "summary_confirm";
  if (confirming && onlyReactions(turn) && confirmsSummary(turn, session.summaryMessageId)) {
    return confirmAnswer(deps, turn, session, event, member, answer);
  }

  const organizerName = deps.db.member(event.id, event.organizer)?.name ?? "The organizer";
  const ai = text ? await deps.brain.attendee(attendeeContext(deps, turn, event, answer, organizerName)) : undefined;
  const asked = confirming || answer.confirmed ? undefined : (session.asked as AttendeeField | undefined);
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
    if (ai?.intent === "confirm" || confirmsSummary(turn, session.summaryMessageId)) return confirmAnswer(deps, turn, session, event, member, answer);
    return [say(turn.handle, t.whatToChange())];
  }

  // 已经确认过、这次又没改什么（"thanks!"）：点个 tapback 就好，不再发一条
  const textId = lastTextId(turn);
  if (answer.confirmed && !changed && !patch.email) return textId ? [react(turn.handle, textId, "❤️")] : [];

  deps.db.putMember({ ...member, email: patch.email ?? member.email, status: member.status === "invited" ? "collecting" : member.status });

  if (next.pickupQuery && !next.pickupPlaceId) {
    const [place] = await deps.maps.searchPlaces(withRegion(deps, next.pickupQuery), event.area);
    if (!place) {
      // TODO(B, M3)：候选不确定时给本人 2–3 个选项（§5.12）
      deps.db.putAnswer({ ...next, pickupQuery: undefined, confirmed: false });
      deps.db.putSession({ ...session, awaiting: undefined, asked: "pickup" });
      return [say(turn.handle, t.pickupNotFound(next.pickupQuery))];
    }
    deps.db.putPlace(place);
    next = { ...next, pickupPlaceId: place.id };
  }

  // 改过的答案要本人重新确认
  if (changed) next = { ...next, confirmed: false };
  deps.db.putAnswer(next);
  return askNext(deps, turn, session, event, next, ai, answer.confirmed && changed);
}
