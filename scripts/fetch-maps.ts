// 用 Google 抓一次 demo 区域的数据写进本机缓存（fixtures/maps-cache/，不进 git）。
// 用法：MAPS_MODE=live MAPS_REGION="St. Louis, MO" bun scripts/fetch-maps.ts "near campus" hike "the library" "north station"
//   第 1 个参数：活动区域；第 2 个：活动搜索词；之后：集合点（可以多个）。
// 之后 demo 用 MAPS_MODE=cache 跑，同样的搜索都从缓存读。

import { config } from "../src/config";
import { createMaps } from "../src/maps";

if (config.mapsMode !== "live") {
  console.error("需要 MAPS_MODE=live（和 MAPS_SERVER_KEY）");
  process.exit(1);
}

const [areaLabel = "near campus", activity = "hike", ...pickups] = process.argv.slice(2);
const withRegion = (query: string) => (config.mapsRegion ? `${query}, ${config.mapsRegion}` : query);
const maps = createMaps();

// 查询串要和运行时（src/maps/candidates.ts、src/flows/attendee.ts）一致，缓存才命中
const [center] = await maps.searchPlaces(withRegion(areaLabel));
if (!center) {
  console.error(`找不到区域 "${areaLabel}"`);
  process.exit(1);
}
const area = { label: areaLabel, lat: center.lat, lng: center.lng, radiusKm: 15 };
console.log(`区域：${center.name} (${center.lat}, ${center.lng})`);

const activities = (await maps.searchVenues(withRegion(activity), "activity", area)).slice(0, 3);
const restaurants = (await maps.searchVenues(withRegion("restaurant"), "restaurant", area)).slice(0, 6);
for (const { place, venue } of [...activities, ...restaurants]) {
  const price = venue.priceMaxCents !== undefined ? ` $${(venue.priceMinCents ?? 0) / 100}–${venue.priceMaxCents / 100}` : "";
  console.log(`  ${venue.kind.padEnd(10)} ${place.name}${price}`);
}

const pickupPlaces = [];
for (const query of pickups) {
  const [place] = await maps.searchPlaces(withRegion(query), area);
  console.log(`  pickup     "${query}" → ${place?.name ?? "（没找到）"}`);
  if (place) pickupPlaces.push(place);
}

const stops = [...pickupPlaces, ...[...activities, ...restaurants].map((hit) => hit.place)];
const travel = await maps.travelMinutes(stops, stops);
console.log(`车程：${travel.length} 对`);
