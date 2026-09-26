// 日历邀请（§5.7）。每人每个活动用固定 UID，更新时 SEQUENCE+1，日历里的原事件会被直接更新。

import { zonedToUtc } from "../core/time";
import type { LocalTime } from "../types";

export interface CalendarEvent {
  uid: string;
  sequence: number;
  /** 邮件里的邀请用 REQUEST；行程页下载用 PUBLISH。 */
  method: "REQUEST" | "PUBLISH";
  day: string;
  start: LocalTime;
  end: LocalTime;
  timezone: string;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  organizer?: { name: string; email: string };
  attendee?: { name: string; email: string };
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545：每行不超过 75 个字节，续行以一个空格开头。 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(event: CalendarEvent, now = new Date()): string {
  const start = zonedToUtc(event.day, event.start, event.timezone);
  let end = zonedToUtc(event.day, event.end, event.timezone);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Event Planner//Juno//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : undefined,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : undefined,
    event.url ? `URL:${event.url}` : undefined,
    event.method === "REQUEST" && event.organizer ? `ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}` : undefined,
    event.method === "REQUEST" && event.attendee
      ? `ATTENDEE;CN=${escapeText(event.attendee.name)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${event.attendee.email}`
      : undefined,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== undefined);

  return `${lines.map(fold).join("\r\n")}\r\n`;
}
