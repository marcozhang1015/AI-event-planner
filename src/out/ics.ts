// 日历邀请（§5.7）。每人每个活动用固定 UID，更新时 SEQUENCE+1，日历里的原事件会被直接更新。

import { createHash } from "node:crypto";
import { zonedToUtc } from "../shared/time";
import type { Event, Handle, LocalTime, Member } from "../shared/types";
import type { ItineraryView } from "../shared/views";
import { itineraryLines } from "./imessage";
import { memberUrl } from "./privacy";

/** 每人每场活动固定的 UID。handle 取哈希，不把号码写进日历数据。 */
export function calendarUid(eventId: string, handle: Handle): string {
  return `${eventId}-${createHash("sha256").update(handle).digest("hex").slice(0, 12)}@juno`;
}

/** 日历里的 ORGANIZER 是 agent 自己；URL 是本人的网页。 */
export interface CalendarSite {
  baseUrl: string;
  agentName: string;
  /** "Juno <juno@example.com>" */
  emailFrom: string;
}

export interface MemberCalendar {
  event: Event;
  member: Member;
  itinerary: ItineraryView;
  /** 邮件里的邀请用 REQUEST（带上收件人）；行程页下载用 PUBLISH。 */
  method: CalendarEvent["method"];
  /** 活动那天，YYYY-MM-DD。 */
  day: string;
}

/** 一个人这场活动的日历：从被接（或出发）到送到家。邮件邀请和行程页下载用同一个 UID，SEQUENCE = 发布次数 − 1。 */
export function memberCalendar(site: CalendarSite, { event, member, itinerary: it, method, day }: MemberCalendar, now = new Date()): string {
  return buildIcs(
    {
      uid: calendarUid(event.id, member.handle),
      sequence: Math.max(0, (event.publications ?? 1) - 1),
      method,
      day,
      start: it.pickup.at,
      end: it.dropoff.at,
      timezone: event.timezone,
      summary: event.title,
      location: it.activity.venue.name,
      description: itineraryLines(it).join("\n"),
      url: memberUrl(site.baseUrl, member),
      organizer: { name: site.agentName, email: emailAddress(site.emailFrom) },
      attendee: member.email ? { name: member.name, email: member.email } : undefined,
    },
    now,
  );
}

/** "Juno <juno@example.com>" → "juno@example.com"。 */
function emailAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}

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
