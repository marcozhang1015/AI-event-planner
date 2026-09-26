// iMessage 文案模板。事实性内容（摘要、方案、个人安排、变更）一律从这里生成，而且只从隐私投影后的视图生成，保证和数据一致（§5.4、§5.11）。
// 措辞参照 hackathon-plan.md §4.3 的示例对话。

import { allergyPhrase, EXCLUSION_LABELS, priceSpan } from "../shared/labels";
import { fmtMoney, fmtTime, fmtWindow, toMinutes, weekdayName } from "../shared/time";
import type { Answer, Event, ExclusionReason, LocalTime, Place } from "../shared/types";
import type { ItineraryView, OptionView, PersonRef, PlanView, VenueRef } from "../shared/views";
import { celebrate, link, type OutPart } from "./actions";

/** "Saturday"；日期还没定时是 "the day"。 */
export function dayName(event: Event): string {
  return event.day ? weekdayName(event.day) : "the day";
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** 句中称呼：自己是 "you"。 */
function who(person: PersonRef): string {
  return person.me ? "you" : person.name;
}

function whoList(people: PersonRef[]): string {
  return listNames(people.map(who));
}

/** 方案里的价格："free"、"~$22–30"（地图数据里的估计）。 */
function priceRange(venue: VenueRef): string {
  const span = priceSpan(venue);
  return span === undefined ? "price unknown" : span === "free" ? span : `~${span}`;
}

/** 发给本人的排除说明：只提他自己的原因。 */
const OWN_REASONS: Record<ExclusionReason, string> = {
  time: "the timing didn't fit your schedule",
  home_by: "it runs later than you need to be home",
  budget: "the spots that worked were over your budget",
  allergy: "I couldn't find a restaurant that's safe for your allergy",
  seats: "we ran out of seats in the cars",
  no_answer: "I didn't hear back from you in time",
};

function excludedList(option: OptionView): string {
  return listNames(option.excluded.map(({ person, reason }) => `${who(person)} (${EXCLUSION_LABELS[reason]})`));
}

/** 记忆里的那几项，一行说完："allergic to peanuts · needs a ride from Main Library"。 */
function profileLine(answer: Answer, pickup: Place | undefined): string {
  const ride =
    answer.drives === "no"
      ? `needs a ride${pickup ? ` from ${pickup.name}` : ""}`
      : answer.drives
        ? `${answer.drives === "if_needed" ? "can drive if needed" : "driving"}${answer.seats !== undefined ? ` (${answer.seats} seats)` : ""}${pickup ? ` from ${pickup.name}` : ""}`
        : undefined;
  return [
    answer.allergies && (answer.allergies.length ? `allergic to ${answer.allergies.join(", ")}` : "no food allergies"),
    answer.diet?.length ? `doesn't eat ${answer.diet.join(", ")}` : undefined,
    ride,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 个人行程的要点，iMessage 和邮件共用。 */
export function itineraryLines(it: ItineraryView): string[] {
  return [
    it.role === "rider" ? `• ${fmtTime(it.pickup.at)} — ${it.driver.name} picks you up at ${it.pickup.place.name}` : driverRoute(it),
    `• ${fmtTime(it.activity.start)} ${it.activity.venue.name}`,
    `• ${fmtTime(it.dinner.start)} ${it.dinner.venue.name}${it.dinner.note ? ` — ${it.dinner.note}` : ""}`,
    `• Your cost: up to ${fmtMoney(it.costMaxCents)}`,
    it.role === "rider"
      ? `• Back at ${it.dropoff.place.name} by ~${fmtTime(it.dropoff.at)}`
      : `• ${it.carmates.length ? "Drop-offs after dinner, then home" : "Home"} by ~${fmtTime(it.dropoff.at)}`,
  ];
}

/** 司机的接人路线："3:05 PM leave North Station with Leo → 3:15 PM Sam at Main Library"（和出发点同一站的人写成 with）。 */
function driverRoute(it: ItineraryView): string {
  const [start, ...stops] = it.route;
  if (!start) return `• ${fmtTime(it.pickup.at)} leave ${it.pickup.place.name}`;
  const along = stops.filter((stop) => stop.place.id === start.place.id).map((stop) => stop.person.name);
  const later = stops.filter((stop) => stop.place.id !== start.place.id).map((stop) => ` → ${fmtTime(stop.at)} ${stop.person.name} at ${stop.place.name}`);
  return `• ${fmtTime(start.at)} leave ${start.place.name}${along.length ? ` with ${listNames(along)}` : ""}${later.join("")}`;
}

function optionLines(option: OptionView): string[] {
  const cars = option.rides.map((ride) => `${who(ride.driver)} → ${ride.passengers.length ? whoList(ride.passengers) : "solo"}`);
  return [
    `• ${fmtTime(option.firstPickup)} pickups (${option.rides.length} car${option.rides.length === 1 ? "" : "s"}) · ${cars.join(" · ")}`,
    `• ${fmtWindow(option.activity)} ${option.activity.venue.name} (${priceRange(option.activity.venue)})`,
    `• ${fmtTime(option.dinner.start)} ${option.dinner.venue.name} (${priceRange(option.dinner.venue)} per person)`,
    `• Everyone home by ${fmtTime(option.lastDropoff)}`,
  ];
}

function unknownLine(option: OptionView): string | undefined {
  const [first] = option.unknowns;
  if (!first) return undefined;
  const facts = listNames(option.unknowns.map((unknown) => allergyPhrase(unknown.fact, unknown.severe)));
  return `⚠️ One thing I can't confirm: whether ${first.venue} can handle ${facts}. Could you give them a call?${first.phone ? ` ${first.phone}` : ""}`;
}

function planBLine(b: OptionView, a: OptionView): string {
  const place = `${b.activity.venue.id !== a.activity.venue.id ? `${b.activity.venue.name} + ` : ""}${b.dinner.venue.name}`;
  const call = a.unknowns.length ? " needs no call" : "";
  const out = b.excluded.length ? `${call ? "," : ""} but ${excludedList(b)} would have to sit this one out` : "";
  return `Plan B: ${place} (up to ${fmtMoney(b.costMaxCents)} per person)${call}${out}.`;
}

/** 两个选项之间改了什么（发布后的变更提议）：地点、时间、谁来、谁开车。 */
function planChanges(before: OptionView, after: OptionView): string[] {
  const changes: string[] = [];
  if (after.activity.venue.id !== before.activity.venue.id) changes.push(`${after.activity.venue.name} instead of ${before.activity.venue.name}`);
  if (after.dinner.venue.id !== before.dinner.venue.id) changes.push(`dinner at ${after.dinner.venue.name} instead of ${before.dinner.venue.name}`);
  if (after.activity.start !== before.activity.start) changes.push(`it starts at ${fmtTime(after.activity.start)} now (was ${fmtTime(before.activity.start)})`);

  const names = (people: PersonRef[]) => new Set(people.map((person) => person.name));
  const wasIn = names(before.attendees);
  const isIn = names(after.attendees);
  const excludedNow = names(after.excluded.map(({ person }) => person));
  for (const { person, reason } of after.excluded) if (wasIn.has(person.name)) changes.push(`${who(person)} can't make it now (${EXCLUSION_LABELS[reason]})`);
  for (const person of before.attendees) if (!isIn.has(person.name) && !excludedNow.has(person.name)) changes.push(`${who(person)} can't make it anymore`);
  for (const person of after.attendees) if (!wasIn.has(person.name)) changes.push(`${who(person)} ${person.me ? "are" : "is"} in`);

  const load = (option: OptionView) => new Map(option.rides.map((ride) => [ride.driver.name, ride.passengers.map((p) => p.name).sort().join(",")]));
  const beforeLoads = load(before);
  const afterLoads = load(after);
  for (const ride of before.rides) {
    if (!afterLoads.has(ride.driver.name) && isIn.has(ride.driver.name)) changes.push(`${who(ride.driver)} ${ride.driver.me ? "aren't" : "isn't"} driving anymore`);
  }
  for (const ride of after.rides) {
    if (beforeLoads.get(ride.driver.name) !== afterLoads.get(ride.driver.name) && ride.passengers.length) {
      changes.push(`${who(ride.driver)} ${ride.driver.me ? "drive" : "drives"} ${whoList(ride.passengers)}`);
    }
  }
  return changes.length ? changes : ["pickup times shift a little"];
}

/** 同一个人两版行程之间改了什么（发给本人的更新、行程页的 Updated）。 */
export function itineraryChanges(before: ItineraryView, after: ItineraryView): string[] {
  const changes: string[] = [];
  if (after.role !== before.role) changes.push(after.role === "driver" ? "you're driving now" : `${after.driver.name} picks you up now`);
  else if (after.role === "rider" && after.driver.name !== before.driver.name) changes.push(`${after.driver.name} picks you up now (instead of ${before.driver.name})`);
  if (after.pickup.place.id !== before.pickup.place.id) changes.push(`pickup is at ${after.pickup.place.name} now`);
  if (after.pickup.at !== before.pickup.at) changes.push(`${after.role === "driver" ? "you leave" : "pickup is"} at ${fmtTime(after.pickup.at)} (was ${fmtTime(before.pickup.at)})`);
  if (after.activity.venue.id !== before.activity.venue.id) changes.push(`${after.activity.venue.name} instead of ${before.activity.venue.name}`);
  if (after.dinner.venue.id !== before.dinner.venue.id) changes.push(`dinner at ${after.dinner.venue.name} instead of ${before.dinner.venue.name}`);
  const riders = (it: ItineraryView) => it.carmates.map((mate) => mate.person.name).sort().join(",");
  if (after.role === "driver" && riders(after) !== riders(before)) {
    changes.push(after.carmates.length ? `you're picking up ${listNames(after.carmates.map((mate) => mate.person.name))}` : "no pickups for you now");
  }
  if (Math.abs(toMinutes(after.dropoff.at) - toMinutes(before.dropoff.at)) >= 10) changes.push(`you'll be home by ~${fmtTime(after.dropoff.at)}`);
  return changes;
}

export const templates = {
  intro: (agentName: string) =>
    `Hi, I'm ${agentName} — I help friends plan get-togethers. Tell me what you have in mind, like "hike + dinner Saturday for 5, under $40 each".`,

  sorry: () => "Sorry — something went wrong on my end. Could you say that again?",

  organizerAsk(field: string, event: Event): string {
    switch (field) {
      case "title":
        return "What are you planning?";
      case "day":
        return "Which day are you thinking?";
      case "window":
        return `What window works on ${dayName(event)} — say 2 to 10 PM?`;
      case "area":
        return "Where should it be? A neighborhood or landmark is enough.";
      case "budget":
        return "What's the max per person? Something like $40.";
      default:
        return "Anything else I should know?";
    }
  },

  organizerSummary(event: Event): string {
    const lines = [
      `• ${event.day ? weekdayName(event.day) : "Day TBD"}${event.window ? ` ${fmtWindow(event.window)}` : ""} · ${event.title}${event.area ? ` · ${event.area.label}` : ""}${event.headcount ? ` · ${event.headcount} people` : ""}`,
      event.budgetCapCents !== undefined ? `• Up to ${fmtMoney(event.budgetCapCents)} per person (hard cap)` : undefined,
    ].filter(Boolean);
    return [
      "Here's the plan so far:",
      ...lines,
      "I'll message each person privately about their time, budget, food allergies and rides.",
      "Sound right?",
    ].join("\n");
  },

  whatToChange: () => "What should I change?",

  askInvitees: () => "Who's coming? Share their contacts or just type names.",

  invitesSent: (names: string[]) => `Got it. Texting ${listNames(names)} now — you can watch replies come in here:`,

  invitesDeferred: (names: string[], at: LocalTime) =>
    `Got it. It's late, so I'll text ${listNames(names)} at ${fmtTime(at)} — you can watch replies come in here:`,

  unknownInvitees: (names: string[]) => `I don't have a number for ${listNames(names)} yet — could you share their contact?`,

  alreadyInvited: (names: string[]) => `${listNames(names)} ${names.length === 1 ? "is" : "are"} already in.`,

  askJoining: () => "Are you coming too? If so, I'll grab your details here.",

  notJoining: () => "Got it — you're just organizing.",

  /** 组织者自己的第一个问题前面的引子。 */
  whileTheyReply: (question: string) => `While they reply — ${question.charAt(0).toLowerCase()}${question.slice(1)}`,

  deliveryFailed(notices: { name: string; retry?: string }[]): string {
    const retries = [...new Set(notices.flatMap((notice) => (notice.retry ? [`"${notice.retry}"`] : [])))];
    return `I couldn't reach ${listNames([...new Set(notices.map((notice) => notice.name))])} — my message didn't go through. Check that the number is right${
      retries.length ? `, then say ${listNames(retries)} to try again` : ""
    }.`;
  },

  collectingStatus: (confirmed: number, total: number, waiting: string[]) =>
    waiting.length ? `${confirmed} of ${total} ready · waiting on ${listNames(waiting)}` : `All ${total} ready.`,

  opener: (name: string, organizerName: string, event: Event, agentName: string, returning: boolean) =>
    `Hi ${name}, it's ${agentName} — ${organizerName} is putting together ${event.title} ${event.day ? `this ${weekdayName(event.day)}` : "soon"} and asked me to find a time that works for everyone. ${
      returning ? "I remember your details from last time, so this'll be quick — got a sec?" : "Got a sec for a few quick questions?"
    }`,

  openerLater: () => "No worries — text me whenever you have a minute.",

  attendeeAsk(field: string, event: Event, organizerName: string, answer: Answer, pickup?: Place): string {
    switch (field) {
      case "free":
        return `What part of ${dayName(event)}${event.window ? ` ${fmtWindow(event.window)}` : ""} are you free?`;
      case "remembered":
        return `From last time I have: ${profileLine(answer, pickup)}. Still right?`;
      case "allergies":
        return "Any food allergies or things you don't eat?";
      case "drives":
        return "Do you drive, or need a ride? (Only your car group will see your name and pickup spot.)";
      case "seats":
        return "How many people can you take?";
      case "pickup":
        return answer.drives === "no"
          ? "Where should we pick you up? A landmark near you is enough."
          : "Where will you be driving from? A landmark near you is enough.";
      case "budget":
        return event.budgetCapCents !== undefined
          ? `Last one: ${organizerName} set ${fmtMoney(event.budgetCapCents)}/person as the max. Does that work for you?`
          : "Last one: what's the most you'd want to spend?";
      default:
        return "Anything else I should know?";
    }
  },

  pickupNotFound: (query: string) => `I couldn't find "${query}" on the map. Is there a landmark nearby?`,

  /** 集合点候选：ambiguous 是找到了好几个，fallback 是一直找不到、列出别人已经确认的集合点。 */
  pickupChoices: (names: string[], kind: "ambiguous" | "fallback") =>
    [
      kind === "ambiguous" ? "I found a few — which one?" : "I still can't find that. Want to meet at one of these instead?",
      ...names.map((name, index) => `${index + 1}. ${name}`),
      `Reply ${names.length === 1 ? "1" : `${names.slice(0, -1).map((_, index) => index + 1).join(", ")} or ${names.length}`}, or name another landmark.`,
    ].join("\n"),

  /** `firstTime`：这个人还没有记忆。第一次记之前先告诉本人，并说明怎么删。 */
  attendeeSummary(answer: Answer, pickup: Place | undefined, updated: boolean, firstTime: boolean): string {
    const free = answer.free?.map(fmtWindow).join(", ");
    const lines = [
      free ? `• Free ${free}${answer.homeBy ? `, home by ${fmtTime(answer.homeBy)}` : ""}` : undefined,
      answer.allergies?.length ? `• Allergic to ${answer.allergies.join(", ")}` : "• No food allergies",
      answer.diet?.length ? `• Doesn't eat: ${answer.diet.join(", ")}` : undefined,
      answer.drives === "no"
        ? `• Needs a ride${pickup ? `, pickup at ${pickup.name}` : ""}`
        : `• ${answer.drives === "if_needed" ? "Can drive if needed" : "Driving"}${answer.seats !== undefined ? `, ${answer.seats} seats` : ""}${pickup ? `, from ${pickup.name}` : ""}`,
      answer.budgetCapCents !== undefined ? `• Budget up to ${fmtMoney(answer.budgetCapCents)}` : undefined,
    ].filter(Boolean);
    return [
      updated ? "Updated — here's what I've got:" : "Here's what I've got:",
      ...lines,
      "Right? You can change anything anytime.",
      firstTime ? "I'll also remember your food and ride details for next time (say “forget me” to undo)." : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  },

  /** 发布后原来开车的人不能开了：先确认他还来，再去找替补司机。 */
  driverDropped: (pickupName: string | undefined) =>
    `Thanks for the heads-up. Still want to come? I can get you picked up${pickupName ? ` near ${pickupName}` : ""}.`,

  forgotten: () => "Done — I've forgotten your saved details. This plan still has what you told me.",

  askEmail: () => "Want the calendar invite by email too? Send your email, or just say skip.",

  attendeeDone: () => "Perfect. I'll text you as soon as the plan is set.",

  /** 发布后改了答案、本人确认之后。 */
  changeNoted: (organizerName: string) => `Thanks — I'll work out the change with ${organizerName} and text you the update.`,

  nothingChanges: (dayName: string) => `Got it — nothing changes for ${dayName}.`,

  notPlannedYet: (organizerName: string) => `Nothing's locked in yet — I'll text you as soon as ${organizerName} approves the plan.`,

  noted: () => "Noted.",

  // 方案（组织者）

  allReady: (count: number) => `All ${count} ready. Here's what works:`,

  planMessage(plan: PlanView): string {
    const [a, b] = plan.options;
    if (!a) return templates.noPlan(plan.conflicts);
    const total = a.attendees.length + a.excluded.length;
    return [
      a.excluded.length ? `Plan A works for ${a.attendees.length} of ${total}:` : `Plan A works for all ${a.attendees.length}:`,
      ...optionLines(a),
      unknownLine(a),
      a.excluded.length ? `Not in Plan A: ${excludedList(a)}.` : undefined,
      b ? planBLine(b, a) : undefined,
      "Map and full plan:",
    ]
      .filter(Boolean)
      .join("\n");
  },

  planPrompt(plan: PlanView): string {
    const [a, b] = plan.options;
    if (!a) return "Tell me what to change and I'll try again.";
    const alternative = b ? ` (or "approve B")` : "";
    return a.status === "NEEDS_VERIFICATION"
      ? `Reply "approve A" once it's confirmed${alternative}, or tell me what to change.`
      : `Reply "approve A" and I'll send everyone their details${alternative}, or tell me what to change.`;
  },

  noPlan: (conflicts: string[]) => `I couldn't make a plan that works yet. ${conflicts.join(" ")}`,

  checkingDrivers: (names: string[]) => `One sec — checking with ${listNames(names)} about driving first.`,

  /** 发布后提出的修改：只列改了什么、影响到谁（plan.changes 和 plan.affected 由 planView 算好）。 */
  updateProposal(plan: PlanView, unaffected: PersonRef[], dayName: string): string {
    const affected = plan.affected ?? [];
    const rest = unaffected.length
      ? ` — ${whoList(unaffected)} ${unaffected.length === 1 && !unaffected[0]!.me ? "isn't" : "aren't"} affected`
      : "";
    const [after] = plan.options;
    const check = after ? unknownLine(after) : undefined;
    return [
      `Change for ${dayName}: ${(plan.changes ?? []).join("; ") || "the plan shifts a little"}. Everything else stays the same${rest}.`,
      check,
      `Reply "approve"${check ? " once it's confirmed" : ""} to send the update to the ${affected.length} ${affected.length === 1 ? "person" : "people"} affected.`,
    ]
      .filter(Boolean)
      .join("\n");
  },

  replanned: () => "Heads up — someone's answers changed, so here's the updated plan:",

  eventUpdated: (line: string) => `Updated: ${line}. I'll use that when I make the plan.`,

  declined: (organizerName: string) => `Sorry you'll miss it — I'll let ${organizerName} know.`,

  planChanges,

  /** 发布后求解出来的方案和已发布的一样：什么都不用发。 */
  planUnchanged: () => "I rechecked the plan — nothing changes for anyone.",

  verified: (at: LocalTime, byPhone: boolean, label: string) =>
    `Noted — confirmed by you${byPhone ? " by phone" : ""} at ${fmtTime(at)}. Plan ${label} is ready. Reply "approve ${label}" and I'll send everyone their details.`,

  ruledOut: (venue: string) => `Noted — ${venue} can't handle it, so I've taken it off the table.`,

  nothingToVerify: () => "There's nothing I need checked right now.",

  approvalProblem(reason: "stale" | "infeasible" | "ambiguous" | "no_option" | "needs_verification" | "waiting_on_driver", plan?: PlanView): string {
    const a = plan?.options[0];
    switch (reason) {
      case "stale":
        return "Something changed since that plan — here's the latest:";
      case "infeasible":
        return "There's no workable plan to approve yet.";
      case "ambiguous":
        return `Which one — "approve A" or "approve B"?`;
      case "no_option":
        return `There's no Plan ${plan?.options.length === 1 ? "B" : "like that"} — "approve A" is the one I have.`;
      case "needs_verification":
        return a?.unknowns.length ? `I still need to know whether ${a.unknowns[0]!.venue} can handle it before I send anything. Could you give them a call?` : "That option still needs a quick check.";
      case "waiting_on_driver":
        return `Still waiting on ${a ? whoList(a.waitingOn) : "a driver"} about driving.`;
    }
  },

  noPlanYet: () => `There's no plan to approve yet — say "plan it" when you're ready.`,

  published: (count: number) => `Sent to all ${count} 🎉`,

  publishedLater: (count: number, at: LocalTime, update: boolean) =>
    update
      ? `Approved. It's late, so I'll send the update to the ${count} ${count === 1 ? "person" : "people"} affected at ${fmtTime(at)}.`
      : `Approved. It's late, so I'll send all ${count} their details at ${fmtTime(at)}.`,

  updateSent: (count: number) => `Update sent to the ${count} ${count === 1 ? "person" : "people"} affected.`,

  reviewHelp: (plan: PlanView | undefined) =>
    plan?.state === "update" ? `Reply "approve" to send the update, or tell me what to change.` : plan ? templates.planPrompt(plan) : `Say "plan it" when you're ready.`,

  // 司机

  driveAsk: (name: string, reason: string | undefined, passengers: string[], detourMinutes: number, dayName: string) =>
    `Hey ${name} — ${reason ?? `to make ${dayName} work we need one more car`}. You mentioned you could drive if needed: could you take ${listNames(passengers)}? It's about ${Math.max(5, Math.round(detourMinutes / 5) * 5)} extra minutes.`,

  driveThanks: (agreed: boolean, organizerName: string) =>
    agreed ? `Thanks! I'll send you the details once ${organizerName} approves.` : "No problem — I'll work around it.",

  driveAskAgain: () => "Sorry, just to check — could you drive? A yes or no is perfect.",

  // 个人通知

  personalPlan(it: ItineraryView, dayName: string, mode: "final" | "update" | "resend", url: string): OutPart[] {
    const lines = itineraryLines(it);
    if (mode === "final") return [celebrate([`You're all set for ${dayName} 🎉`, ...lines, "Map and details:"].join("\n")), link(url)];
    const head = mode === "update" ? `Update for ${dayName} — ${it.changes.length ? it.changes.join("; ") : "your plan changed"}.` : `Here's your plan for ${dayName}:`;
    return [[head, ...lines, "Map and details:"].join("\n"), link(url)];
  },

  excludedNotice: (reason: ExclusionReason, organizerName: string, dayName: string) =>
    `Heads up — ${organizerName} locked in ${dayName}'s plan, but ${OWN_REASONS[reason]}, so you're not in this one. If anything changes on your side, just text me.`,

  allergyNote: (organizerName: string, facts: string[]) => `${organizerName} confirmed with them that they can handle your ${listNames(facts)} allergy`,
};
