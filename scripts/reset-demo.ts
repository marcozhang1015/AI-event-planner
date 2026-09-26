// 清空数据库，载入一个收集到一半的示例活动（虚构数据），打印看板和个人页链接。
// 用法：bun run reset-demo       只清空：bun run reset-demo --empty

import { config } from "../src/config";
import { addDays, todayIn, weekdayOf } from "../src/core/time";
import { Store } from "../src/db";
import { remember } from "../src/flows/memory";
import { SampleMaps, sampleCenter } from "../src/maps/sample";
import type { Answer, Event, Member, Session } from "../src/types";

const store = new Store(config.dbPath);
store.reset();
if (process.argv.includes("--empty")) {
  console.log(`已清空 ${config.dbPath}`);
  process.exit(0);
}

const now = new Date();
const today = todayIn(config.timezone, now);
const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
const maps = new SampleMaps();

const area = { ...sampleCenter, label: "near campus" };
const venues = [...(await maps.searchVenues("hike", "activity", area)).slice(0, 2), ...(await maps.searchVenues("restaurant", "restaurant", area))];
for (const { place, venue } of venues) {
  store.savePlace(place);
  store.saveVenue(venue);
}
const [library, northStation] = [...(await maps.searchPlaces("library")), ...(await maps.searchPlaces("north station"))];
for (const place of [library, northStation]) if (place) store.savePlace(place);

const event: Event = {
  id: "evt_demo",
  organizer: "sim:alex",
  title: "hike + dinner",
  status: "COLLECTING",
  day: saturday,
  timezone: config.timezone,
  window: { start: "14:00", end: "22:00" },
  area,
  budgetCapCents: 4000,
  headcount: 5,
  candidateVenueIds: venues.map((hit) => hit.venue.id),
  inputVersion: 3,
  createdAt: now.toISOString(),
};
store.saveEvent(event);

// token 固定，方便开发时直接打开；真实流程里是随机生成的
const people: { member: Member; answer?: Partial<Answer>; session: Session }[] = [
  {
    member: { eventId: event.id, handle: "sim:alex", name: "Alex", linkToken: "demo-alex", role: "organizer", status: "confirmed", simulated: true },
    session: { handle: "sim:alex", eventId: event.id, role: "organizer" },
  },
  {
    member: { eventId: event.id, handle: "sim:sam", name: "Sam", linkToken: "demo-sam", role: "attendee", status: "confirmed", simulated: true, email: "sam@example.com" },
    answer: { free: [{ start: "15:00", end: "22:00" }], homeBy: "22:00", allergies: ["peanuts (severe)"], diet: [], drives: "no", pickupQuery: "the library", pickupPlaceId: library?.id, budgetCapCents: 4000, confirmed: true, version: 1 },
    session: { handle: "sim:sam", eventId: event.id, role: "attendee" },
  },
  {
    member: { eventId: event.id, handle: "sim:priya", name: "Priya", linkToken: "demo-priya", role: "attendee", status: "confirmed", simulated: true },
    answer: { free: [{ start: "14:00", end: "22:00" }], allergies: [], drives: "yes", seats: 2, pickupQuery: "north station", pickupPlaceId: northStation?.id, budgetCapCents: 4000, confirmed: true, version: 1 },
    session: { handle: "sim:priya", eventId: event.id, role: "attendee" },
  },
  {
    member: { eventId: event.id, handle: "sim:leo", name: "Leo", linkToken: "demo-leo", role: "attendee", status: "collecting", simulated: true },
    answer: { free: [{ start: "14:00", end: "22:00" }], allergies: [], drives: "if_needed", confirmed: false, version: 0 },
    session: { handle: "sim:leo", eventId: event.id, role: "attendee", asked: "seats" },
  },
  {
    member: { eventId: event.id, handle: "sim:mia", name: "Mia", linkToken: "demo-mia", role: "attendee", status: "invited", simulated: true },
    answer: { confirmed: false, version: 0 },
    session: { handle: "sim:mia", eventId: event.id, role: "attendee", awaiting: "opener" },
  },
];

for (const { member, answer, session } of people) {
  store.saveMember(member);
  const saved: Answer = { eventId: event.id, handle: member.handle, confirmed: false, version: 0, ...answer };
  if (answer) store.saveAnswer(saved);
  store.saveSession(session);
  // 已确认的人也有跨活动记忆：下次邀请他们时能看到 "From last time I have…"
  if (saved.confirmed) store.savePerson(remember(undefined, member, saved, now));
}

console.log(`已载入示例活动（${saturday}）到 ${config.dbPath}`);
for (const { member } of people) {
  console.log(`  ${member.name.padEnd(6)} ${config.publicBaseUrl}/${member.role === "organizer" ? "o" : "i"}/${member.linkToken}`);
}
console.log("开发网页时把 3000 换成 5173（bun run web:dev）。");
