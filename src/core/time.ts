import type { LocalTime, TimeWindow } from "../types";

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** 某个时区里"今天"的日期，YYYY-MM-DD。 */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function weekdayName(day: string): string {
  const name = WEEKDAYS[weekdayOf(day)] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function toMinutes(time: LocalTime): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(total: number): LocalTime {
  const clamped = Math.max(0, Math.min(total, 24 * 60 - 1));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "15:00" → "3 PM"；"15:30" → "3:30 PM"。 */
export function fmtTime(time: LocalTime): string {
  const total = toMinutes(time);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${h12} ${suffix}` : `${h12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** { 14:00, 22:00 } → "2–10 PM"；跨上下午时两头都带 AM/PM。 */
export function fmtWindow(window: TimeWindow): string {
  const start = fmtTime(window.start);
  const end = fmtTime(window.end);
  const sameSuffix = start.slice(-2) === end.slice(-2);
  return sameSuffix ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
}

export function fmtMoney(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** 某一时刻在某个时区相对 UTC 的偏移（分钟）。 */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** 活动时区的本地日期 + 时刻 → UTC 时间。hackathon 版不处理夏令时切换当天的边界。 */
export function zonedToUtc(day: string, time: LocalTime, timeZone: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, date, hours, minutes);
  return new Date(guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000);
}
