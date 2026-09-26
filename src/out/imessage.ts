// iMessage 文案模板。事实性内容（摘要、方案、个人安排）一律从这里生成，保证和数据一致（§5.4）。
// 措辞参照 hackathon-plan.md §4.3 的示例对话。

import { fmtMoney, fmtTime, fmtWindow, weekdayName } from "../core/time";
import type { Answer, Event, Place } from "../types";

/** 发出去的一段内容。transport 负责换成 Spectrum 的 content builder。 */
export type OutPart = string | { type: "link"; url: string } | { type: "celebrate"; text: string };

export const link = (url: string): OutPart => ({ type: "link", url });
export const celebrate = (text: string): OutPart => ({ type: "celebrate", text });

function dayPhrase(event: Event): string {
  return event.day ? weekdayName(event.day) : "the day";
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
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

export const templates = {
  intro: (agentName: string) =>
    `Hi, I'm ${agentName} — I help friends plan get-togethers. Tell me what you have in mind, like "hike + dinner Saturday for 5, under $40 each".`,

  organizerAsk(field: string, event: Event): string {
    switch (field) {
      case "title":
        return "What are you planning?";
      case "day":
        return "Which day are you thinking?";
      case "window":
        return `What window works on ${dayPhrase(event)} — say 2 to 10 PM?`;
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

  unknownInvitees: (names: string[]) => `I don't have a number for ${listNames(names)} yet — could you share their contact?`,

  collectingStatus: (confirmed: number, total: number, waiting: string[]) =>
    waiting.length ? `${confirmed} of ${total} ready · waiting on ${listNames(waiting)}` : `All ${total} ready.`,

  planningNotReady: () => "Planning isn't hooked up yet — the solver comes next.",

  opener: (name: string, organizerName: string, event: Event, agentName: string, returning: boolean) =>
    `Hi ${name}, it's ${agentName} — ${organizerName} is putting together ${event.title} ${event.day ? `this ${weekdayName(event.day)}` : "soon"} and asked me to find a time that works for everyone. ${
      returning ? "I remember your details from last time, so this'll be quick — got a sec?" : "Got a sec for 4 quick questions?"
    }`,

  openerLater: () => "No worries — text me whenever you have a minute.",

  attendeeAsk(field: string, event: Event, organizerName: string, answer: Answer, pickup?: Place): string {
    switch (field) {
      case "free":
        return `What part of ${dayPhrase(event)}${event.window ? ` ${fmtWindow(event.window)}` : ""} are you free?`;
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

  forgotten: () => "Done — I've forgotten your saved details. This plan still has what you told me.",

  askEmail: () => "Want the calendar invite by email too? Send your email, or just say skip.",

  attendeeDone: () => "Perfect. I'll text you as soon as the plan is set.",

  noted: () => "Noted.",
};
