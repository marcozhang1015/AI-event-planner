// 共享领域类型（hackathon-plan.md §5.8）。B 维护，改动要通知 A 和 C。

/** iMessage：E.164 号码或 Apple ID 邮箱；网页模拟器：`sim:<id>`；terminal：`term:<聊天窗口 id>`。 */
export type Handle = string;

/** 活动时区里的本地时刻，24 小时制 "HH:MM"。hackathon 版只做单日活动。 */
export type LocalTime = string;

export interface TimeWindow {
  start: LocalTime;
  end: LocalTime;
}

export type EventStatus = "DRAFT" | "COLLECTING" | "REVIEW" | "PUBLISHED";

export interface Area {
  /** 组织者的原话，比如 "near campus"。 */
  label: string;
  lat?: number;
  lng?: number;
  radiusKm: number;
}

export interface Event {
  id: string;
  organizer: Handle;
  title: string;
  status: EventStatus;
  /** "YYYY-MM-DD" */
  day?: string;
  timezone: string;
  window?: TimeWindow;
  area?: Area;
  budgetCapCents?: number;
  headcount?: number;
  candidateVenueIds: string[];
  inputVersion: number;
  publishedPlanId?: string;
  createdAt: string;
}

export type Role = "organizer" | "attendee";
export type MemberStatus = "invited" | "collecting" | "confirmed" | "declined";

export interface Member {
  eventId: string;
  handle: Handle;
  name: string;
  email?: string;
  /** 个人网页链接里的 token（/o/:token 或 /i/:token）。 */
  linkToken: string;
  role: Role;
  status: MemberStatus;
  /** 模拟参与者：消息发到网页模拟器或 terminal，不发 iMessage。 */
  simulated: boolean;
}

export type Drives = "yes" | "if_needed" | "no";

/** 字段是 undefined 表示还没问到；空数组表示"没有"。 */
export interface Answer {
  eventId: string;
  handle: Handle;
  free?: TimeWindow[];
  homeBy?: LocalTime;
  budgetCapCents?: number;
  allergies?: string[];
  diet?: string[];
  drives?: Drives;
  seats?: number;
  /** 本人描述的位置（原话），地理编码前。 */
  pickupQuery?: string;
  pickupPlaceId?: string;
  /** 过敏、忌口、开车、集合点是从上次活动的记忆里预填的，这次还没请本人确认。 */
  remembered?: boolean;
  confirmed: boolean;
  version: number;
}

/**
 * 跨活动记忆：只存本人确认过、不随活动变化的偏好（时间、预算每次都重新问）。
 * 只在本人的私聊里用，组织者看不到；本人说 "forget me" 就删。
 */
export interface Person {
  handle: Handle;
  name?: string;
  email?: string;
  allergies?: string[];
  diet?: string[];
  drives?: Drives;
  seats?: number;
  pickupQuery?: string;
  pickupPlaceId?: string;
  updatedAt: string;
}

export type Fact = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  source: "maps" | "sample" | "manual";
  providerPlaceId?: string;
}

export interface Venue {
  id: string;
  placeId: string;
  kind: "activity" | "restaurant";
  priceMinCents?: number;
  priceMaxCents?: number;
  durationMinutes?: number;
  hours?: string;
  phone?: string;
  /** 比如 { peanut: "SUPPORTED" }；没有列出的事实一律按 UNKNOWN 处理。 */
  facts: Record<string, Fact>;
  fetchedAt: string;
}

export interface TravelTime {
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
  fetchedAt: string;
}

export interface Stop {
  at: LocalTime;
  placeId: string;
  kind: "pickup" | "activity" | "dinner" | "dropoff";
  /** 接送点对应的人。 */
  handle?: Handle;
}

export interface Ride {
  driver: Handle;
  passengers: Handle[];
  stops: Stop[];
  detourMinutes: number;
}

export type ExclusionReason = "time" | "home_by" | "budget" | "allergy" | "seats" | "no_answer";

export interface PlanOption {
  label: string;
  attendees: Handle[];
  excluded: { handle: Handle; reason: ExclusionReason }[];
  itinerary: Stop[];
  rides: Ride[];
  costMaxCents: Record<Handle, number>;
  unknowns: { venueId: string; fact: string }[];
  /** 用到的 `if_needed` 司机：交给组织者之前要先私聊征得本人同意。 */
  ifNeededDrivers: Handle[];
}

export type PlanStatus = "FEASIBLE" | "NEEDS_VERIFICATION" | "INFEASIBLE";

export interface PlanResult {
  status: PlanStatus;
  options: PlanOption[];
  conflicts: string[];
}

export interface Plan extends PlanResult {
  id: string;
  eventId: string;
  inputVersion: number;
  createdAt: string;
}

export interface Verification {
  eventId: string;
  venueId: string;
  fact: string;
  value: Fact;
  by: Handle;
  at: string;
  note?: string;
}

export interface MessageLog {
  /** 平台消息 id；入站消息用它去重。 */
  id: string;
  handle: Handle;
  direction: "inbound" | "outbound";
  kind: "text" | "reaction" | "contact";
  text: string;
  at: string;
  /** reaction：被点的那条消息。 */
  targetId?: string;
  /** contact：联系人卡片里的名字和号码。 */
  contactName?: string;
  phones?: string[];
  handledAt?: string;
}

export interface Delivery {
  planId: string;
  handle: Handle;
  channel: "imessage" | "email";
  kind: "final" | "update" | "excluded";
  sentAt?: string;
  error?: string;
}

/** 每个人和 agent 的对话进行到哪一步。 */
export interface Session {
  handle: Handle;
  eventId?: string;
  role?: Role;
  /** agent 在等什么样的回复。 */
  awaiting?: "opener" | "summary_confirm" | "email" | "invitees";
  /** 上一个问题问的是哪个字段（LLM 不可用时，规则解析靠它）。 */
  asked?: string;
  /** 摘要消息的 id：对它点 👍 视为确认。 */
  summaryMessageId?: string;
}

export type Intent = "answer" | "confirm" | "change" | "question" | "smalltalk" | "other";

export interface EventPatch {
  title?: string;
  day?: string;
  window?: Partial<TimeWindow>;
  areaLabel?: string;
  budgetCapCents?: number;
  headcount?: number;
}

export interface AnswerPatch {
  free?: Partial<TimeWindow>;
  homeBy?: LocalTime;
  budgetCapCents?: number;
  allergies?: string[];
  diet?: string[];
  drives?: Drives;
  seats?: number;
  pickupQuery?: string;
  email?: string;
}

/** Claude 一轮的输出（§5.4）：提议的字段 + 下一句话。 */
export interface Extraction<P> {
  intent: Intent;
  patch: P;
  /** Claude 认为下一步要问的字段；和代码算出来的不一致时，改用模板问题。 */
  askingAbout?: string;
  reply?: string;
}
