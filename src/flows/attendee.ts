// 参与者私聊（§4.3 流程 2、4、5）：开场白 → 收集约束（collect.ts）→ 可选邮箱；
// 之后：确认过的人提问就回答，请他帮忙开车时收他的答复。

import { isDeferral, isQuestion } from "../brain/parse";
import { react, say, type Outbound } from "../out/actions";
import { dayName, templates as t } from "../out/imessage";
import { itineraryView, memberUrl } from "../out/privacy";
import type { Event, Member, Session } from "../shared/types";
import { organizerName, publishedOption } from "../store/changes";
import { collectTurn, emailTurn, type Collecting } from "./collect";
import { emptyAnswer, lastTextId, textOf, type FlowDeps, type Turn } from "./context";
import { consentTurn } from "./planning";

export async function attendeeTurn(deps: FlowDeps, turn: Turn, session: Session): Promise<Outbound[]> {
  const event = session.eventId ? deps.db.event(session.eventId) : undefined;
  const member = event ? deps.db.member(event.id, turn.handle) : undefined;
  if (!event || !member) return [say(turn.handle, t.intro(deps.agentName))];

  if (session.awaiting === "opener" && isDeferral(textOf(turn))) return [say(turn.handle, t.openerLater())];
  if (session.awaiting === "drive_consent") return consentTurn(deps, turn, session, event);

  const collecting: Collecting = { session, event, member, answer: deps.db.answer(event.id, turn.handle) ?? emptyAnswer(event.id, turn.handle) };
  const done = () => t.attendeeDone();
  const answered = (session.awaiting === "email" ? emailTurn(deps, turn, collecting, done) : undefined) ?? (await collectTurn(deps, turn, collecting, done));
  return answered ?? settledReply(deps, turn, event, member);
}

/** 已经确认过、这次什么都没改：提问就回答（发布后把他的安排再发一遍），"thanks" 就点个 tapback。 */
function settledReply(deps: FlowDeps, turn: Turn, event: Event, member: Member): Outbound[] {
  if (!isQuestion(textOf(turn))) {
    const textId = lastTextId(turn);
    return textId ? [react(turn.handle, textId, "❤️")] : [];
  }
  const live = publishedOption(deps.db, event.published);
  if (!live) return [say(turn.handle, t.notPlannedYet(organizerName(deps.db, event)))];
  const day = dayName(event);
  const itinerary = itineraryView(deps.db, event, live, member, deps);
  if (itinerary) return [say(turn.handle, ...t.personalPlan(itinerary, day, "resend", memberUrl(deps.baseUrl, member)))];
  const exclusion = live.excluded.find((candidate) => candidate.handle === member.handle);
  return [say(turn.handle, exclusion ? t.excludedNotice(exclusion.reason, organizerName(deps.db, event), day) : t.notPlannedYet(organizerName(deps.db, event)))];
}
