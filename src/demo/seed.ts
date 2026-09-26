// demo 种子数据（虚构地点，plan §4.2 的五个人）。按名字从通讯录找 handle，找不到才用 sim:<名字>，
// 所以真手机也能进预置的活动。
//   collecting：收集到一半（Leo 在答座位数，Mia 还没回开场白）
//   ready：全员已确认，等组织者说 "plan it"
//   published：Maple Kitchen 的花生过敏已核实、Plan A 已发布，可以直接演幕 4

import { offlineBrain } from "../brain/extract";
import { platformOf, type Contact } from "../core/handle";
import { remember } from "../core/memory";
import { transition } from "../core/state";
import type { FlowDeps } from "../flows/context";
import { approve, solveEvent } from "../flows/planning";
import { SampleMaps, sampleCenter } from "../maps/sample";
import { memberUrl } from "../out/privacy";
import { addDays, todayIn, weekdayOf } from "../shared/time";
import type { Answer, Event, Member, Place, Session } from "../shared/types";
import { ChangeSet } from "../store/changes";
import type { Store } from "../store/db";

export type SeedStage = "collecting" | "ready" | "published";

export interface SeedOptions {
  stage: SeedStage;
  contacts: Contact[];
  now: Date;
  timezone: string;
  baseUrl: string;
  emailFrom: string;
}

interface Seeded {
  member: Member;
  answer?: Partial<Answer>;
  session: Session;
}

const WINDOW = { start: "14:00", end: "22:00" };

/** 清空数据库，载入示例活动。返回活动和每个人的网页链接（token 固定，方便开发时直接打开）。 */
export async function seedDemo(store: Store, options: SeedOptions): Promise<{ event: Event; links: { name: string; url: string }[] }> {
  store.reset();
  const { stage, now } = options;
  const today = todayIn(options.timezone, now);
  const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  const maps = new SampleMaps();
  const area = { ...sampleCenter, label: "near campus" };

  const venues = [...(await maps.searchVenues("hike", "activity", area)).slice(0, 2), ...(await maps.searchVenues("restaurant", "restaurant", area))];
  for (const { place, venue } of venues) {
    store.savePlace(place);
    store.saveVenue(venue);
  }
  const landmark = async (query: string): Promise<Place> => {
    const [place] = await maps.searchPlaces(query);
    if (!place) throw new Error(`示例地图里没有 ${query}`);
    store.savePlace(place);
    return place;
  };
  const [library, northStation, campusGate, townSquare] = await Promise.all(["library", "north station", "campus gate", "town square"].map(landmark));

  const handleOf = (name: string) => options.contacts.find((contact) => contact.name === name)?.handle ?? `sim:${name.toLowerCase()}`;
  const alex = handleOf("Alex");
  const event: Event = {
    id: "evt_demo",
    organizer: alex,
    title: "hike + dinner",
    status: "COLLECTING",
    day: saturday,
    timezone: options.timezone,
    window: WINDOW,
    area,
    budgetCapCents: 4000,
    headcount: 5,
    candidateVenueIds: venues.map((hit) => hit.venue.id),
    inputVersion: 1,
    createdAt: now.toISOString(),
  };
  store.saveEvent(event);

  const ready = stage !== "collecting";
  const person = (name: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({
    eventId: event.id,
    handle: handleOf(name),
    name,
    linkToken: `demo-${name.toLowerCase()}`,
    role,
    status: "confirmed",
    simulated: platformOf(handleOf(name)) !== "imessage",
    ...extra,
  });
  const confirmed = { confirmed: true, version: 1 };
  const people: Seeded[] = [
    {
      member: person("Alex", "organizer"),
      answer: { free: [WINDOW], allergies: [], drives: "yes", seats: 2, pickupQuery: "campus gate", pickupPlaceId: campusGate!.id, budgetCapCents: 4000, ...confirmed },
      session: { handle: alex, eventId: event.id, role: "organizer" },
    },
    {
      member: person("Sam", "attendee", { email: "sam@example.com" }),
      answer: { free: [{ start: "15:00", end: "22:00" }], homeBy: "22:00", allergies: ["peanuts (severe)"], diet: [], drives: "no", pickupQuery: "the library", pickupPlaceId: library!.id, budgetCapCents: 4000, ...confirmed },
      session: { handle: handleOf("Sam"), eventId: event.id, role: "attendee" },
    },
    {
      member: person("Priya", "attendee"),
      answer: { free: [WINDOW], allergies: [], drives: "yes", seats: 2, pickupQuery: "north station", pickupPlaceId: northStation!.id, budgetCapCents: 4000, ...confirmed },
      session: { handle: handleOf("Priya"), eventId: event.id, role: "attendee" },
    },
    ready
      ? {
          member: person("Leo", "attendee"),
          answer: { free: [WINDOW], allergies: [], drives: "if_needed", seats: 3, pickupQuery: "north station", pickupPlaceId: northStation!.id, budgetCapCents: 3000, ...confirmed },
          session: { handle: handleOf("Leo"), eventId: event.id, role: "attendee" },
        }
      : {
          member: person("Leo", "attendee", { status: "collecting" }),
          answer: { free: [WINDOW], allergies: [], drives: "if_needed", confirmed: false, version: 0 },
          session: { handle: handleOf("Leo"), eventId: event.id, role: "attendee", asked: "seats" },
        },
    ready
      ? {
          member: person("Mia", "attendee"),
          answer: { free: [WINDOW], allergies: [], drives: "no", pickupQuery: "town square", pickupPlaceId: townSquare!.id, budgetCapCents: 4000, ...confirmed },
          session: { handle: handleOf("Mia"), eventId: event.id, role: "attendee" },
        }
      : {
          member: person("Mia", "attendee", { status: "invited" }),
          answer: { confirmed: false, version: 0 },
          session: { handle: handleOf("Mia"), eventId: event.id, role: "attendee", awaiting: "opener" },
        },
  ];

  for (const { member, answer, session } of people) {
    store.saveMember(member);
    const saved: Answer = { eventId: event.id, handle: member.handle, confirmed: false, version: 0, ...answer };
    store.saveAnswer(saved);
    store.saveSession(session);
    // 已确认的人也有跨活动记忆：下次邀请他们时能看到 "From last time I have…"
    if (saved.confirmed) store.savePerson(remember(undefined, member, saved, now));
  }

  if (stage === "published") await publishDemo(store, event, options, maps);
  return {
    event: store.getEvent(event.id)!,
    links: people.map(({ member }) => ({ name: member.name, url: memberUrl(options.baseUrl, member) })),
  };
}

/** 核实 Maple Kitchen 的花生过敏、求解、批准 Plan A。通知不发出去（种子数据只写库）。 */
async function publishDemo(store: Store, event: Event, options: SeedOptions, maps: SampleMaps): Promise<void> {
  const db = new ChangeSet(store);
  const deps: FlowDeps = {
    db,
    brain: offlineBrain,
    maps,
    now: options.now,
    timezone: options.timezone,
    baseUrl: options.baseUrl,
    agentName: "Juno",
    contacts: options.contacts,
    emailFrom: options.emailFrom,
    mapImages: false,
  };
  db.putVerification({ eventId: event.id, venueId: "sample:maple-kitchen", fact: "peanut", value: "SUPPORTED", by: event.organizer, at: options.now.toISOString(), note: "by phone" });
  const reviewing = transition(event, "REVIEW");
  db.putEvent(reviewing);
  await solveEvent(deps, reviewing);
  await approve(deps, { handle: event.organizer, incoming: [] }, reviewing, "A");
  db.commit();
}
