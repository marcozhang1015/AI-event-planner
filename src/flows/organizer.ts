// 组织者私聊（§4.3 流程 1、3、5）：
// - 发起：自然语言 → 逐个问缺的信息 → 摘要确认 → 邀请；
// - 之后先认命令（approve、核实、plan it、邀请、改设置），其余的话当成组织者补答自己的约束（他也去的话）。

import type { BrainContext } from "../brain/extract";
import {
  hasChangeCue,
  isInviteRequest,
  isPlanRequest,
  looksLikePlan,
  parseApproval,
  parseDay,
  parseJoining,
  parseMoneyCents,
  parseTimeWindow,
  parseVerification,
  parseYesNo,
} from "../brain/parse";
import { AREA_RADIUS_KM } from "../core/geo";
import { nameFor } from "../core/handle";
import { bumpInput, transition } from "../core/state";
import { findCandidates } from "../maps";
import { say, summary, type Outbound } from "../out/actions";
import { templates as t } from "../out/imessage";
import { planView } from "../out/privacy";
import { fmtMoney, fmtWindow, todayIn, weekdayName } from "../shared/time";
import type { Event, EventPatch, Extraction, Session } from "../shared/types";
import { participantsOf } from "../store/changes";
import { newId } from "../store/db";
import { collectTurn, emailTurn, type Collecting, type Done } from "./collect";
import { brainContext, confirmsSummary, newMember, nextQuestion, onlyReactions, textOf, type FlowDeps, type Turn } from "./context";
import { inviteTurn, joiningReply } from "./invite";
import { approve, consentTurn, replan, startReview, verify } from "./planning";

const ORGANIZER_FIELDS = ["title", "day", "window", "area", "budget"] as const;
type OrganizerField = (typeof ORGANIZER_FIELDS)[number];

function missingOrganizerFields(event: Event): OrganizerField[] {
  const missing: OrganizerField[] = [];
  if (!event.title) missing.push("title");
  if (!event.day) missing.push("day");
  if (!event.window) missing.push("window");
  if (!event.area) missing.push("area");
  if (event.budgetCapCents === undefined) missing.push("budget");
  return missing;
}

function applyEventPatch(event: Event, patch: EventPatch): Event {
  const start = patch.window?.start ?? event.window?.start;
  const end = patch.window?.end ?? event.window?.end;
  return {
    ...event,
    title: patch.title ?? event.title,
    day: patch.day ?? event.day,
    window: start && end ? { start, end } : event.window,
    // 区域换了就重新定位
    area: patch.areaLabel && patch.areaLabel !== event.area?.label ? { label: patch.areaLabel, radiusKm: AREA_RADIUS_KM } : event.area,
    budgetCapCents: patch.budgetCapCents ?? event.budgetCapCents,
    headcount: patch.headcount ?? event.headcount,
  };
}

function hasChanges(patch: EventPatch): boolean {
  return Object.keys(patch).length > 0;
}

/** LLM 不可用时的规则解析。`asked` 是上一个问题问的字段；没有就把能认的都试一遍。 */
function fallbackEventPatch(text: string, today: string, asked?: OrganizerField): EventPatch {
  const patch: EventPatch = {};
  const tryAll = asked === undefined;
  if (tryAll || asked === "day") {
    const day = parseDay(text, today);
    if (day) patch.day = day;
  }
  if (tryAll || asked === "window") {
    const window = parseTimeWindow(text);
    if (window?.start || window?.end) patch.window = window;
  }
  if (tryAll || asked === "budget") {
    const cents = parseMoneyCents(text);
    if (cents !== undefined) patch.budgetCapCents = cents;
  }
  if (asked === "title") patch.title = text.trim();
  if (asked === "area") patch.areaLabel = text.trim();
  if (tryAll) {
    const title = text.match(
      /\bplan (?:a |an |some )?(.+?)(?= this\b| next\b| on\b| for\b| near\b| around\b| with\b| (?:mon|tues|wednes|thurs|fri|satur|sun)day\b| today\b| tonight\b| tomorrow\b|[?,.!]|$)/i,
    )?.[1];
    if (title) patch.title = title.trim();
    const area = text.match(/\b(?:near|around)\s+[\w' -]{2,40}?(?=[?,.!;]| for\b| on\b| this\b| next\b| with\b|$)/i)?.[0];
    if (area) patch.areaLabel = area.trim();
    const headcount = text.match(/(\d+)\s*(?:of us|people|ppl|friends|人)/i)?.[1];
    if (headcount) patch.headcount = Number(headcount);
  }
  return patch;
}

function eventLine(event: Event, organizerName: string): string {
  return [
    event.title || "(no title yet)",
    event.day ? `${weekdayName(event.day)} ${event.day}` : undefined,
    event.window ? fmtWindow(event.window) : undefined,
    event.area?.label,
    event.budgetCapCents !== undefined ? `max ${fmtMoney(event.budgetCapCents)}/person` : undefined,
    `organized by ${organizerName}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function organizerContext(deps: FlowDeps, turn: Turn, event: Event): BrainContext {
  return brainContext(deps, turn, {
    eventLine: eventLine(event, "them"),
    known: { title: event.title || undefined, day: event.day, window: event.window, area: event.area?.label, budgetCapCents: event.budgetCapCents, headcount: event.headcount },
    missing: missingOrganizerFields(event),
  });
}

/** 组织者确认活动、改了区域时：按区域搜候选活动和餐厅（demo 读缓存），存下场地，记在活动上。 */
async function prepareCandidates(deps: FlowDeps, event: Event): Promise<Event> {
  if (!event.area) return event;
  const { area, candidates } = await findCandidates(deps.maps, event.area, event.title, deps.mapsRegion);
  for (const { place, venue } of candidates) {
    deps.db.putPlace(place);
    deps.db.putVenue(venue);
  }
  return { ...event, area, candidateVenueIds: candidates.map(({ venue }) => venue.id) };
}

// 发起（DRAFT）

function askNext(deps: FlowDeps, turn: Turn, session: Session, event: Event, ai: Extraction<EventPatch> | undefined): Outbound[] {
  const next = missingOrganizerFields(event)[0];
  if (!next) {
    deps.db.putSession({ ...session, awaiting: "summary_confirm", asked: undefined });
    return [summary(turn.handle, t.organizerSummary(event))];
  }
  deps.db.putSession({ ...session, awaiting: undefined, asked: next });
  return [say(turn.handle, nextQuestion(ai, next, t.organizerAsk(next, event)))];
}

async function startEvent(deps: FlowDeps, turn: Turn): Promise<Outbound[]> {
  const text = textOf(turn);
  if (!text) return [say(turn.handle, t.intro(deps.agentName))];

  const blank: Event = {
    id: newId("evt"),
    organizer: turn.handle,
    title: "",
    status: "DRAFT",
    timezone: deps.timezone,
    candidateVenueIds: [],
    inputVersion: 0,
    createdAt: deps.now.toISOString(),
  };
  const ai = await deps.brain.organizer(organizerContext(deps, turn, blank));
  const patch = ai?.patch ?? fallbackEventPatch(text, todayIn(deps.timezone, deps.now));
  if (!patch.title && !looksLikePlan(text)) return [say(turn.handle, t.intro(deps.agentName))];

  const event = applyEventPatch({ ...blank, title: patch.title ?? text.slice(0, 60) }, patch);
  deps.db.putEvent(event);
  deps.db.putMember(newMember(event.id, turn.handle, nameFor(deps.contacts, turn.handle) ?? "a friend", "organizer"));
  return askNext(deps, turn, { handle: turn.handle, eventId: event.id, role: "organizer" }, event, ai);
}

async function draftTurn(deps: FlowDeps, turn: Turn, session: Session, event: Event): Promise<Outbound[]> {
  const confirming = session.awaiting === "summary_confirm";
  if (confirming && onlyReactions(turn) && confirmsSummary(turn, session.summaryMessageId)) return confirmEvent(deps, turn, session, event);

  const text = textOf(turn);
  const ai = text ? await deps.brain.organizer(organizerContext(deps, turn, event)) : undefined;
  const asked = confirming ? undefined : (session.asked as OrganizerField | undefined);
  const patch = ai?.patch ?? fallbackEventPatch(text, todayIn(deps.timezone, deps.now), asked);

  if (confirming && !hasChanges(patch)) {
    if (ai?.intent === "confirm" || confirmsSummary(turn, session.summaryMessageId)) return confirmEvent(deps, turn, session, event);
    return [say(turn.handle, t.whatToChange())];
  }

  const updated = applyEventPatch(event, patch);
  deps.db.putEvent(updated);
  return askNext(deps, turn, session, updated, ai);
}

async function confirmEvent(deps: FlowDeps, turn: Turn, session: Session, event: Event): Promise<Outbound[]> {
  const collecting = await prepareCandidates(deps, bumpInput(transition(event, "COLLECTING")));
  deps.db.putEvent(collecting);
  deps.db.putSession({ ...session, awaiting: "invitees", asked: undefined, summaryMessageId: undefined });
  return [say(turn.handle, t.askInvitees())];
}

// 发起之后（COLLECTING / REVIEW / PUBLISHED）

/** 组织者参加的话，他自己那份答案正在收集的状态。 */
function ownCollecting(deps: FlowDeps, session: Session, event: Event): Collecting | undefined {
  const member = deps.db.member(event.id, event.organizer);
  const answer = deps.db.answer(event.id, event.organizer);
  return member && answer ? { session, event, member, answer } : undefined;
}

function statusLine(deps: FlowDeps, event: Event): string {
  const people = participantsOf(deps.db, event);
  const waiting = people.filter(({ answer }) => !answer.confirmed).map(({ member }) => (member.handle === event.organizer ? "you" : member.name));
  return t.collectingStatus(people.length - waiting.length, people.length, waiting);
}

/** 没有命令、也不是补答自己约束时的回复：收集阶段报进度，出方案后提示怎么批准。 */
function help(deps: FlowDeps, event: Event): string {
  if (event.status === "COLLECTING") return statusLine(deps, event);
  const plan = deps.db.latestPlan(event.id);
  return t.reviewHelp(plan ? planView(deps.db, event, plan, event.organizer) : undefined);
}

/** 组织者要改活动设置吗：要有明确的说法，而且确实抽出了改动。 */
async function eventChange(deps: FlowDeps, turn: Turn, event: Event): Promise<EventPatch | undefined> {
  const text = textOf(turn);
  if (!hasChangeCue(text)) return undefined;
  const ai = await deps.brain.organizer(organizerContext(deps, turn, event));
  const patch = ai?.patch ?? fallbackEventPatch(text, todayIn(deps.timezone, deps.now));
  return hasChanges(patch) ? patch : undefined;
}

/** 改活动设置：区域变了就重新搜候选；版本号 +1。出过方案就重新求解，把新方案发给组织者。 */
async function changeEvent(deps: FlowDeps, event: Event, patch: EventPatch): Promise<Outbound[]> {
  let updated = applyEventPatch(event, patch);
  if (updated.area?.label !== event.area?.label) updated = await prepareCandidates(deps, updated);
  updated = bumpInput(updated);
  deps.db.putEvent(updated);
  // 组织者参加、空闲时间就是原来的时间窗：跟着新时间窗走
  const own = deps.db.answer(event.id, event.organizer);
  if (own && event.window && updated.window && JSON.stringify(own.free) === JSON.stringify([event.window])) {
    deps.db.putAnswer({ ...own, free: [updated.window] });
  }
  if (updated.status === "COLLECTING") return [say(event.organizer, t.eventUpdated(eventLine(updated, "you")))];
  return replan(deps, updated, t.noted());
}

async function manageTurn(deps: FlowDeps, turn: Turn, session: Session, event: Event): Promise<Outbound[]> {
  const text = textOf(turn);
  const organizer = event.organizer;
  if (session.awaiting === "invitees") return inviteTurn(deps, turn, session, event, true);
  if (session.awaiting === "drive_consent") return consentTurn(deps, turn, session, event);
  if (session.awaiting === "joining") {
    const joining = parseJoining(text) ?? parseYesNo(text);
    if (joining !== undefined) return joiningReply(deps, turn, session, event, joining);
  }

  const approval = parseApproval(text);
  if (approval) return event.status === "COLLECTING" ? [say(organizer, t.noPlanYet())] : approve(deps, turn, event, approval.label);
  const verified = event.status === "COLLECTING" ? undefined : parseVerification(text);
  if (verified !== undefined) return verify(deps, event, verified, text);
  if (isPlanRequest(text) && event.status !== "PUBLISHED") return startReview(deps, event, { requested: true });
  if (isInviteRequest(text) || turn.incoming.some((item) => item.kind === "contact")) return inviteTurn(deps, turn, session, event, false);

  const patch = await eventChange(deps, turn, event);
  if (patch) return changeEvent(deps, event, patch);

  const own = ownCollecting(deps, session, event);
  if (own) {
    // 他是最后一个确认的人时，方案马上就发给他了，不用再报进度
    const done: Done = () => {
      const current = deps.db.event(event.id) ?? event;
      return current.status === "COLLECTING" ? statusLine(deps, current) : undefined;
    };
    const answered = (session.awaiting === "email" ? emailTurn(deps, turn, own, done) : undefined) ?? (await collectTurn(deps, turn, own, done));
    if (answered) return answered;
  }
  return [say(organizer, help(deps, event))];
}

export async function organizerTurn(deps: FlowDeps, turn: Turn, session: Session): Promise<Outbound[]> {
  const event = session.eventId ? deps.db.event(session.eventId) : undefined;
  if (!event) return startEvent(deps, turn);
  return event.status === "DRAFT" ? draftTurn(deps, turn, session, event) : manageTurn(deps, turn, session, event);
}
