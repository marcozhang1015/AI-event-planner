// 录屏用的固定剧本。不连后端、不调模型：四位参与者错峰聊 hike + dinner，每次播放都一样。

import type { SimPerson } from "@shared/sim";

export interface DemoCue {
  seq: number;
  at: number;
  person: string;
  type: "typing" | "agent" | "compose" | "draft" | "send";
  on?: boolean;
  text?: string;
}

interface WaitStep {
  kind: "wait";
  ms: number;
}

interface JunoStep {
  kind: "juno";
  text: string;
  typingMs: number;
}

interface UserStep {
  kind: "user";
  text: string;
  charMs: number;
  holdMs?: number;
}

type Step = WaitStep | JunoStep | UserStep;

interface ThreadSpec {
  person: SimPerson;
  startMs: number;
  steps: Step[];
}

const CHAR_MS = 46;
const HOLD_MS = 320;

function opener(name: string, tail: string): string {
  return `Hi ${name}, it's Juno — Alex is putting together hike + dinner this Saturday and asked me to find a time that works for everyone. ${tail}`;
}

const threads: ThreadSpec[] = [
  {
    person: { id: "sam", name: "Sam" },
    startMs: 400,
    steps: [
      { kind: "juno", typingMs: 1100, text: opener("Sam", "Got a sec for a few quick questions?") },
      { kind: "wait", ms: 5200 },
      { kind: "user", text: "Yeah — after 3 works, but I need to be home by 10.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1400, text: "So Saturday, free from 3 and home by 10. Would starting the hike at 3:30 be easier?" },
      { kind: "wait", ms: 7800 },
      { kind: "user", text: "3:30 is better. I don't want to rush over.", charMs: CHAR_MS, holdMs: HOLD_MS },
      { kind: "wait", ms: 650 },
      { kind: "juno", typingMs: 1200, text: "Perfect. Free from 3:30, home by 10. I'll text you once the plan is set." },
    ],
  },
  {
    person: { id: "priya", name: "Priya" },
    startMs: 1800,
    steps: [
      { kind: "juno", typingMs: 1200, text: opener("Priya", "Got a sec? I'd love your take on the trail.") },
      { kind: "wait", ms: 5600 },
      { kind: "user", text: "I'm in. Somewhere scenic, but please nothing too steep.", charMs: 42, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1500, text: "Scenic and moderate. Riverside Trail is about 4 miles, and we can skip the steep spur." },
      { kind: "wait", ms: 7600 },
      { kind: "user", text: "Riverside is perfect if we stay on the main loop.", charMs: 42, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1300, text: "Riverside Trail, main loop only. I'll hold that while I check with the others." },
    ],
  },
  {
    person: { id: "leo", name: "Leo" },
    startMs: 3300,
    steps: [
      { kind: "juno", typingMs: 1100, text: opener("Leo", "Got a minute for a couple of questions?") },
      { kind: "wait", ms: 5800 },
      { kind: "user", text: "Count me in. I'm vegetarian — a real veg dish, not just a side salad.", charMs: 50, holdMs: HOLD_MS },
      { kind: "wait", ms: 750 },
      { kind: "juno", typingMs: 1500, text: "Noted, vegetarian. Maple Kitchen has veg mains, and they can keep nuts off the plate." },
      { kind: "wait", ms: 7400 },
      { kind: "user", text: "Maple Kitchen works. No allergies, just nothing too spicy.", charMs: 48, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1300, text: "Maple Kitchen, vegetarian, mild. I'll flag that before dinner is locked in." },
    ],
  },
  {
    person: { id: "mia", name: "Mia" },
    startMs: 4900,
    steps: [
      { kind: "juno", typingMs: 1200, text: opener("Mia", "Got a sec? Rides and budget are the tricky part.") },
      { kind: "wait", ms: 5600 },
      { kind: "user", text: "I can drive — three seats, leaving from North Station.", charMs: 44, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1500, text: "Three seats from North Station helps. Alex capped the day at $40 each. Does that work?" },
      { kind: "wait", ms: 7200 },
      { kind: "user", text: "$40 is fine. I can pick someone up if it's on the way.", charMs: 44, holdMs: HOLD_MS },
      { kind: "wait", ms: 700 },
      { kind: "juno", typingMs: 1300, text: "You're set: North Station, three seats, under $40. I'll send the route with the plan." },
    ],
  },
];

function compile(specs: ThreadSpec[]): { cues: DemoCue[]; endMs: number } {
  const cues: DemoCue[] = [];
  let seq = 0;
  let endMs = 0;
  for (const thread of specs) {
    let at = thread.startMs;
    for (const step of thread.steps) {
      if (step.kind === "wait") {
        at += step.ms;
        continue;
      }
      if (step.kind === "juno") {
        cues.push({ seq: seq++, at, person: thread.person.id, type: "typing", on: true });
        at += step.typingMs;
        cues.push({ seq: seq++, at, person: thread.person.id, type: "agent", text: step.text });
        cues.push({ seq: seq++, at, person: thread.person.id, type: "typing", on: false });
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
  // 相对节奏不变，整体拉到约 42.5 秒，结尾留出阅读时间再出 Replay。
  const scale = 42_500 / Math.max(endMs, 1);
  for (const cue of cues) cue.at = Math.round(cue.at * scale);
  cues.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return { cues, endMs: cues.at(-1)?.at ?? 0 };
}

const compiled = compile(threads);

export const DEMO_PEOPLE: SimPerson[] = threads.map((thread) => thread.person);
export const DEMO_CUES: DemoCue[] = compiled.cues;
/** 最后一条消息之后留一点阅读时间，再出现 Replay。整段约 45 秒。 */
export const DEMO_DURATION_MS = Math.max(45_000, compiled.endMs + 1_400);
export const DEMO_END_MS = compiled.endMs;
