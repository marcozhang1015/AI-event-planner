// 消息管线（§5.3）：过滤 → 去重 → debounce → 处理（typing）→ 提交 → 按节奏发送。
// 处理期间同一个人又发来新消息：这一轮的改动和回复全部丢掉，合并后重跑。

import type { Message, Space } from "spectrum-ts";
import type { Store } from "../db";
import { ChangeSet } from "../flows/changes";
import type { Incoming, Outbound, Turn } from "../flows/context";
import type { OutPart } from "../out/imessage";
import type { Handle, MessageLog } from "../types";
import { toContent, type TransportLike } from "./transport";

export interface PipelineOptions {
  store: Store;
  transport: TransportLike;
  handle: (db: ChangeSet, turn: Turn) => Promise<Outbound[]>;
  debounceMs: number;
  paceMs: number;
  now?: () => Date;
}

/** 只留下用户输入；已读回执、typing、群事件、附件等 hackathon 版不处理。 */
export function toLog(handle: Handle, message: Message): MessageLog | undefined {
  const base = { id: message.id, handle, direction: "inbound" as const, at: message.timestamp.toISOString() };
  const content = message.content.type === "reply" ? message.content.content : message.content;
  switch (content.type) {
    case "text":
      return { ...base, kind: "text", text: content.text };
    case "reaction":
      return { ...base, kind: "reaction", text: content.emoji, targetId: content.target.id };
    case "contact": {
      const name = content.name?.formatted ?? [content.name?.first, content.name?.last].filter(Boolean).join(" ");
      return { ...base, kind: "contact", text: name, contactName: name || undefined, phones: content.phones?.map((phone) => phone.value) ?? [] };
    }
    default:
      return undefined;
  }
}

function toIncoming(log: MessageLog): Incoming {
  return { id: log.id, kind: log.kind, text: log.text, targetId: log.targetId, contactName: log.contactName, phones: log.phones };
}

/** 记进对话记录的纯文本。 */
function plainText(part: OutPart): string {
  if (typeof part === "string") return part;
  return part.type === "link" ? part.url : part.text;
}

export class Pipeline {
  private readonly timers = new Map<Handle, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Handle>();
  private readonly generation = new Map<Handle, number>();
  /** 本轮还没处理完的原始消息：点 tapback 要用到。 */
  private readonly live = new Map<string, Message>();
  private readonly now: () => Date;

  constructor(private readonly options: PipelineOptions) {
    this.now = options.now ?? (() => new Date());
  }

  enqueue(space: Space, message: Message): void {
    if (message.direction === "outbound") return;
    const handle = this.options.transport.handleOf(space, message);
    const log = handle ? toLog(handle, message) : undefined;
    if (!handle || !log) return;
    // Spectrum 至少投递一次：同一个 id 只处理一次
    if (!this.options.store.insertInbound(log)) return;

    this.options.transport.remember(handle, space);
    this.live.set(message.id, message);
    this.generation.set(handle, (this.generation.get(handle) ?? 0) + 1);
    this.schedule(handle);
  }

  private schedule(handle: Handle): void {
    clearTimeout(this.timers.get(handle));
    this.timers.set(handle, setTimeout(() => void this.flush(handle), this.options.debounceMs));
  }

  /** 处理这个人所有待处理的消息。正常由 debounce 触发；测试里可以直接调用。 */
  async flush(handle: Handle): Promise<void> {
    if (this.running.has(handle)) return; // 正在处理；结束时会检查有没有新消息
    const pending = this.options.store.pendingFor(handle);
    if (!pending.length) return;

    this.running.add(handle);
    const generation = this.generation.get(handle) ?? 0;
    const ids = pending.map((message) => message.id);
    let finished = false;
    try {
      const db = new ChangeSet(this.options.store);
      const turn: Turn = { handle, incoming: pending.map(toIncoming) };
      const space = await this.options.transport.spaceFor(handle);
      const run = () => this.options.handle(db, turn);
      const outbox = space ? await space.responding(run) : await run();
      // 处理期间又来了新消息：这一轮作废，消息留在待处理表里，下一轮一起处理
      if ((this.generation.get(handle) ?? 0) !== generation) return;

      db.commit();
      this.options.store.markHandled(ids, this.now().toISOString());
      finished = true;
      await this.deliver(outbox);
    } catch (error) {
      console.error(`[pipeline] ${handle} 这一轮出错`, error);
      if (!finished) {
        this.options.store.markHandled(ids, this.now().toISOString());
        finished = true;
        await this.deliver([{ kind: "send", to: handle, parts: ["Sorry — something went wrong on my end. Could you say that again?"] }]);
      }
    } finally {
      this.running.delete(handle);
      if (finished) for (const message of pending) this.live.delete(message.id);
      if (this.options.store.pendingFor(handle).length) this.schedule(handle);
    }
  }

  private async deliver(outbox: Outbound[]): Promise<void> {
    for (const action of outbox) {
      try {
        if (action.kind === "react") {
          await this.live.get(action.messageId)?.react(action.emoji);
          continue;
        }
        const space = await this.options.transport.spaceFor(action.to);
        if (!space) {
          console.warn(`[send] 找不到 ${action.to} 的会话，跳过`);
          continue;
        }
        const sentIds: string[] = [];
        for (const [index, part] of action.parts.entries()) {
          if (index > 0) await Bun.sleep(this.options.paceMs);
          const sent = await space.send(toContent(part, space.__platform));
          if (sent) sentIds.push(sent.id);
          this.options.store.logOutbound({
            id: sent?.id ?? `out_${crypto.randomUUID()}`,
            handle: action.to,
            direction: "outbound",
            kind: "text",
            text: plainText(part),
            at: this.now().toISOString(),
          });
        }
        action.onSent?.(sentIds);
      } catch (error) {
        // TODO(B, M2)：告诉组织者谁没收到（§5.12）
        console.error(`[send] 发给 ${action.to} 失败`, error);
      }
    }
  }
}
