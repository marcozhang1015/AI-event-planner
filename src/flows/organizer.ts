// 组织者私聊（§4.3 流程 1）：发起 → 逐个问缺的信息 → 摘要确认 → 邀请。
// 方案、核实、批准（流程 3）是 M2 的活，入口先占位。

import type { BrainContext } from "../brain/extract";
import { looksLikePlan, normalizePhone, parseDay, parseMoneyCents, parseTimeWindow } from "../brain/parse";
import { bumpInput, transition } from "../core/state";
import { fmtMoney, fmtWindow, todayIn, weekdayName } from "../core/time";
import { prepareCandidates } from "../maps/candidates";
import { link, templates as t } from "../out/imessage";
import type { Event, EventPatch, Extraction, Handle, Session } from "../types";
import { nameFor } from "./contacts";
import { hasProfile, prefill } from "./memory";
import {
  confirmsSummary,
  emptyAnswer,
  historyOf,
  newId,
  newMember,
  onlyReactions,
  say,
  textOf,
  textsOf,
  type Contact,
  type FlowDeps,
  type Outbound,
  type Turn,
} from "./context";

export const ORGANIZER_FIELDS = ["title", "day", "window", "area", "budget"] as const;
export type OrganizerField = (typeof ORGANIZER_FIELDS)[number];

export function missingOrganizerFields(event: Event): OrganizerField[] {
  const missing: OrganizerField[] = [];
  if (!event.title) missing.push("title");
  if (!event.day) missing.push("day");
  if (!event.window) missing.push("window");
  if (!event.area) missing.push("area");
  if (event.budgetCapCents === undefined) missing.push("budget");
  return missing;
}

export function applyEventPatch(event: Event, patch: EventPatch): Event {
  const start = patch.window?.start ?? event.window?.start;
  const end = patch.window?.end ?? event.window?.end;
  return {
    ...event,
    title: patch.title ?? event.title,
    day: patch.day ?? event.day,
    window: start && end ? { start, end } : event.window,
    // 区域换了就重新定位
    area: patch.areaLabel && patch.areaLabel !== event.area?.label ? { label: patch.areaLabel, radiusKm: 15 } : event.area,
    budgetCapCents: patch.budgetCapCents ?? event.budgetCapCents,
    headcount: patch.headcount ?? event.headcount,
  };
}

function hasChanges(patch: EventPatch): boolean {
  return Object.keys(patch).length > 0;
}

/** LLM 不可用时的规则解析。`asked` 是上一个问题问的字段；没有就把能认的都试一遍。 */
export function fallbackEventPatch(text: string, today: string, asked?: OrganizerField): EventPatch {
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
  const today = todayIn(deps.timezone, deps.now);
  return {
    today: `${today} (${weekdayName(today)})`,
    eventLine: eventLine(event, "them"),
    known: { title: event.title || undefined, day: event.day, window: event.window, area: event.area?.label, budgetCapCents: event.budgetCapCents, headcount: event.headcount },
    missing: missingOrganizerFields(event),
    history: historyOf(deps, turn.handle),
    incoming: textsOf(turn),
  };
}

function askNext(deps: FlowDeps, turn: Turn, session: Session, event: Event, ai: Extraction<EventPatch> | undefined): Outbound[] {
  const next = missingOrganizerFields(event)[0];
  if (!next) {
    const confirming: Session = { ...session, awaiting: "summary_confirm", asked: undefined };
    deps.db.putSession(confirming);
    return [
      {
        kind: "send",
        to: turn.handle,
        parts: [t.organizerSummary(event)],
        // 记下摘要消息的 id：对它点 👍 就算确认
        onSent: ([id]) => deps.db.store.saveSession({ ...confirming, summaryMessageId: id }),
      },
    ];
  }
  deps.db.putSession({ ...session, awaiting: undefined, asked: next });
  // Claude 的措辞只有在它问的正是代码算出的下一个字段时才用
  const question = ai?.askingAbout === next && ai.reply ? ai.reply : t.organizerAsk(next, event);
  return [say(turn.handle, question)];
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

const NOT_NAMES = new Set(["i", "im", "i'm", "me", "too", "also", "and", "invite", "add", "plus", "everyone", "all", "us", "we", "the", "crew", "guys"]);

/** 从联系人卡片和名字里找出要邀请的人；通讯录里没有的名字放进 unknown。 */
export function resolveInvitees(turn: Turn, contacts: Contact[], organizer: Handle): { found: Contact[]; unknown: string[] } {
  const found = new Map<Handle, Contact>();
  for (const card of turn.incoming.filter((item) => item.kind === "contact")) {
    const phone = card.phones?.[0];
    if (!phone) continue;
    const handle = normalizePhone(phone);
    found.set(handle, { name: card.contactName?.split(" ")[0] || handle, handle });
  }

  const text = textOf(turn);
  for (const contact of contacts) {
    const pattern = new RegExp(`\\b${contact.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (contact.handle !== organizer && pattern.test(text)) found.set(contact.handle, contact);
  }

  const known = new Set(contacts.map((contact) => contact.name.toLowerCase()));
  const firstSentence = text.split(/[.!?\n]/)[0] ?? "";
  const unknown = firstSentence
    .split(/,|\band\b|&|\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z][a-z'-]{1,20}$/.test(word) && !NOT_NAMES.has(word) && !known.has(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return { found: [...found.values()], unknown: [...new Set(unknown)] };
}

function inviteTurn(deps: FlowDeps, turn: Turn, session: Session, event: Event): Outbound[] {
  const { found, unknown } = resolveInvitees(turn, deps.contacts, event.organizer);
  if (!found.length) return [say(turn.handle, unknown.length ? t.unknownInvitees(unknown) : t.askInvitees())];

  const organizer = deps.db.member(event.id, event.organizer);
  const invites: Outbound[] = [];
  const invited: string[] = [];
  for (const contact of found) {
    if (deps.db.member(event.id, contact.handle)) continue;
    // 以前确认过偏好的人：预填成"待确认"，开场白也说明这次会很快
    const person = deps.db.person(contact.handle);
    const returning = hasProfile(person);
    const blank = emptyAnswer(event.id, contact.handle);
    const pickup = person?.pickupPlaceId ? deps.db.place(person.pickupPlaceId) : undefined;
    deps.db.putMember({ ...newMember(event.id, contact.handle, contact.name, "attendee"), email: person?.email });
    deps.db.putAnswer(returning ? prefill(blank, person, event.area, pickup) : blank);
    deps.db.putSession({ handle: contact.handle, eventId: event.id, role: "attendee", awaiting: "opener" });
    invites.push(say(contact.handle, t.opener(contact.name, organizer?.name ?? "a friend", event, deps.agentName, returning)));
    invited.push(contact.name);
  }
  // TODO(B, M2)：组织者说 "I'm in too and can drive 2" 时，把他也当参与者收集约束
  deps.db.putSession({ ...session, awaiting: undefined });

  const reply = invited.length ? [t.invitesSent(invited), link(`${deps.baseUrl}/o/${organizer?.linkToken}`)] : [t.noted()];
  if (unknown.length) reply.push(t.unknownInvitees(unknown));
  return [say(turn.handle, ...reply), ...invites];
}

function statusLine(deps: FlowDeps, event: Event): string {
  const attendees = deps.db.membersOf(event.id).filter((member) => member.role === "attendee");
  const waiting = attendees.filter((member) => member.status !== "confirmed" && member.status !== "declined").map((member) => member.name);
  return t.collectingStatus(attendees.length - waiting.length, attendees.length, waiting);
}

export async function organizerTurn(deps: FlowDeps, turn: Turn, session: Session): Promise<Outbound[]> {
  const event = session.eventId ? deps.db.event(session.eventId) : undefined;
  if (!event) return startEvent(deps, turn);

  switch (event.status) {
    case "DRAFT":
      return draftTurn(deps, turn, session, event);
    case "COLLECTING": {
      if (session.awaiting === "invitees") return inviteTurn(deps, turn, session, event);
      if (/\bplan it\b|\bgo ahead\b|开始排/i.test(textOf(turn))) {
        // TODO(B + C, M2)：进入 REVIEW，调用 solve()，发方案消息（§4.3 流程 3）
        return [say(turn.handle, t.planningNotReady())];
      }
      if (resolveInvitees(turn, deps.contacts, event.organizer).found.length) return inviteTurn(deps, turn, session, event);
      return [say(turn.handle, statusLine(deps, event))];
    }
    case "REVIEW":
    case "PUBLISHED":
      // TODO(B, M2)：修改、核实 UNKNOWN、approve、发布后变更（§4.3 流程 3–5）
      return [say(turn.handle, t.planningNotReady())];
  }
}
