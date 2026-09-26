// 测试用：
// - Harness：不经过 Spectrum，直接把一轮消息交给 flow，模拟管线的提交、摘要 id 记录和邮件发送；
// - FakeTransport：管线和 outbox 测试用的假 transport。

import type { Message, Space } from "spectrum-ts";
import { offlineBrain, type Brain } from "../src/brain/extract";
import type { Contact } from "../src/core/handle";
import type { FlowDeps, Incoming } from "../src/flows/context";
import { handleTurn } from "../src/flows/router";
import { identifySender, type TransportLike } from "../src/io/transport";
import type { Maps } from "../src/maps";
import { SampleMaps } from "../src/maps/sample";
import { plainText, type Outbound, type OutPart } from "../src/out/actions";
import type { EmailMessage } from "../src/out/email";
import type { ViewOptions } from "../src/out/privacy";
import type { QuietHours } from "../src/shared/time";
import type { Handle } from "../src/shared/types";
import { ChangeSet } from "../src/store/changes";
import { Store } from "../src/store/db";

export const CONTACTS: Contact[] = [
  { name: "Alex", handle: "+15550000001" },
  { name: "Sam", handle: "+15550000002" },
  { name: "Priya", handle: "+15550000003" },
  { name: "Leo", handle: "+15550000004" },
  { name: "Mia", handle: "term:mia" },
];

export const ALEX = "+15550000001";
export const SAM = "+15550000002";
export const PRIYA = "+15550000003";
export const LEO = "+15550000004";
export const MIA = "term:mia";

export const VIEWS: ViewOptions = { baseUrl: "https://juno.test", mapImages: false };

type Item = string | Omit<Incoming, "id">;

export interface HarnessOptions {
  brain?: Brain;
  maps?: Maps;
  contacts?: Contact[];
  quietHours?: QuietHours;
}

export class Harness {
  readonly store = new Store(":memory:");
  /** 2026-09-24 是周四（芝加哥上午 10 点）；"saturday" 应该解析成 2026-09-26。 */
  now = new Date("2026-09-24T15:00:00Z");
  /** 每个人最后收到的一批消息 id（点 tapback 用）。 */
  readonly lastSent = new Map<string, string[]>();
  /** 所有发出去的邮件。 */
  readonly emails: EmailMessage[] = [];
  /** 所有轮次的出站动作，按顺序。 */
  readonly log: Outbound[] = [];
  private seq = 0;

  constructor(private readonly options: HarnessOptions = {}) {}

  deps(db: ChangeSet): FlowDeps {
    return {
      db,
      brain: this.options.brain ?? offlineBrain,
      maps: this.options.maps ?? new SampleMaps(),
      now: this.now,
      timezone: "America/Chicago",
      baseUrl: VIEWS.baseUrl,
      agentName: "Juno",
      contacts: this.options.contacts ?? CONTACTS,
      quietHours: this.options.quietHours,
      emailFrom: "Juno <juno@example.com>",
      mapImages: false,
    };
  }

  /** 只读快照（网页 API 也这样读）。 */
  reader(): ChangeSet {
    return new ChangeSet(this.store);
  }

  async send(handle: string, ...items: Item[]): Promise<Outbound[]> {
    const incoming: Incoming[] = items.map((item) => ({ id: `in_${++this.seq}`, ...(typeof item === "string" ? { kind: "text" as const, text: item } : item) }));
    const db = new ChangeSet(this.store);
    const outbox = await handleTurn(this.deps(db), { handle, incoming });
    db.commit();
    this.log.push(...outbox);
    for (const action of outbox) {
      if (action.kind === "email") this.emails.push(action.message);
      if (action.kind !== "send") continue;
      const ids = action.parts.map(() => `out_${++this.seq}`);
      this.lastSent.set(action.to, ids);
      if (action.track === "summary" && ids[0]) this.store.setSummaryMessageId(action.to, ids[0]);
    }
    return outbox;
  }

  /** 对某人最后收到的那条消息点 tapback。 */
  tapback(handle: string, emoji = "👍"): Item {
    const target = this.lastSent.get(handle)?.at(-1);
    return { kind: "reaction", text: emoji, targetId: target };
  }

  event() {
    const [event] = this.store.listEvents();
    if (!event) throw new Error("no event yet");
    return event;
  }
}

/** 发给某人的所有文字。 */
export function textsTo(outbox: Outbound[], to: string): string[] {
  return outbox.flatMap((action) => (action.kind === "send" && action.to === to ? action.parts.map(plainText) : []));
}

/** 这批动作里收到消息的人（不含 tapback）。 */
export function recipients(outbox: Outbound[]): string[] {
  return [...new Set(outbox.flatMap((action) => (action.kind === "react" ? [] : [action.to])))];
}

/** 组织者发起 → 定时间 → 👍 确认 → 给名单（"I'm in too and can drive 2"）。 */
export async function setUpEvent(h: Harness, invite = "sam, priya, leo, mia. I'm in too and can drive 2"): Promise<Outbound[]> {
  await h.send(ALEX, "can you plan a hike + dinner this saturday near campus? 5 of us, max $40 each");
  await h.send(ALEX, "2-10");
  await h.send(ALEX, h.tapback(ALEX));
  return h.send(ALEX, invite);
}

/** 按顺序替某人回答一串消息，返回最后一轮的出站动作。 */
export async function answer(h: Harness, handle: string, ...texts: string[]): Promise<Outbound[]> {
  let last: Outbound[] = [];
  for (const text of texts) last = await h.send(handle, text);
  return last;
}

/** 记下发出去的每一段；`failing` 里的人发送失败（像没登记的号码），`typingFails` 让 typing 报错。 */
export class FakeTransport implements TransportLike {
  readonly sent: { to: Handle; part: OutPart }[] = [];
  readonly failing = new Set<Handle>();
  typingFails = false;

  identify(space: Space, message: Message) {
    return identifySender(space, message);
  }

  remember() {}

  async send(handle: Handle, part: OutPart) {
    if (this.failing.has(handle)) throw new Error("Target not allowed for this project");
    this.sent.push({ to: handle, part });
    return `sent_${this.sent.length}`;
  }

  async react() {}

  async typing() {
    if (this.typingFails) throw new Error("typing failed");
  }

  textsTo(handle: Handle): string[] {
    return this.sent.filter((sent) => sent.to === handle).map((sent) => plainText(sent.part));
  }
}
