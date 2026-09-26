// 隐私投影（§5.11）：网页 API、iMessage 模板、邮件、日历和 LLM 上下文都从这里取数据。
// - 组织者：进度、聚合信息、方案（车组、公共集合点、排除原因类别）；看不到预算数字、住址和谁过敏。
// - 参与者：自己的答案和行程，同车人的名字和上车点。
// 每个人的网页链接（token 只通过本人的私聊和邮件发出）也在这里生成。

import { allergenKey, allergenLabel } from "../core/allergens";
import { affectedHandles, isAffected, rideOf } from "../core/state";
import { weekdayName } from "../shared/time";
import type { Answer, Event, Handle, Member, Plan, PlanOption, Stop, Visit } from "../shared/types";
import type {
  AttendeeView,
  ItineraryView,
  MapPin,
  OptionView,
  OrganizerView,
  PersonRef,
  PlaceRef,
  PlanView,
  PublicEvent,
  TimedStop,
  VenueRef,
  VisitView,
} from "../shared/views";
import { organizerName, participantsOf, publishedOption, venuesOf, type Reader } from "../store/changes";
import { itineraryChanges, templates as t } from "./imessage";

export interface ViewOptions {
  baseUrl: string;
  /** 有地图 key 时给出服务端代理的静态地图 /map/:token.png。 */
  mapImages: boolean;
}

// 链接

/** 个人网页：组织者是看板 /o/:token，参与者是行程页 /i/:token。 */
export function memberUrl(baseUrl: string, member: Pick<Member, "role" | "linkToken">): string {
  return `${baseUrl}/${member.role === "organizer" ? "o" : "i"}/${member.linkToken}`;
}

/** 服务端代理的静态地图。带上输入版本号：内容变了地址就变，不会拿到缓存里的旧图。 */
export function mapImagePath(member: Pick<Member, "linkToken">, event: Pick<Event, "inputVersion">): string {
  return `/map/${member.linkToken}.png?v=${event.inputVersion}`;
}

// 视图

function publicEvent(event: Event): PublicEvent {
  return {
    title: event.title,
    status: event.status,
    day: event.day,
    dayName: event.day ? weekdayName(event.day) : undefined,
    window: event.window,
    area: event.area?.label,
    budgetCapCents: event.budgetCapCents,
    timezone: event.timezone,
    inputVersion: event.inputVersion,
  };
}

/** 方案里的人名、地点、场地 → 视图。`viewer` 是正在看的人（显示成 "You"）。 */
class Directory {
  /** handle → 显示的名字。同名的人（比如两张 Sam 的联系人卡片）加编号区分："Sam"、"Sam 2"。 */
  private readonly names = new Map<Handle, string>();
  private readonly center: { lat: number; lng: number };

  constructor(
    private readonly db: Reader,
    event: Event,
    private readonly viewer?: Handle,
  ) {
    const seen = new Map<string, number>();
    for (const member of db.membersOf(event.id)) {
      const count = (seen.get(member.name) ?? 0) + 1;
      seen.set(member.name, count);
      this.names.set(member.handle, count === 1 ? member.name : `${member.name} ${count}`);
    }
    this.center = { lat: event.area?.lat ?? 0, lng: event.area?.lng ?? 0 };
  }

  person(handle: Handle): PersonRef {
    const name = this.names.get(handle) ?? "Someone";
    return handle === this.viewer ? { name, me: true } : { name };
  }

  /** 地点数据缺了（不应该发生）：落在活动区域中心，免得地图被一个 (0,0) 的点拉到全世界。 */
  place(id: string): PlaceRef {
    const place = this.db.place(id);
    return place ? { id, name: place.name, lat: place.lat, lng: place.lng } : { id, name: "the pickup spot", ...this.center };
  }

  venue(id: string): VenueRef {
    const venue = this.db.venue(id);
    const place = this.place(venue?.placeId ?? id);
    return {
      ...place,
      kind: venue?.kind ?? "activity",
      priceMinCents: venue?.priceMinCents,
      priceMaxCents: venue?.priceMaxCents,
      phone: venue?.phone,
      hours: venue?.hours,
    };
  }

  visit(visit: Visit): VisitView {
    return { venue: this.venue(visit.venueId), start: visit.start, end: visit.end };
  }

  stop(stop: Stop): TimedStop {
    return { at: stop.at, person: this.person(stop.handle), place: this.place(stop.placeId) };
  }
}

function optionView(dir: Directory, option: PlanOption): OptionView {
  const pickups = option.rides.map((ride) => ride.pickups[0]?.at ?? option.activity.start).sort();
  const dropoffs = option.rides.map((ride) => ride.dropoffs.at(-1)?.at ?? option.dinner.end).sort();
  return {
    label: option.label,
    status: option.status,
    attendees: option.attendees.map((handle) => dir.person(handle)),
    excluded: option.excluded.map(({ handle, reason }) => ({ person: dir.person(handle), reason })),
    activity: dir.visit(option.activity),
    dinner: dir.visit(option.dinner),
    rides: option.rides.map((ride) => ({
      driver: dir.person(ride.driver),
      passengers: ride.passengers.map((handle) => dir.person(handle)),
      pickups: ride.pickups.map((stop) => dir.stop(stop)),
      dropoffs: ride.dropoffs.map((stop) => dir.stop(stop)),
      detourMinutes: ride.detourMinutes,
    })),
    firstPickup: pickups[0] ?? option.activity.start,
    lastDropoff: dropoffs.at(-1) ?? option.dinner.end,
    costMaxCents: option.costMaxCents,
    unknowns: option.unknowns.map((unknown) => {
      const venue = dir.venue(unknown.venueId);
      return { venue: venue.name, phone: venue.phone, fact: allergenLabel(unknown.fact), severe: unknown.severe };
    }),
    waitingOn: option.ifNeededDrivers.map((handle) => dir.person(handle)),
  };
}

/** 一版方案给某人（一般是组织者）看的样子。发布后的新方案标成 update，列出改了什么、影响到谁。 */
export function planView(db: Reader, event: Event, plan: Plan, viewer?: Handle): PlanView {
  const dir = new Directory(db, event, viewer);
  const view: PlanView = {
    id: plan.id,
    version: plan.inputVersion,
    status: plan.status,
    options: plan.options.map((option) => optionView(dir, option)),
    conflicts: plan.conflicts,
    state: "draft",
  };
  const live = event.published;
  if (!live) return view;
  const before = publishedOption(db, live);
  const after = plan.options[0];
  const affected = live.planId !== plan.id && before && after ? affectedHandles(before, after) : [];
  if (!affected.length || !before || !after) return { ...view, state: "live", publishedLabel: live.label };
  const unaffected = [...new Set([...before.attendees, ...after.attendees])].filter((handle) => !affected.includes(handle));
  return {
    ...view,
    state: "update",
    changes: t.planChanges(optionView(dir, before), optionView(dir, after)),
    affected: affected.map((handle) => dir.person(handle)),
    unaffected: unaffected.map((handle) => dir.person(handle)),
  };
}

/** 某人在某个选项里的行程；`previous` 是上一次发布的选项，用来标出改了什么。不在方案里返回 undefined。 */
export function itineraryView(db: Reader, event: Event, option: PlanOption, member: Member, opts: ViewOptions, previous?: PlanOption): ItineraryView | undefined {
  const seat = rideOf(option, member.handle);
  if (!seat) return undefined;
  const dir = new Directory(db, event, member.handle);
  const { ride, pickup, dropoff } = seat;
  const role = ride.driver === member.handle ? "driver" : "rider";
  const view: ItineraryView = {
    role,
    driver: dir.person(ride.driver),
    carmates: [ride.driver, ...ride.passengers]
      .filter((handle) => handle !== member.handle)
      .map((handle) => ({ person: dir.person(handle), place: dir.place(ride.pickups.find((stop) => stop.handle === handle)?.placeId ?? "") })),
    pickup: dir.stop(pickup),
    route: role === "driver" ? ride.pickups.map((stop) => dir.stop(stop)) : [],
    returnRoute: role === "driver" ? ride.dropoffs.map((stop) => dir.stop(stop)) : [],
    activity: dir.visit(option.activity),
    dinner: { ...dir.visit(option.dinner), note: allergyNote(db, event, member, option.dinner.venueId) },
    dropoff: dir.stop(dropoff),
    costMaxCents: option.costMaxCents,
    version: Math.max(1, event.publications ?? 1),
    changes: [],
    calendarUrl: `${memberUrl(opts.baseUrl, member)}/calendar.ics`,
  };
  const before = previous && isAffected(previous, option, member.handle) ? itineraryView(db, event, previous, member, opts) : undefined;
  return before ? { ...view, changes: itineraryChanges(before, view) } : view;
}

/** 组织者核实过餐厅能处理本人的过敏：在本人的行程里注明（只有本人看得到）。 */
function allergyNote(db: Reader, event: Event, member: Member, venueId: string): string | undefined {
  const keys = new Set((db.answer(event.id, member.handle)?.allergies ?? []).map(allergenKey));
  const facts = db
    .verificationsOf(event.id)
    .filter((verification) => verification.venueId === venueId && verification.value === "SUPPORTED" && keys.has(verification.fact))
    .map((verification) => allergenLabel(verification.fact));
  return facts.length ? t.allergyNote(organizerName(db, event), facts) : undefined;
}

function pickupPin(db: Reader, answer: Answer | undefined): MapPin | undefined {
  const place = answer?.pickupPlaceId ? db.place(answer.pickupPlaceId) : undefined;
  return place ? { id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: "pickup" } : undefined;
}

function venuePins(db: Reader, event: Event): MapPin[] {
  return venuesOf(db, event.candidateVenueIds).map(({ venue, place }) => ({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: venue.kind }));
}

function mapImage(member: Member, event: Event, opts: ViewOptions): string | undefined {
  return opts.mapImages ? mapImagePath(member, event) : undefined;
}

/** 发布之后每人的通知有没有送到（最近一次记录为准），还在排队的是 scheduled。 */
function deliveryStatus(db: Reader, event: Event): Map<Handle, "sent" | "failed" | "scheduled"> {
  const status = new Map<Handle, "sent" | "failed" | "scheduled">();
  if (!event.published) return status;
  const plans = [event.previous?.planId, event.published.planId].filter((id): id is string => Boolean(id));
  for (const delivery of plans.flatMap((id) => db.deliveriesOf(id))) {
    if (delivery.channel === "imessage") status.set(delivery.handle, delivery.error ? "failed" : "sent");
  }
  for (const handle of db.scheduledHandles()) status.set(handle, "scheduled");
  return status;
}

/** 看板地图上的点：参与者的集合点和候选场地。 */
export function eventPins(db: Reader, event: Event): MapPin[] {
  return dedupePins([...participantsOf(db, event).flatMap(({ answer }) => pickupPin(db, answer) ?? []), ...venuePins(db, event)]);
}

export function organizerView(db: Reader, event: Event, opts: ViewOptions): OrganizerView {
  const members = db.membersOf(event.id);
  const participants = participantsOf(db, event);
  const answers = new Map(participants.map(({ member, answer }) => [member.handle, answer]));
  const confirmed = participants.filter(({ answer }) => answer.confirmed).map(({ answer }) => answer);
  const delivery = deliveryStatus(db, event);
  const organizer = members.find((member) => member.handle === event.organizer);
  const latest = db.latestPlan(event.id);
  const live = publishedOption(db, event.published);
  const dir = new Directory(db, event);
  return {
    role: "organizer",
    event: publicEvent(event),
    organizerName: organizerName(db, event),
    members: members.map((member) => ({
      name: dir.person(member.handle).name,
      role: member.role,
      status: member.status,
      attending: answers.has(member.handle),
      pickup: pickupPin(db, answers.get(member.handle))?.name,
      delivery: delivery.get(member.handle),
    })),
    counts: {
      total: participants.length,
      confirmed: confirmed.length,
      waiting: participants.filter(({ answer }) => !answer.confirmed).length,
    },
    aggregates: {
      allergies: [...new Set(confirmed.flatMap((answer) => answer.allergies ?? []))].sort(),
      drivers: confirmed.filter((answer) => answer.drives === "yes" || answer.drives === "if_needed").length,
      seats: confirmed.reduce((sum, answer) => sum + (answer.drives === "no" ? 0 : (answer.seats ?? 0)), 0),
      needRides: confirmed.filter((answer) => answer.drives === "no").length,
    },
    pins: eventPins(db, event),
    plan: latest ? planView(db, event, latest, event.organizer) : undefined,
    me: organizer && live ? itineraryView(db, event, live, organizer, opts, publishedOption(db, event.previous)) : undefined,
    mapImage: organizer ? mapImage(organizer, event, opts) : undefined,
  };
}

export function attendeeView(db: Reader, event: Event, member: Member, opts: ViewOptions): AttendeeView {
  const answer = db.answer(event.id, member.handle);
  const pickup = pickupPin(db, answer);
  const live = publishedOption(db, event.published);
  return {
    role: "attendee",
    event: publicEvent(event),
    organizerName: organizerName(db, event),
    me: {
      name: member.name,
      status: member.status,
      hasEmail: Boolean(member.email),
      answer: {
        free: answer?.free,
        homeBy: answer?.homeBy,
        budgetCapCents: answer?.budgetCapCents,
        allergies: answer?.allergies,
        diet: answer?.diet,
        drives: answer?.drives,
        seats: answer?.seats,
        pickup: pickup?.name,
        confirmed: answer?.confirmed ?? false,
      },
    },
    pins: pickup ? [pickup] : [],
    itinerary: live ? itineraryView(db, event, live, member, opts, publishedOption(db, event.previous)) : undefined,
    // 还没回复的人随时可以补答（之后按变更处理），行程页照常显示收集中，不说"这次去不了"
    excluded: live?.excluded.find((exclusion) => exclusion.handle === member.handle && exclusion.reason !== "no_answer")?.reason,
    mapImage: mapImage(member, event, opts),
  };
}

function dedupePins(pins: MapPin[]): MapPin[] {
  return [...new Map(pins.map((pin) => [pin.id, pin])).values()];
}

/** 给 Claude 的上下文只含这个人自己的字段（§5.4 上下文最小化）。 */
export function ownFields(answer: Answer): Record<string, unknown> {
  const { eventId: _eventId, handle: _handle, version: _version, pickupPlaceId: _placeId, agreedToDrive: _agreed, ...fields } = answer;
  return fields;
}
