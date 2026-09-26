// 测试用：不经过 Spectrum，直接把一轮消息交给 flow，模拟管线的提交和发送回调。

import { offlineBrain, type Brain } from "../src/brain/extract";
import { Store } from "../src/db";
import { ChangeSet } from "../src/flows/changes";
import type { Contact, Incoming, Outbound } from "../src/flows/context";
import { handleTurn } from "../src/flows/router";
import { SampleMaps } from "../src/maps/sample";
import type { OutPart } from "../src/out/imessage";

export const CONTACTS: Contact[] = [
  { name: "Alex", handle: "+15550000001" },
  { name: "Sam", handle: "+15550000002" },
  { name: "Priya", handle: "+15550000003" },
  { name: "Leo", handle: "+15550000004" },
  { name: "Mia", handle: "term:mia" },
];

export const ALEX = "+15550000001";
export const SAM = "+15550000002";

type Item = string | Omit<Incoming, "id">;

export class Harness {
  readonly store = new Store(":memory:");
  /** 2026-09-24 是周四；"saturday" 应该解析成 2026-09-26。 */
  now = new Date("2026-09-24T15:00:00Z");
  /** 每个人最后收到的一批消息 id（点 tapback 用）。 */
  readonly lastSent = new Map<string, string[]>();
  private seq = 0;

  constructor(private readonly brain: Brain = offlineBrain) {}

  async send(handle: string, ...items: Item[]): Promise<Outbound[]> {
    const incoming: Incoming[] = items.map((item) => ({ id: `in_${++this.seq}`, ...(typeof item === "string" ? { kind: "text" as const, text: item } : item) }));
    const db = new ChangeSet(this.store);
    const outbox = await handleTurn(
      { db, brain: this.brain, maps: new SampleMaps(), now: this.now, timezone: "America/Chicago", baseUrl: "https://juno.test", agentName: "Juno", contacts: CONTACTS },
      { handle, incoming },
    );
    db.commit();
    for (const action of outbox) {
      if (action.kind !== "send") continue;
      const ids = action.parts.map(() => `out_${++this.seq}`);
      this.lastSent.set(action.to, ids);
      action.onSent?.(ids);
    }
    return outbox;
  }

  /** 对某人最后收到的那条消息点 tapback。 */
  tapback(handle: string, emoji = "👍"): Item {
    const target = this.lastSent.get(handle)?.at(-1);
    return { kind: "reaction", text: emoji, targetId: target };
  }
}

export function plain(part: OutPart): string {
  if (typeof part === "string") return part;
  return part.type === "link" ? part.url : part.text;
}

/** 发给某人的所有文字。 */
export function textsTo(outbox: Outbound[], to: string): string[] {
  return outbox.flatMap((action) => (action.kind === "send" && action.to === to ? action.parts.map(plain) : []));
}
