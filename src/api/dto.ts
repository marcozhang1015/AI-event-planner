// 网页 API 的返回结构。只有类型，web/ 也直接引用这个文件。A 和 B 一起维护。

import type { Drives, EventStatus, LocalTime, MemberStatus, Role, TimeWindow } from "../types";

export interface PublicEvent {
  title: string;
  status: EventStatus;
  day?: string;
  dayName?: string;
  window?: TimeWindow;
  area?: string;
  budgetCapCents?: number;
  timezone: string;
  inputVersion: number;
}

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "pickup" | "activity" | "restaurant";
}

export interface OrganizerView {
  role: "organizer";
  event: PublicEvent;
  organizerName: string;
  /** 只有名字、状态和公共集合点；没有预算数字、过敏细节或住址。 */
  members: { name: string; role: Role; status: MemberStatus; pickup?: string }[];
  counts: { total: number; confirmed: number; waiting: number };
  /** 聚合信息：不带名字。 */
  aggregates: { allergies: string[]; drivers: number; seats: number; needRides: number };
  pins: MapPin[];
}

export interface PublicAnswer {
  free?: TimeWindow[];
  homeBy?: LocalTime;
  budgetCapCents?: number;
  allergies?: string[];
  diet?: string[];
  drives?: Drives;
  seats?: number;
  pickup?: string;
  confirmed: boolean;
}

export interface AttendeeView {
  role: "attendee";
  event: PublicEvent;
  organizerName: string;
  me: { name: string; status: MemberStatus; hasEmail: boolean; answer: PublicAnswer };
  pins: MapPin[];
}
