// 邮件（§5.7）：只在组织者批准后发。
// console driver 把邮件写成 data/outbox/*.eml，可以直接用"邮件"App 打开预览。真实服务商 Day-0 定了再加。

import { mkdirSync } from "node:fs";
import { config } from "../config";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** buildIcs() 的输出，作为 method=REQUEST 的日历邀请附上。 */
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

export function createEmailSender(): EmailSender {
  if (config.emailDriver === "console") return new OutboxSender(config.outboxDir, config.emailFrom);
  throw new Error(`EMAIL_DRIVER=${config.emailDriver} 还没接：Day-0 选定服务商后在 src/out/email.ts 里加`);
}
