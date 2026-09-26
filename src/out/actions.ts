// 出站动作：flow 不直接发消息，只返回要发什么（消息、tapback、邮件）。
// 出站动作是纯数据，可以存起来晚点发；管线确认这一轮有效后，交给 io/outbox.ts 按顺序发。

import type { Delivery, Handle } from "../shared/types";
import type { EmailMessage } from "./email";

/** 一条消息里的一段。transport 负责换成各平台能显示的内容（链接卡片、confetti 特效）。 */
export type OutPart = string | { type: "link"; url: string } | { type: "celebrate"; text: string };

export const link = (url: string): OutPart => ({ type: "link", url });
export const celebrate = (text: string): OutPart => ({ type: "celebrate", text });

/** 纯文本：记进对话记录，也是发给 SMS / terminal 的内容（链接直接写网址，特效去掉）。 */
export function plainText(part: OutPart): string {
  if (typeof part === "string") return part;
  return part.type === "link" ? part.url : part.text;
}

/** 发给别人的消息失败时：告诉谁、怎么称呼收件人、怎么重试（比如 "invite Sam"）。 */
export interface FailureNotice {
  notify: Handle;
  name: string;
  retry?: string;
}

/** 方案通知：发完记一条送达记录。 */
export interface DeliveryTag {
  planId: string;
  kind: Delivery["kind"];
}

export interface SendAction {
  kind: "send";
  to: Handle;
  parts: OutPart[];
  /** summary：发出后记下消息 id，对它点 👍 算确认。 */
  track?: "summary";
  onFail?: FailureNotice;
  delivery?: DeliveryTag;
}

export interface ReactAction {
  kind: "react";
  to: Handle;
  messageId: string;
  emoji: string;
  /** 平台不支持 tapback 时改发这句话。 */
  fallback?: string;
}

export interface EmailAction {
  kind: "email";
  to: Handle;
  message: EmailMessage;
  onFail?: FailureNotice;
  delivery?: DeliveryTag;
}

export interface ScheduledAction {
  kind: "schedule";
  to: Handle;
  dueAt: string;
  action: SendAction;
}

export type Outbound = SendAction | ReactAction | EmailAction | ScheduledAction;

export function say(to: Handle, ...parts: OutPart[]): SendAction {
  return { kind: "send", to, parts };
}

/** 摘要：发出后记下消息 id，对它点 👍 就算确认。 */
export function summary(to: Handle, text: string): SendAction {
  return { kind: "send", to, parts: [text], track: "summary" };
}

/** 发给别人（不是这一轮说话的人）的消息：失败了告诉组织者。 */
export function tell(to: Handle, name: string, organizer: Handle, parts: OutPart[], extra: { retry?: string; delivery?: DeliveryTag } = {}): SendAction {
  return { kind: "send", to, parts, onFail: { notify: organizer, name, retry: extra.retry }, delivery: extra.delivery };
}

export function react(to: Handle, messageId: string, emoji: string, fallback?: string): ReactAction {
  return { kind: "react", to, messageId, emoji, fallback };
}

export function later(to: Handle, dueAt: Date, ...parts: OutPart[]): ScheduledAction {
  return { kind: "schedule", to, dueAt: dueAt.toISOString(), action: say(to, ...parts) };
}
