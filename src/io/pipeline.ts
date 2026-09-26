// 消息管线（§5.3）：过滤 → 去重 → debounce → 处理（typing）→ 提交 → 交给 outbox 发送。
// - 处理期间同一个人又发来新消息：这一轮的改动和回复全部丢掉，合并后重跑。
// - 提交时发现别的回合先改了同一行（StaleWriteError）：用新数据重跑这一轮，最多 MAX_ATTEMPTS 次。
// - 启动时补处理重启前没处理完的消息，并定时发出夜间免打扰期间存起来的消息。

import type { Message, Space } from "spectrum-ts";
import type { Incoming, Turn } from "../flows/context";
import { say, type Outbound } from "../out/actions";
import type { EmailSender } from "../out/email";
import { templates as t } from "../out/imessage";
import type { QuietHours } from "../shared/time";
import type { Handle, MessageLog } from "../shared/types";
import { ChangeSet, StaleWriteError } from "../store/changes";
import type { Store } from "../store/db";
import { messageLogger, type MessageLogger } from "./log";
import { Outbox } from "./outbox";
import type { TransportLike } from "./transport";

export interface PipelineOptions {
  store: Store;
  transport: TransportLike;
  email: EmailSender;
  handle: (db: ChangeSet, turn: Turn) => Promise<Outbound[]>;
  debounceMs: number;
  paceMs: number;
  timezone: string;
  quietHours?: QuietHours;
  logMessages?: boolean;
  now?: () => Date;
  /** 检查定时消息的间隔。 */
  tickMs?: number;
}

const MAX_ATTEMPTS = 3;
const TICK_MS = 500;

/** 只留下用户输入；已读回执、typing、群事件、附件等 hackathon 版不处理。 */
function toLog(handle: Handle, message: Message): MessageLog | undefined {
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

export class Pipeline {
  readonly outbox: Outbox;
  private readonly timers = new Map<Handle, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Handle>();
  private readonly generation = new Map<Handle, number>();
  /** 正在跑的回合：stop() 和 drain() 要等它们结束。 */
  private readonly inflight = new Set<Promise<void>>();
  private readonly now: () => Date;
  private readonly log: MessageLogger;
  private ticker?: ReturnType<typeof setInterval>;

  constructor(private readonly options: PipelineOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = messageLogger(options.logMessages ?? false);
    this.outbox = new Outbox({
      store: options.store,
      transport: options.transport,
      email: options.email,
      paceMs: options.paceMs,
      timezone: options.timezone,
      quietHours: options.quietHours,
      now: this.now,
      log: this.log,
    });
  }

  /** 补处理重启前没处理完的消息，开始定时发送。 */
  start(): void {
    for (const handle of this.options.store.pendingHandles()) this.schedule(handle);
    this.ticker = setInterval(() => void this.outbox.flushDue(), this.options.tickMs ?? TICK_MS);
  }

  /** 不再开始新的回合，等正在跑的收尾。没处理的消息留在待处理表里，下次启动时补处理。 */
  async stop(): Promise<void> {
    clearInterval(this.ticker);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.inflight);
  }

  /** 不等 debounce，立刻处理所有排着的回合，直到没有剩下的（测试和脚本用）。 */
  async drain(): Promise<void> {
    while (this.timers.size || this.inflight.size) {
      for (const [handle, timer] of this.timers) {
        clearTimeout(timer);
        this.timers.delete(handle);
        this.run(handle);
      }
      await Promise.all(this.inflight);
    }
  }

  enqueue(space: Space, message: Message): void {
    if (message.direction === "outbound") return;
    const sender = this.options.transport.identify(space, message);
    const log = sender ? toLog(sender.handle, message) : undefined;
    if (!sender || !log) return;
    // Spectrum 至少投递一次：同一个 id 只处理一次
    if (!this.options.store.insertInbound(log)) return;

    this.options.transport.remember(sender, space, message);
    this.log("in", sender.handle, log.kind === "text" ? log.text : `[${log.kind}] ${log.text}`);
    this.generation.set(sender.handle, (this.generation.get(sender.handle) ?? 0) + 1);
    this.schedule(sender.handle);
  }

  private schedule(handle: Handle): void {
    clearTimeout(this.timers.get(handle));
    this.timers.set(
      handle,
      setTimeout(() => {
        this.timers.delete(handle);
        this.run(handle);
      }, this.options.debounceMs),
    );
  }

  private run(handle: Handle): void {
    const turn = this.flush(handle);
    this.inflight.add(turn);
    void turn.finally(() => this.inflight.delete(turn));
  }

  /** 处理这个人所有待处理的消息。正常由 debounce 触发；测试里可以直接调用。 */
  async flush(handle: Handle): Promise<void> {
    if (this.running.has(handle)) return; // 正在处理；结束时会检查有没有新消息
    const pending = this.options.store.pendingFor(handle);
    if (!pending.length) return;

    this.running.add(handle);
    const generation = this.generation.get(handle) ?? 0;
    const ids = pending.map((message) => message.id);
    const turn: Turn = { handle, incoming: pending.map(toIncoming) };
    await this.typing(handle, true);
    try {
      const outbox = await this.attempt(turn, ids, generation);
      if (outbox) await this.outbox.deliver(outbox, handle);
    } catch (error) {
      console.error(`[pipeline] ${handle} 这一轮出错`, error);
      this.options.store.markHandled(ids, this.now().toISOString());
      await this.outbox.deliver([say(handle, t.sorry())], handle);
    } finally {
      await this.typing(handle, false);
      this.running.delete(handle);
      if (this.options.store.pendingFor(handle).length) this.schedule(handle);
    }
  }

  /**
   * 跑一轮并提交（数据改动和"消息已处理"在同一个事务里）。
   * 处理期间来了新消息返回 undefined：消息留在待处理表里，下一轮一起处理。
   */
  private async attempt(turn: Turn, ids: string[], generation: number): Promise<Outbound[] | undefined> {
    for (let attempt = 1; ; attempt++) {
      const db = new ChangeSet(this.options.store);
      const outbox = await this.options.handle(db, turn);
      if ((this.generation.get(turn.handle) ?? 0) !== generation) return undefined;
      try {
        db.commit(() => this.options.store.markHandled(ids, this.now().toISOString()));
        return outbox;
      } catch (error) {
        if (!(error instanceof StaleWriteError) || attempt >= MAX_ATTEMPTS) throw error;
        console.warn(`[pipeline] ${turn.handle} 的这一轮和别人同时改了 ${error.row}，用新数据重跑（第 ${attempt + 1} 次）`);
      }
    }
  }

  /** typing 只是锦上添花：出错只记日志，不影响这一轮。 */
  private async typing(handle: Handle, on: boolean): Promise<void> {
    try {
      await this.options.transport.typing(handle, on);
    } catch (error) {
      console.warn(`[pipeline] ${handle} 的 typing ${on ? "开" : "关"}失败`, error instanceof Error ? error.message : error);
    }
  }
}
