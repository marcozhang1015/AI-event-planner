// 录屏用的固定剧本。不连后端、不调模型：四位参与者同时收到邀请，再自然错峰回复。

import type { SimLinkPreview, SimPerson } from "@shared/sim";

export interface DemoCue {
  seq: number;
  at: number;
  person: string;
  type: "typing" | "agent" | "link" | "compose" | "draft" | "send";
  on?: boolean;
  text?: string;
  url?: string;
  preview?: SimLinkPreview;
  /** 这条消息上方显示的时间，和真实播放间隔无关。 */
  stamp?: string;
}

interface WaitStep {
  kind: "wait";
  ms: number;
}

interface JunoStep {
  kind: "juno";
  text: string;
  typingMs: number;
  /** 输入指示出现前的停顿。不写则用 REACT_MS；第一条邀请写 0。 */
  pauseMs?: number;
}

interface UserStep {
  kind: "user";
  text: string;
  charMs: number;
  holdMs?: number;
}

interface LinkStep {
  kind: "link";
  url: string;
  preview: SimLinkPreview;
}

type Step = WaitStep | JunoStep | UserStep | LinkStep;

interface ThreadSpec {
  person: SimPerson;
  startMs: number;
  steps: Step[];
}

const CHAR_MS = 64;
const HOLD_MS = 220;
/** 用户发出去之后，Juno 的输入指示再过这么久才出现。 */
const REACT_MS = 500;

function opener(name: string): string {
  return `Hi ${name}, it's Juno — Peter wants to go hiking and then grab dinner. Want to come? If you have a trail or a restaurant in mind, tell me that too.`;
}

const threads: ThreadSpec[] = [
  {
    person: { id: "marco", name: "Marco" },
    startMs: 400,
    steps: [
      { kind: "juno", typingMs: 650, pauseMs: 0, text: opener("Marco") },
      { kind: "wait", ms: 715 },
      { kind: "user", text: "Yeah — after 3 works, but I need to be home by 10.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1400, text: "So Saturday, free from 3 and home by 10. Would starting the hike at 3:30 be easier?" },
      { kind: "wait", ms: 420 },
      { kind: "user", text: "3:30 is better. I don't want to rush over.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1200, text: "Perfect. Free from 3:30, home by 10. I'll text you once the plan is set." },
    ],
  },
  {
    person: { id: "phil", name: "Phil" },
    startMs: 400,
    steps: [
      { kind: "juno", typingMs: 650, pauseMs: 0, text: opener("Phil") },
      { kind: "wait", ms: 165 },
      { kind: "user", text: "I'm in. Somewhere scenic, but please nothing too steep.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1500, text: "Scenic and moderate. Riverside Trail is about 4 miles, and we can skip the steep spur." },
      { kind: "wait", ms: 80 },
      {
        kind: "link",
        url: "https://www.google.com/maps/search/?api=1&query=Riverside+Trail",
        preview: {
          provider: "google-maps",
          title: "Riverside Trail",
          subtitle: "4.2 mi · Moderate · Main loop",
          detail: "Google Maps",
        },
      },
      { kind: "wait", ms: 780 },
      { kind: "user", text: "Riverside is perfect if we stay on the main loop.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1300, text: "Riverside Trail, main loop only. I'll hold that while I check with the others." },
    ],
  },
  {
    person: { id: "josh", name: "Josh" },
    startMs: 400,
    steps: [
      { kind: "juno", typingMs: 650, pauseMs: 0, text: opener("Josh") },
      { kind: "wait", ms: 860 },
      { kind: "user", text: "Count me in. I'm vegetarian — a real veg dish, not just a side salad.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1500, text: "Noted, vegetarian. Maple Kitchen has veg mains, and they can keep nuts off the plate." },
      { kind: "wait", ms: 80 },
      {
        kind: "link",
        url: "https://www.opentable.com/s?term=Maple%20Kitchen",
        preview: {
          provider: "opentable",
          title: "Maple Kitchen",
          subtitle: "Vegetarian-friendly · $$",
          detail: "4.7 ★ · OpenTable",
        },
      },
      { kind: "wait", ms: 85 },
      { kind: "user", text: "Maple Kitchen works. No allergies, just nothing too spicy.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1300, text: "Maple Kitchen, vegetarian, mild. I'll flag that before dinner is locked in." },
    ],
  },
  {
    person: { id: "alvin", name: "Alvin" },
    startMs: 400,
    steps: [
      { kind: "juno", typingMs: 650, pauseMs: 0, text: opener("Alvin") },
      { kind: "wait", ms: 425 },
      { kind: "user", text: "I can drive — three seats, leaving from North Station.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1500, text: "Three seats from North Station helps. Peter capped the day at $40 each. Does that work?" },
      { kind: "wait", ms: 715 },
      { kind: "user", text: "$40 is fine. I can pick someone up if it's on the way.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "juno", typingMs: 1300, text: "You're set: North Station, three seats, under $40. I'll send the route with the plan." },
    ],
  },
];

const WAIT_SCALE = 4;

function compile(specs: ThreadSpec[]): { cues: DemoCue[]; endMs: number } {
  const cues: DemoCue[] = [];
  let seq = 0;
  let endMs = 0;
  for (const thread of specs) {
    let at = thread.startMs;
    for (const step of thread.steps) {
      if (step.kind === "wait") {
        at += step.ms * WAIT_SCALE;
        continue;
      }
      if (step.kind === "juno") {
        if (step.typingMs > 0) {
          at += step.pauseMs ?? REACT_MS;
          cues.push({ seq: seq++, at, person: thread.person.id, type: "typing", on: true });
          at += step.typingMs;
          cues.push({ seq: seq++, at, person: thread.person.id, type: "typing", on: false });
        }
        cues.push({ seq: seq++, at, person: thread.person.id, type: "agent", text: step.text });
        continue;
      }
      if (step.kind === "link") {
        cues.push({ seq: seq++, at, person: thread.person.id, type: "link", text: step.preview.title, url: step.url, preview: step.preview });
        continue;
      }
      cues.push({ seq: seq++, at, person: thread.person.id, type: "compose", on: true });
      for (let i = 1; i <= step.text.length; i++) {
        at += step.charMs;
        cues.push({ seq: seq++, at, person: thread.person.id, type: "draft", text: step.text.slice(0, i) });
      }
      at += step.holdMs ?? HOLD_MS;
      cues.push({ seq: seq++, at, person: thread.person.id, type: "send", text: step.text });
      cues.push({ seq: seq++, at, person: thread.person.id, type: "compose", on: false });
    }
    endMs = Math.max(endMs, at);
  }
  // 最终安排：屏幕上的时间是下午，看起来隔了很久；实际只再等两秒，四个人一起收到。
  const finalTypingMs = 600;
  const finalAt = endMs + 2_000;
  const finalText = ["Saturday is locked in 🎉", "", "• 🥾 **3:30 PM** — Riverside Trail", "• 🍽️ **Dinner** — Maple Kitchen", "• 🏠 Home by **10 PM**"].join("\n");
  for (const thread of specs) {
    cues.push({ seq: seq++, at: finalAt - finalTypingMs, person: thread.person.id, type: "typing", on: true });
    cues.push({ seq: seq++, at: finalAt, person: thread.person.id, type: "typing", on: false });
    cues.push({
      seq: seq++,
      at: finalAt,
      person: thread.person.id,
      type: "agent",
      text: finalText,
      stamp: "Today 2:18 PM",
    });
  }
  endMs = finalAt;
  for (const cue of cues) cue.at = Math.round(cue.at);
  cues.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return { cues, endMs: Math.round(endMs) };
}

const compiled = compile(threads);

export const DEMO_PEOPLE: SimPerson[] = threads.map((thread) => thread.person);
export const DEMO_FOCUS: Record<string, string> = {
  marco: "availability",
  phil: "the trail",
  josh: "food",
  alvin: "rides & budget",
};
export const DEMO_CUES: DemoCue[] = compiled.cues;
/** 最后一条消息之后留一点阅读时间，再出现 Replay。 */
export const DEMO_DURATION_MS = compiled.endMs + 1_600;
export const DEMO_END_MS = compiled.endMs;
