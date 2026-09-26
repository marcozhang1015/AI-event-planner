// 共享领域类型（hackathon-plan.md §5.8）。B 维护，改动要通知 A 和 C。
// src/shared/ 下的文件服务端和网页都引用：只能引用 shared/ 里的其他文件，不能用 Bun / Node 的 API。

/** iMessage：E.164 号码或 Apple ID 邮箱；网页模拟器：`sim:<id>`；terminal：`term:<聊天窗口 id>`。统一写法见 core/handle.ts。 */
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

/** 组织者批准过的一版方案里的某个选项（"approve A"）。 */
export interface PublishedRef {
  planId: string;
  label: string;
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
  /** 答案、设置、核实记录、参与的人有任何变化就 +1；方案绑定这个版本号，旧方案随之作废。 */
  inputVersion: number;
  /** 当前生效的方案。发布后提出的修改批准之前，它继续有效。 */
  published?: PublishedRef;
  /** 上一次发布的方案：行程页用它标出"改了什么"。 */
  previous?: PublishedRef;
  /** 发布过几次；日历邀请的 SEQUENCE 是它减 1。 */
  publications?: number;
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

/** 字段是 undefined 表示还没问到；空数组表示"没有"。组织者参加时也有一份。 */
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
  /** 集合点；司机的出发和到家地点也是它。 */
  pickupPlaceId?: string;
  /** 过敏、忌口、开车、集合点是从上次活动的记忆里预填的，这次还没请本人确认。 */
  remembered?: boolean;
  /** `if_needed` 的人被请求开车时的答复：true 这次开，false 这次不开，undefined 还没问。 */
  agreedToDrive?: boolean;
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
  /** 比如 { peanut: "SUPPORTED" }；没有列出的事实一律按 UNKNOWN 处理。键见 core/allergens.ts。 */
  facts: Record<string, Fact>;
  fetchedAt: string;
}

/** 候选场地：场地信息和它所在的地点（地图搜索的结果，也是求解器的输入）。 */
export interface Candidate {
  venue: Venue;
  place: Place;
}

export interface TravelTime {
  fromPlaceId: string;
  toPlaceId: string;
  minutes: number;
  fetchedAt: string;
}

/** 接人或送人的一站：几点、在哪、是谁。司机自己的出发和到家也各算一站。 */
export interface Stop {
  at: LocalTime;
  placeId: string;
  handle: Handle;
}

export interface Ride {
  driver: Handle;
  passengers: Handle[];
  /** 去程：第一站是司机出发，之后按顺序接人，接完直接去活动地点。 */
  pickups: Stop[];
  /** 回程：从餐厅出发按顺序送人，最后一站是司机到家。 */
  dropoffs: Stop[];
  /** 去程比司机直接开到活动地点多花的分钟数。 */
  detourMinutes: number;
}

/** 活动或晚餐：在哪、几点到几点。 */
export interface Visit {
  venueId: string;
  start: LocalTime;
  end: LocalTime;
}

export type ExclusionReason = "time" | "home_by" | "budget" | "allergy" | "seats" | "no_answer";

export interface Exclusion {
  handle: Handle;
  reason: ExclusionReason;
}

/** 餐厅对某种过敏的情况不确定：批准前要人工核实。`severe`：有人说过是严重过敏。 */
export interface Unknown {
  venueId: string;
  fact: string;
  severe: boolean;
}

export type OptionStatus = "FEASIBLE" | "NEEDS_VERIFICATION";

export interface PlanOption {
  label: string;
  status: OptionStatus;
  activity: Visit;
  dinner: Visit;
  attendees: Handle[];
  excluded: Exclusion[];
  rides: Ride[];
  /** 每人费用上界：活动和晚餐的最高价之和。 */
  costMaxCents: number;
  unknowns: Unknown[];
  /** 用到的、还没答应的 `if_needed` 司机：交给组织者之前要先私聊征得本人同意。 */
  ifNeededDrivers: Handle[];
  /** 排序依据：所有车里最大的绕路、所有车的总车程（分钟）。 */
  maxDetourMinutes: number;
  driveMinutes: number;
}

export type PlanStatus = OptionStatus | "INFEASIBLE";

export interface PlanResult {
  /** Plan A 的状态；没有可行选项时是 INFEASIBLE。 */
  status: PlanStatus;
  options: PlanOption[];
  /** 给组织者看的冲突说明，不含个人预算数字、住址或谁过敏。 */
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
  awaiting?: "opener" | "summary_confirm" | "email" | "invitees" | "joining" | "pickup_choice" | "drive_consent";
  /** 上一个问题问的是哪个字段（LLM 不可用时，规则解析靠它）。 */
  asked?: string;
  /** 摘要消息的 id：对它点 👍 视为确认。 */
  summaryMessageId?: string;
  /** pickup_choice：列给本人的候选集合点（place id，按编号顺序）。 */
  choices?: string[];
  /** 集合点连续没找到的次数：到第 2 次就列出候选。 */
  misses?: number;
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
