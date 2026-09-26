// 求解、方案消息、核实、批准、发布，以及发布后的变更（§4.3 流程 3–5、§5.9）。
// - 任何输入变化都 bumpInput；方案绑定版本号，过期的方案不能被批准。
// - 最好的方案用到还没答应的 if_needed 司机时，先私聊问他，再交给组织者。
// - 只有组织者的 approve 才发最终安排（iMessage 和邮件都一样）；发布后只给受影响的人发更新。

import { solve } from "../core/solver";
import { affectedHandles, bumpInput, checkApproval, rideOf, transition } from "../core/state";
import type { Maps } from "../maps";
import { link, say, tell, type DeliveryTag, type EmailAction, type Outbound, type OutPart } from "../out/actions";
import { planEmail } from "../out/email";
import { memberCalendar } from "../out/ics";
import { dayName, templates as t } from "../out/imessage";
import { itineraryView, mapImagePath, memberUrl, planView } from "../out/privacy";
import { localTimeIn, todayIn } from "../shared/time";
import type { Event, Fact, Handle, Member, Place, Plan, PlanOption, Session, TravelTime, Venue, Verification } from "../shared/types";
import type { ItineraryView } from "../shared/views";
import { organizerName, participantsOf, publishedOption, venuesOf } from "../store/changes";
import { newId } from "../store/db";
import { confirmsSummary, quietNow, type FlowDeps, type Turn } from "./context";

function nameOf(deps: FlowDeps, event: Event, handle: Handle): string {
  return deps.db.member(event.id, handle)?.name ?? "someone";
}

/** 所有参与的人都确认了（至少有一个受邀的人）。 */
function allConfirmed(deps: FlowDeps, event: Event): boolean {
  const people = participantsOf(deps.db, event);
  return people.some(({ member }) => member.role === "attendee") && people.every(({ answer }) => answer.confirmed);
}

/** 按当前输入求解并存下方案（绑定 inputVersion）。还没确认的人记为 no_answer。 */
export async function solveEvent(deps: FlowDeps, event: Event): Promise<Plan> {
  const people = participantsOf(deps.db, event);
  const ready = people.filter(({ answer }) => answer.confirmed && answer.pickupPlaceId);
  const candidates = venuesOf(deps.db, event.candidateVenueIds);
  const pickups = ready.flatMap(({ answer }) => deps.db.place(answer.pickupPlaceId!) ?? []);
  const travel = await travelLookup(deps.maps, [...new Map([...pickups, ...candidates.map((c) => c.place)].map((p) => [p.id, p])).values()]);
  const result = event.window
    ? solve({
        window: event.window,
        budgetCapCents: event.budgetCapCents,
        people: ready.map(({ member, answer }) => ({ handle: member.handle, answer })),
        activities: candidates.filter((c) => c.venue.kind === "activity"),
        restaurants: candidates.filter((c) => c.venue.kind === "restaurant"),
        travel,
        fact: factLookup(
          candidates.map((c) => c.venue),
          deps.db.verificationsOf(event.id),
        ),
      })
    : { status: "INFEASIBLE" as const, options: [], conflicts: ["The event doesn't have a time window yet."] };
  // 没确认的（或者确认了却没有集合点，答案不完整）不参与求解，但要在方案里写明
  const noAnswer = people.filter((person) => !ready.includes(person)).map(({ member }) => ({ handle: member.handle, reason: "no_answer" as const }));
  const plan: Plan = {
    id: newId("plan"),
    eventId: event.id,
    inputVersion: event.inputVersion,
    createdAt: deps.now.toISOString(),
    ...result,
    options: result.options.map((option) => ({ ...option, excluded: [...option.excluded, ...noAnswer] })),
  };
  deps.db.putPlan(plan);
  return plan;
}

/** 车程矩阵：一次请求所有相关地点之间的车程（缓存由地图层负责）。请求失败就全部按未知处理。 */
async function travelLookup(maps: Maps, places: Place[]): Promise<(from: string, to: string) => number | undefined> {
  let rows: TravelTime[] = [];
  try {
    rows = await maps.travelMinutes(places, places);
  } catch (error) {
    console.warn("[maps] 车程矩阵请求失败，这次按未知处理", error instanceof Error ? error.message : error);
  }
  const table = new Map(rows.map((row) => [`${row.fromPlaceId}|${row.toPlaceId}`, row.minutes]));
  return (from, to) => table.get(`${from}|${to}`);
}

/** 场地事实：人工核实记录优先，其次是场地数据，没有就是 UNKNOWN。 */
function factLookup(venues: Venue[], verifications: Verification[]): (venueId: string, fact: string) => Fact {
  const verified = new Map(verifications.map((v) => [`${v.venueId}|${v.fact}`, v.value]));
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  return (venueId, fact) => verified.get(`${venueId}|${fact}`) ?? byId.get(venueId)?.facts[fact] ?? "UNKNOWN";
}

interface PresentOptions {
  /** 放在方案前面的一句话。 */
  lead?: string;
  /** 组织者刚要求的（plan it、改设置、核实）：要等司机答复时告诉他一声。 */
  requested?: boolean;
}

/**
 * 把方案交给该知道的人：
 * 用到还没答应的 if_needed 司机 → 先私聊问司机；没发布 → 方案发给组织者；已发布且有人受影响 → 变更提议发给组织者。
 */
function presentPlan(deps: FlowDeps, event: Event, plan: Plan, opts: PresentOptions = {}): { outbound: Outbound[]; pending: boolean } {
  const organizer = event.organizer;
  const best = plan.options[0];
  const drivers = best?.ifNeededDrivers ?? [];
  releaseDrivers(deps, event, drivers);
  if (best && drivers.length) {
    const asks = drivers.flatMap((handle) => askToDrive(deps, event, best, handle));
    const notice = opts.requested ? [say(organizer, t.checkingDrivers(drivers.map((handle) => nameOf(deps, event, handle))))] : [];
    return { outbound: [...notice, ...asks], pending: true };
  }
  const view = planView(deps.db, event, plan, organizer);
  const lead = (text: string) => [opts.lead, text].filter(Boolean).join("\n");
  if (event.published) {
    if (view.state === "update") return { outbound: [say(organizer, lead(t.updateProposal(view, view.unaffected ?? [], dayName(event))))], pending: true };
    return { outbound: opts.requested ? [say(organizer, lead(t.planUnchanged()))] : [], pending: false };
  }
  if (!best) return { outbound: [say(organizer, lead(t.noPlan(plan.conflicts)))], pending: false };
  const host = deps.db.member(event.id, organizer);
  return { outbound: [say(organizer, lead(t.planMessage(view)), ...(host ? [link(memberUrl(deps.baseUrl, host))] : []), t.planPrompt(view))], pending: true };
}

/** 新方案不再需要的司机：之前问他的那句作废，他后面的消息按普通消息处理。 */
function releaseDrivers(deps: FlowDeps, event: Event, keep: Handle[]): void {
  for (const { member } of participantsOf(deps.db, event)) {
    const session = deps.db.session(member.handle);
    if (session.awaiting === "drive_consent" && session.eventId === event.id && !keep.includes(member.handle)) {
      deps.db.putSession({ ...session, awaiting: undefined });
    }
  }
}

/** 私聊 if_needed 的司机：说明为什么需要他、要带谁、多绕几分钟。 */
function askToDrive(deps: FlowDeps, event: Event, option: PlanOption, handle: Handle): Outbound[] {
  const member = deps.db.member(event.id, handle);
  const ride = option.rides.find((candidate) => candidate.driver === handle);
  const session = deps.db.session(handle);
  // 已经问过、还在等他答复：不再问一遍
  if (!member || !ride || session.awaiting === "drive_consent") return [];
  deps.db.putSession({ ...session, eventId: event.id, awaiting: "drive_consent" });
  const passengers = ride.passengers.map((passenger) => nameOf(deps, event, passenger));
  return [tell(handle, member.name, event.organizer, [t.driveAsk(member.name, driveReason(deps, event, option), passengers, ride.detourMinutes, dayName(event))])];
}

/** 发布后原来的司机不开了：请替补司机时说一句原因。发布前不说具体是谁。 */
function driveReason(deps: FlowDeps, event: Event, option: PlanOption): string | undefined {
  const live = publishedOption(deps.db, event.published);
  if (!live) return undefined;
  const drivers = new Set(option.rides.map((ride) => ride.driver));
  const stopped = live.rides.map((ride) => ride.driver).filter((driver) => !drivers.has(driver) && option.attendees.includes(driver));
  return stopped.length ? `${stopped.map((driver) => nameOf(deps, event, driver)).join(" and ")} can't drive ${dayName(event)} anymore` : undefined;
}

/** 组织者说 plan it，或者所有人都确认了：进入 REVIEW，求解，出方案。 */
export async function startReview(deps: FlowDeps, event: Event, opts: PresentOptions = {}): Promise<Outbound[]> {
  const reviewing = event.status === "COLLECTING" ? transition(event, "REVIEW") : event;
  deps.db.putEvent(reviewing);
  return presentPlan(deps, reviewing, await solveEvent(deps, reviewing), opts).outbound;
}

/** 组织者改了设置之后（或其他需要他马上看到结果的时候）：重新求解并把结果发给他。 */
export async function replan(deps: FlowDeps, event: Event, lead?: string): Promise<Outbound[]> {
  return presentPlan(deps, event, await solveEvent(deps, event), { lead, requested: true }).outbound;
}

/**
 * 有人确认了答案（或不来了）之后：
 * 收集阶段全员确认就出方案；REVIEW 重新出方案；发布后重新求解，有人受影响就给组织者提议。
 * `reply`：发布后回给这个人的话（在协调 / 什么都不变）。
 */
export async function afterConfirm(deps: FlowDeps, event: Event): Promise<{ outbound: Outbound[]; reply?: string }> {
  switch (event.status) {
    case "COLLECTING":
      return { outbound: allConfirmed(deps, event) ? await startReview(deps, event, { lead: t.allReady(participantsOf(deps.db, event).length) }) : [] };
    case "REVIEW":
      return { outbound: presentPlan(deps, event, await solveEvent(deps, event), { lead: t.replanned() }).outbound };
    case "PUBLISHED": {
      // 要等司机答复、或者有人的安排变了：告诉这个人会去协调；否则什么都不变
      const { outbound, pending } = presentPlan(deps, event, await solveEvent(deps, event));
      return { outbound, reply: pending ? t.changeNoted(organizerName(deps.db, event)) : t.nothingChanges(dayName(event)) };
    }
    default:
      return { outbound: [] };
  }
}

/** if_needed 的司机回复能不能开。同意、不同意都记下，然后重新求解。 */
export async function consentTurn(deps: FlowDeps, turn: Turn, session: Session, event: Event): Promise<Outbound[]> {
  const agreed = confirmsSummary(turn);
  if (agreed === undefined) return [say(turn.handle, t.driveAskAgain())];
  const answer = deps.db.answer(event.id, turn.handle);
  deps.db.putSession({ ...session, awaiting: undefined });
  if (!answer) return [];
  deps.db.putAnswer({ ...answer, agreedToDrive: agreed });
  const current = bumpInput(event);
  deps.db.putEvent(current);
  return [say(turn.handle, t.driveThanks(agreed, organizerName(deps.db, current))), ...presentPlan(deps, current, await solveEvent(deps, current)).outbound];
}

/** 组织者核实了待核实项（打过电话）：记下来源和时间，重新求解。 */
export async function verify(deps: FlowDeps, event: Event, supported: boolean, text: string): Promise<Outbound[]> {
  const organizer = event.organizer;
  const option = deps.db.latestPlan(event.id)?.options[0];
  if (!option?.unknowns.length) return [say(organizer, t.nothingToVerify())];
  const byPhone = /\b(?:call(?:ed)?|phoned?)\b|电话/i.test(text);
  for (const unknown of option.unknowns) {
    deps.db.putVerification({
      eventId: event.id,
      venueId: unknown.venueId,
      fact: unknown.fact,
      value: supported ? "SUPPORTED" : "UNSUPPORTED",
      by: organizer,
      at: deps.now.toISOString(),
      note: byPhone ? "by phone" : undefined,
    });
  }
  const current = bumpInput(event);
  deps.db.putEvent(current);
  const plan = await solveEvent(deps, current);
  const next = plan.options[0];
  const sameAndReady =
    supported && next?.status === "FEASIBLE" && !next.ifNeededDrivers.length && next.activity.venueId === option.activity.venueId && next.dinner.venueId === option.dinner.venueId;
  if (sameAndReady) return [say(organizer, t.verified(localTimeIn(event.timezone, deps.now), byPhone, next.label))];
  const venue = deps.db.venue(option.dinner.venueId);
  const name = venue ? (deps.db.place(venue.placeId)?.name ?? "that place") : "that place";
  return presentPlan(deps, current, plan, { lead: supported ? t.noted() : t.ruledOut(name), requested: true }).outbound;
}

/** 组织者的 approve：通过批准检查才发布。方案过期就直接发最新的方案。 */
export async function approve(deps: FlowDeps, turn: Turn, event: Event, label?: string): Promise<Outbound[]> {
  const organizer = event.organizer;
  const plan = deps.db.latestPlan(event.id);
  if (!plan) return [say(organizer, t.noPlanYet())];
  const check = checkApproval(event, plan, turn.handle, label);
  if (!check.ok) {
    if (check.reason === "not_organizer") return [];
    if (check.reason === "stale") return replan(deps, event, t.approvalProblem("stale"));
    return [say(organizer, t.approvalProblem(check.reason, planView(deps.db, event, plan, organizer)))];
  }
  if (event.published && planView(deps.db, event, plan, organizer).state !== "update") return [say(organizer, t.planUnchanged())];
  return publish(deps, event, plan, check.option);
}

/** 发布：记下已发布的方案，第一次发给所有人，之后只发给受影响的人。 */
function publish(deps: FlowDeps, event: Event, plan: Plan, option: PlanOption): Outbound[] {
  const before = publishedOption(deps.db, event.published);
  const published: Event = {
    ...transition(event, "PUBLISHED"),
    published: { planId: plan.id, label: option.label },
    previous: event.published,
    publications: (event.publications ?? 0) + 1,
  };
  deps.db.putEvent(published);
  const recipients = before ? affectedHandles(before, option) : [...option.attendees, ...option.excluded.map((exclusion) => exclusion.handle)];
  const notices = recipients.flatMap((handle) => notificationsFor(deps, published, plan, option, handle, before));
  const quiet = quietNow(deps);
  const at = quiet && recipients.some((handle) => handle !== event.organizer) ? localTimeIn(deps.timezone, quiet) : undefined;
  const count = before ? recipients.length : option.attendees.length;
  const reply = at ? t.publishedLater(count, at, Boolean(before)) : before ? t.updateSent(count) : t.published(count);
  return [say(event.organizer, reply), ...notices];
}

/** 给一个人的通知：在方案里的发个人安排（有邮箱的加邮件和日历邀请），被排除的发一条说明，没回复过的不打扰。 */
function notificationsFor(deps: FlowDeps, event: Event, plan: Plan, option: PlanOption, handle: Handle, before?: PlanOption): Outbound[] {
  const member = deps.db.member(event.id, handle);
  if (!member) return [];
  const send = (parts: OutPart[], delivery: DeliveryTag) =>
    handle === event.organizer ? { ...say(handle, ...parts), delivery } : tell(handle, member.name, event.organizer, parts, { delivery });

  if (!rideOf(option, handle)) {
    const exclusion = option.excluded.find((candidate) => candidate.handle === handle);
    if (!exclusion || exclusion.reason === "no_answer") return [];
    return [send([t.excludedNotice(exclusion.reason, organizerName(deps.db, event), dayName(event))], { planId: plan.id, kind: "excluded" })];
  }
  const itinerary = itineraryView(deps.db, event, option, member, deps, before)!;
  const updating = Boolean(before && rideOf(before, handle));
  const url = memberUrl(deps.baseUrl, member);
  const delivery: DeliveryTag = { planId: plan.id, kind: updating ? "update" : "final" };
  const messages: Outbound[] = [send(t.personalPlan(itinerary, dayName(event), updating ? "update" : "final", url), delivery)];
  if (member.email) messages.push(emailFor(deps, event, member, itinerary, updating, url, delivery));
  return messages;
}

/** 个性化邮件 + METHOD:REQUEST 的日历邀请（固定 UID，SEQUENCE = 发布次数 − 1）。 */
function emailFor(deps: FlowDeps, event: Event, member: Member, itinerary: ItineraryView, updating: boolean, url: string, delivery: DeliveryTag): EmailAction {
  const day = event.day ?? todayIn(event.timezone, deps.now);
  const calendar = memberCalendar(deps, { event, member, itinerary, method: "REQUEST", day }, deps.now);
  const message = planEmail({
    to: member.email!,
    name: member.name,
    title: event.title,
    dayName: dayName(event),
    itinerary,
    url,
    mode: updating ? "update" : "final",
    mapImageUrl: deps.mapImages ? `${deps.baseUrl}${mapImagePath(member, event)}` : undefined,
    calendar,
  });
  return { kind: "email", to: member.handle, message, onFail: { notify: event.organizer, name: member.name }, delivery };
}
