// 用 Google 抓一次 demo 区域的数据写进本机缓存（fixtures/maps-cache/，不进 git）。
// 用法：MAPS_MODE=live MAPS_REGION="St. Louis, MO" bun scripts/fetch-maps.ts "near campus" hike "the library" "north station"
//   第 1 个参数：活动区域；第 2 个：活动（和组织者说的一样，比如 hike 或 "hike + dinner"）；之后：集合点（可以多个）。
// 之后 demo 用 MAPS_MODE=cache 跑，同样的搜索都从缓存读。

import { config } from "../src/config";
import { AREA_RADIUS_KM } from "../src/core/geo";
import { createMaps, findCandidates, regionQuery } from "../src/maps";

if (config.mapsMode !== "live") {
  console.error("需要 MAPS_MODE=live（和 MAPS_SERVER_KEY）");
  process.exit(1);
}

const [areaLabel = "near campus", activity = "hike", ...pickups] = process.argv.slice(2);
const maps = createMaps(config);

// 和运行时走同一个函数、同样的参数，缓存才命中（组织者确认活动时的搜索见 src/flows/organizer.ts）
const { area, candidates } = await findCandidates(maps, { label: areaLabel, radiusKm: AREA_RADIUS_KM }, activity, config.mapsRegion);
if (area.lat === undefined) {
  console.error(`找不到区域 "${areaLabel}"`);
  process.exit(1);
}
console.log(`区域：${areaLabel} (${area.lat}, ${area.lng})`);
for (const { place, venue } of candidates) {
  const price = venue.priceMaxCents !== undefined ? ` $${(venue.priceMinCents ?? 0) / 100}–${venue.priceMaxCents / 100}` : "";
  console.log(`  ${venue.kind.padEnd(10)} ${place.name}${price}`);
}

// 集合点的搜索和 src/flows/collect.ts 一样：带上地区、限定在活动区域
const pickupPlaces = [];
for (const query of pickups) {
  const [place] = await maps.searchPlaces(regionQuery(query, config.mapsRegion), area);
  console.log(`  pickup     "${query}" → ${place?.name ?? "（没找到）"}`);
  if (place) pickupPlaces.push(place);
}

const stops = [...pickupPlaces, ...candidates.map(({ place }) => place)];
const travel = await maps.travelMinutes(stops, stops);
console.log(`车程：${travel.length} 对`);
