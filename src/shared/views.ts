// 隐私投影之后的视图：网页 API 返回它，iMessage 模板、邮件、日历也从它生成。只有类型。A 和 B 一起维护。
// 所有视图都由 out/privacy.ts 生成：组织者看不到预算数字、住址和谁过敏；参与者只看到自己和同车人。

import type { Drives, EventStatus, ExclusionReason, LocalTime, MemberStatus, OptionStatus, PlanStatus, Role, TimeWindow } from "./types";

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

/** 方案里的一个人。`me`：就是正在看这个页面（或收到这条消息）的人。 */
export interface PersonRef {
  name: string;
  me?: boolean;
}

export interface PlaceRef {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface VenueRef extends PlaceRef {
  kind: "activity" | "restaurant";
  priceMinCents?: number;
  priceMaxCents?: number;
  phone?: string;
  hours?: string;
}

/** 接人或送人的一站。 */
export interface TimedStop {
  at: LocalTime;
  person: PersonRef;
  place: PlaceRef;
}

export interface RideView {
  driver: PersonRef;
  passengers: PersonRef[];
  /** 第一站是司机出发。 */
  pickups: TimedStop[];
  /** 最后一站是司机到家。 */
  dropoffs: TimedStop[];
  detourMinutes: number;
}

export interface VisitView {
  venue: VenueRef;
  start: LocalTime;
  end: LocalTime;
}

/** 待核实项：只说哪家店、什么过敏，不说是谁。 */
export interface UnknownView {
  venue: string;
  phone?: string;
  /** 过敏的叫法，比如 "peanut"、"tree nut"。 */
  fact: string;
  severe: boolean;
}

export interface OptionView {
  label: string;
  status: OptionStatus;
  attendees: PersonRef[];
  /** 被排除的人和原因类别（不含具体数字）。 */
  excluded: { person: PersonRef; reason: ExclusionReason }[];
  activity: VisitView;
  dinner: VisitView;
  rides: RideView[];
  /** 最早的接人时间、最晚的送到家时间。 */
  firstPickup: LocalTime;
  lastDropoff: LocalTime;
  costMaxCents: number;
  unknowns: UnknownView[];
  /** 这个选项要用到的 if_needed 司机，还在等他们答复。 */
  waitingOn: PersonRef[];
}

export interface PlanView {
  id: string;
  /** 方案基于的输入版本号（看板上显示 v3）。 */
  version: number;
  status: PlanStatus;
  options: OptionView[];
  conflicts: string[];
  /**
   * draft：还没发布的方案，等组织者 approve；
   * live：当前生效的方案；
   * update：发布后提出的修改，批准前旧方案继续有效。
   */
  state: "draft" | "live" | "update";
  /** 已发布的是哪个选项（state 是 live 时）。 */
  publishedLabel?: string;
  /** state 是 update 时：和已发布版本相比改了什么、影响到谁、谁不受影响。 */
  changes?: string[];
  affected?: PersonRef[];
  unaffected?: PersonRef[];
}

/** 一个人自己的行程（参与者的行程页、组织者参加时的看板）。 */
export interface ItineraryView {
  role: "driver" | "rider";
  driver: PersonRef;
  /** 同车的人（不含自己）和他们的上车点。 */
  carmates: { person: PersonRef; place: PlaceRef }[];
  /** 乘客：几点在哪被接；司机：几点从哪出发。 */
  pickup: TimedStop;
  /** 司机的接人路线（第一站是自己出发）；乘客为空。 */
  route: TimedStop[];
  /** 司机的送人路线（从餐厅出发依次送人，最后一站是自己到家）；乘客为空。 */
  returnRoute: TimedStop[];
  activity: VisitView;
  /** `note`：组织者核实过餐厅能处理本人的过敏。 */
  dinner: VisitView & { note?: string };
  /** 送到家（乘客回到上车点、司机到家）。 */
  dropoff: TimedStop;
  costMaxCents: number;
  /** 这是第几次发布（1 起）。 */
  version: number;
  /** 和上一次发布相比，本人的安排改了什么；没改是空数组。 */
  changes: string[];
  calendarUrl: string;
}

export interface OrganizerView {
  role: "organizer";
  event: PublicEvent;
  organizerName: string;
  /** 只有名字、状态、公共集合点和通知有没有送到；没有预算数字、过敏细节或住址。 */
  members: {
    name: string;
    role: Role;
    status: MemberStatus;
    /** 参不参加这次活动：受邀的人没谢绝就是参加；组织者说了自己也去才算。 */
    attending: boolean;
    pickup?: string;
    delivery?: "sent" | "failed" | "scheduled";
  }[];
  /** 参与的人（受邀的人 + 报名参加的组织者）。 */
  counts: { total: number; confirmed: number; waiting: number };
  /** 聚合信息：不带名字。 */
  aggregates: { allergies: string[]; drivers: number; seats: number; needRides: number };
  pins: MapPin[];
  /** 最新一版方案（还没求解过就没有）。 */
  plan?: PlanView;
  /** 组织者参加、方案已发布时，他自己的行程。 */
  me?: ItineraryView;
  /** 服务端代理的静态地图；没配地图 key 时没有，网页画示意图。 */
  mapImage?: string;
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
  /** 方案发布后本人的行程。 */
  itinerary?: ItineraryView;
  /** 方案发布了，但本人这次被排除：原因类别。 */
  excluded?: ExclusionReason;
  mapImage?: string;
}
