// 邀请（§4.3 流程 1）：从名单和联系人卡片里认人 → 私聊开场白。
// 组织者说自己也去时，给他建一份答案，在他的私聊里补问约束。

import { isDeferral, parseDrives, parseJoining, parseSeats } from "../brain/parse";
import { nameFor, normalizeHandle, type Contact } from "../core/handle";
import { hasProfile, prefill } from "../core/memory";
import { bumpInput } from "../core/state";
import { link, say, summary, tell, type Outbound, type OutPart } from "../out/actions";
import { templates as t } from "../out/imessage";
import { memberUrl } from "../out/privacy";
import { localTimeIn } from "../shared/time";
import type { Answer, AnswerPatch, Event, Handle, Session } from "../shared/types";
import { participantsOf } from "../store/changes";
import { applyAnswerPatch, missingAttendeeFields } from "./collect";
import { emptyAnswer, newMember, quietNow, textOf, type FlowDeps, type Turn } from "./context";

/** 名单里这些词不是人名。 */
const STOPWORDS = new Set(
  (
    "i im i'm me my you we us our they them and or the a an to for of in on at with too also just now then maybe please pls " +
    "thanks thank thx ok okay yes yeah sure hi hey invite add plus everyone all crew guys folks people friends team gang family " +
    "is are be it that this can could will would drive driving coming come join joining " +
    "idk dunno later soon yet sec second moment minute wait hold hmm tbd lemme"
  ).split(" "),
);

const LEADING = /^(?:(?:can you|could you|please|pls|and|also|oh)\s+)*(?:invite|add|text|include|bring|loop in)\s+/i;
const TRAILING = /(?:[,\s]+(?:please|pls|thanks|thank you|thx|too|as well|for now))+$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text);
}

/** 名单的每一项：只看第一句，去掉开头的 "invite"、结尾的 "please"，按逗号、and、& 切开。 */
function listItems(text: string): string[] {
  const first = (text.split(/[.!?\n]/)[0] ?? "").trim().replace(LEADING, "").replace(TRAILING, "");
  return first
    .split(/,|;|&|\band\b|\bplus\b/i)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** 1–2 个词、都不是停用词的一项才可能是人名。 */
function candidateName(item: string): string | undefined {
  const words = item.split(/\s+/);
  if (words.length > 2 || words.some((word) => !/^[a-z][a-z'-]{1,20}$/.test(word) || STOPWORDS.has(word))) return undefined;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** 从联系人卡片和名字里找出要邀请的人；名单里通讯录没有的名字放进 unknown。 */
function resolveInvitees(turn: Turn, contacts: Contact[], organizer: Handle): { found: Contact[]; unknown: string[] } {
  const found = new Map<Handle, Contact>();
  for (const card of turn.incoming.filter((item) => item.kind === "contact")) {
    const phone = card.phones?.[0];
    if (!phone) continue;
    const handle = normalizeHandle(phone);
    if (handle !== organizer) found.set(handle, { name: nameFor(contacts, handle) ?? (card.contactName?.split(" ")[0] || handle), handle });
  }
  const text = textOf(turn);
  for (const contact of contacts) {
    if (contact.handle !== organizer && mentions(text, contact.name)) found.set(contact.handle, contact);
  }
  const unknown = listItems(text)
    .filter((item) => !contacts.some((contact) => mentions(item, contact.name)))
    .flatMap((item) => candidateName(item) ?? []);
  return { found: [...found.values()], unknown: [...new Set(unknown)] };
}

/**
 * 发开场白。还没回复过的人（状态 invited，可能上次没发出去）再被邀请时重发；已经回复过的不再打扰。
 * `firstList`：组织者第一次给名单，顺便看他自己去不去。
 */
export function inviteTurn(deps: FlowDeps, turn: Turn, session: Session, event: Event, firstList: boolean): Outbound[] {
  const organizer = event.organizer;
  const { found, unknown } = resolveInvitees(turn, deps.contacts, organizer);
  if (!found.length) return [say(organizer, unknown.length ? t.unknownInvitees(unknown) : isDeferral(textOf(turn)) ? t.inviteesLater() : t.askInvitees())];

  const host = deps.db.member(event.id, organizer);
  const invites: Outbound[] = [];
  const invited: string[] = [];
  const already: string[] = [];
  let added = false;
  for (const contact of found) {
    const existing = deps.db.member(event.id, contact.handle);
    if (existing && existing.status !== "invited") {
      already.push(existing.name);
      continue;
    }
    // 以前确认过偏好的人：预填成"待确认"，开场白也说明这次会很快
    const person = deps.db.person(contact.handle);
    const returning = hasProfile(person);
    if (!existing) {
      const blank = emptyAnswer(event.id, contact.handle);
      const pickup = person?.pickupPlaceId ? deps.db.place(person.pickupPlaceId) : undefined;
      deps.db.putMember({ ...newMember(event.id, contact.handle, contact.name, "attendee"), email: person?.email });
      deps.db.putAnswer(returning ? prefill(blank, person, event.area, pickup) : blank);
      deps.db.putSession({ handle: contact.handle, eventId: event.id, role: "attendee", awaiting: "opener" });
      added = true;
    }
    const opener = t.opener(contact.name, host?.name ?? "a friend", event, deps.agentName, returning);
    invites.push(tell(contact.handle, contact.name, organizer, [opener], { retry: `invite ${contact.name}` }));
    invited.push(contact.name);
  }
  // 参与的人变了，之前的方案作废
  const current = added ? bumpInput(event) : event;
  if (added) deps.db.putEvent(current);

  const quiet = quietNow(deps);
  const reply: OutPart[] = [];
  if (invited.length) {
    reply.push(quiet ? t.invitesDeferred(invited, localTimeIn(deps.timezone, quiet)) : t.invitesSent(invited));
    if (host) reply.push(link(memberUrl(deps.baseUrl, host)));
  }
  if (already.length) reply.push(t.alreadyInvited(already));
  if (unknown.length) reply.push(t.unknownInvitees(unknown));

  deps.db.putSession({ ...session, awaiting: undefined });
  const own = firstList && !deps.db.answer(event.id, organizer) ? organizerJoining(deps, { ...session, awaiting: undefined }, current, textOf(turn)) : [];
  return [say(organizer, ...reply), ...own, ...invites];
}

/** 组织者自己去不去：说了就照办；人数刚好是受邀的人 + 1（"5 of us"）也算去；都没有就问一句。 */
function organizerJoining(deps: FlowDeps, session: Session, event: Event, text: string): Outbound[] {
  const invitees = participantsOf(deps.db, event).length;
  const joining = parseJoining(text) ?? (event.headcount !== undefined && event.headcount === invitees + 1 ? true : undefined);
  if (joining === false) return [];
  if (joining === undefined) {
    deps.db.putSession({ ...session, awaiting: "joining" });
    return [say(event.organizer, t.askJoining())];
  }
  return joinOrganizer(deps, session, event, text);
}

/** 回答 "Are you coming too?"。 */
export function joiningReply(deps: FlowDeps, turn: Turn, session: Session, event: Event, joining: boolean): Outbound[] {
  if (!joining) {
    deps.db.putSession({ ...session, awaiting: undefined });
    return [say(event.organizer, t.notJoining())];
  }
  return joinOrganizer(deps, { ...session, awaiting: undefined }, event, textOf(turn));
}

/**
 * 组织者也去：给他建一份答案。他定了时间窗和上限，就默认整段都有空、预算就是上限；
 * 有记忆的预填记忆；这句话里说了开车和座位的直接用上。然后问第一个缺的字段。
 */
function joinOrganizer(deps: FlowDeps, session: Session, event: Event, text: string): Outbound[] {
  const organizer = event.organizer;
  const person = deps.db.person(organizer);
  const pickup = person?.pickupPlaceId ? deps.db.place(person.pickupPlaceId) : undefined;
  const base: Answer = { ...emptyAnswer(event.id, organizer), free: event.window ? [event.window] : undefined, budgetCapCents: event.budgetCapCents };
  const patch: AnswerPatch = {};
  const drives = parseDrives(text);
  const seats = parseSeats(text);
  if (drives) patch.drives = drives;
  if (seats !== undefined && drives !== "no") patch.seats = seats;
  const answer = applyAnswerPatch(hasProfile(person) ? prefill(base, person, event.area, pickup) : base, patch, event);
  deps.db.putAnswer(answer);

  const host = deps.db.member(event.id, organizer);
  if (host) deps.db.putMember({ ...host, status: "collecting" });
  deps.db.putEvent(bumpInput(event));

  const field = missingAttendeeFields(answer)[0];
  const known = answer.pickupPlaceId ? deps.db.place(answer.pickupPlaceId) : undefined;
  if (!field) {
    deps.db.putSession({ ...session, awaiting: "summary_confirm", asked: undefined });
    return [summary(organizer, t.attendeeSummary(answer, known, false, !person))];
  }
  deps.db.putSession({ ...session, asked: field });
  return [say(organizer, t.whileTheyReply(t.attendeeAsk(field, event, host?.name ?? "You", answer, known)))];
}
