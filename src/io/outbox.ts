// 出站：按顺序执行 flow 返回的动作（消息、tapback、邮件）。
// - 发给别人（不是这一轮说话的人）的消息，碰到夜间免打扰就存起来，到点再发；
// - 发给别人失败的，合成一条消息告诉组织者；
// - 方案通知写送达记录。

import { plainText, say, type EmailAction, type FailureNotice, type Outbound, type ReactAction, type SendAction } from "../out/actions";
import type { EmailSender } from "../out/email";
import { templates as t } from "../out/imessage";
import { quietUntil, type QuietHours } from "../shared/time";
import type { Handle } from "../shared/types";
import { newId, type Store } from "../store/db";
import type { MessageLogger } from "./log";
import type { TransportLike } from "./transport";

export interface OutboxOptions {
  store: Store;
  transport: TransportLike;
  email: EmailSender;
  paceMs: number;
  timezone: string;
  quietHours?: QuietHours;
  now: () => Date;
  log: MessageLogger;
}

type Message = SendAction | EmailAction;

export class Outbox {
  private flushing = false;

  constructor(private readonly options: OutboxOptions) {}

  /** `sender`：这一轮说话的人，发给他的消息随时发。定时发送时不传。 */
  async deliver(actions: Outbound[], sender?: Handle): Promise<void> {
    const { now, timezone, quietHours } = this.options;
    const quiet = sender === undefined ? undefined : quietUntil(now(), timezone, quietHours);
    const failures = new Map<Handle, FailureNotice[]>();
    for (const action of actions) {
      if (action.kind === "react") {
        await this.react(action);
        continue;
      }
      if (quiet && action.to !== sender) {
        this.defer(action, quiet);
        continue;
      }
      const error = await this.dispatch(action);
      if (action.delivery) this.record(action, error);
      const notice = action.onFail;
      if (error && notice && notice.notify !== action.to) failures.set(notice.notify, [...(failures.get(notice.notify) ?? []), notice]);
    }
    for (const [notify, notices] of failures) await this.dispatch(say(notify, t.deliveryFailed(notices)));
  }

  /** 定时器调用：发出到点了的消息（取出即删除，最多发一次）。 */
  async flushDue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const due = this.options.store.takeDue<Message>(this.options.now().toISOString());
      if (due.length) await this.deliver(due.map((entry) => entry.item));
    } finally {
      this.flushing = false;
    }
  }

  private defer(action: Message, until: Date): void {
    this.options.store.schedule({ id: newId("later"), handle: action.to, dueAt: until.toISOString(), item: action });
    this.options.log("later", action.to, `${until.toISOString()} ${action.kind === "email" ? action.message.subject : action.parts.map(plainText).join(" ")}`);
  }

  /** 发一个动作；失败时返回错误信息（不抛出），由调用方决定告诉谁。 */
  private async dispatch(action: Message): Promise<string | undefined> {
    try {
      if (action.kind === "email") {
        await this.options.email.send(action.message);
        this.options.log("out", action.to, `✉ ${action.message.subject}`);
      } else {
        await this.sendParts(action);
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[send] 发给 ${action.to} 失败：${message}`);
      return message;
    }
  }

  /** 一条消息的几段之间隔 paceMs，像人一样一条条发。 */
  private async sendParts(action: SendAction): Promise<void> {
    const { store, transport, paceMs, now, log } = this.options;
    for (const [index, part] of action.parts.entries()) {
      if (index > 0) await Bun.sleep(paceMs);
      const id = await transport.send(action.to, part);
      const text = plainText(part);
      store.logOutbound({ id: id ?? newId("out"), handle: action.to, direction: "outbound", kind: "text", text, at: now().toISOString() });
      log("out", action.to, text);
      if (index === 0 && id && action.track === "summary") store.setSummaryMessageId(action.to, id);
    }
  }

  private record(action: Message, error: string | undefined): void {
    const { planId, kind } = action.delivery!;
    const channel = action.kind === "email" ? "email" : "imessage";
    this.options.store.saveDelivery({ planId, handle: action.to, channel, kind, ...(error ? { error } : { sentAt: this.options.now().toISOString() }) });
  }

  private async react(action: ReactAction): Promise<void> {
    try {
      await this.options.transport.react(action.messageId, action.emoji);
    } catch (error) {
      console.warn(`[send] 给 ${action.to} 点 tapback 失败`, error);
    }
  }
}
