// 邮件（§5.7）：只在组织者批准后发，变更时只发给受影响的人。
// console driver 把邮件写成 data/outbox/*.eml，可以直接用"邮件"App 打开预览。真实服务商 Day-0 定了再加一个 EmailSender。

import { mkdirSync } from "node:fs";
import type { ItineraryView } from "../shared/views";
import { escapeHtml } from "./html";
import { itineraryLines } from "./imessage";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** memberCalendar() 的输出，作为 method=REQUEST 的日历邀请附上。 */
  calendar?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function buildEml(from: string, message: EmailMessage, date = new Date()): string {
  const mixed = `mixed_${crypto.randomUUID()}`;
  const alternative = `alt_${crypto.randomUUID()}`;
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    `--${alternative}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    `--${alternative}--`,
  ];
  if (message.calendar) {
    lines.push(
      `--${mixed}`,
      "Content-Type: text/calendar; charset=utf-8; method=REQUEST",
      'Content-Disposition: attachment; filename="invite.ics"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.calendar,
    );
  }
  lines.push(`--${mixed}--`, "");
  return lines.join("\r\n");
}

export interface PlanEmailInput {
  to: string;
  name: string;
  title: string;
  dayName: string;
  itinerary: ItineraryView;
  /** 行程页链接。 */
  url: string;
  mode: "final" | "update";
  /** 静态地图（有地图 key 时）。 */
  mapImageUrl?: string;
  calendar: string;
}

/** 个性化邮件：和 iMessage 一样的要点、行程页链接、静态地图，附日历邀请。 */
export function planEmail(input: PlanEmailInput): EmailMessage {
  const { itinerary: it, mode } = input;
  const lines = itineraryLines(it).map((line) => line.replace(/^• /, ""));
  const intro = mode === "update" ? `Update for ${input.dayName} — ${it.changes.join("; ") || "your plan changed"}.` : `You're all set for ${input.dayName}.`;
  const text = [`Hi ${input.name},`, "", intro, "", ...lines.map((line) => `- ${line}`), "", `Map and details: ${input.url}`, "", "The calendar invite is attached."].join("\n");
  const html = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1c1c1e">`,
    `<p>Hi ${escapeHtml(input.name)},</p>`,
    `<p><strong>${escapeHtml(intro)}</strong></p>`,
    `<ul style="padding-left:1.1rem;line-height:1.6">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    input.mapImageUrl ? `<p><img src="${escapeHtml(input.mapImageUrl)}" alt="Map of your route" width="560" style="max-width:100%;border-radius:12px"></p>` : "",
    `<p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0a84ff;color:#fff;text-decoration:none">Map and details</a></p>`,
    `<p style="color:#6e6e73;font-size:13px">The calendar invite is attached.</p>`,
    `</div>`,
  ].join("");
  const subject = mode === "update" ? `Updated: ${input.dayName} ${input.title}` : `${input.dayName}: ${input.title} — your plan`;
  return { to: input.to, subject, text, html, calendar: input.calendar };
}

class OutboxSender implements EmailSender {
  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async send(message: EmailMessage): Promise<void> {
    const file = `${this.dir}/${Date.now()}-${message.to.replace(/[^a-z0-9@.]/gi, "_")}.eml`;
    await Bun.write(file, buildEml(this.from, message));
    console.log(`[email] ${message.to} → ${file}`);
  }
}

export function createEmailSender(driver: string, outboxDir: string, from: string): EmailSender {
  if (driver === "console") return new OutboxSender(outboxDir, from);
  throw new Error(`EMAIL_DRIVER=${driver} 还没接：Day-0 选定服务商后在 src/out/email.ts 里加一个 EmailSender`);
}
