// 地图适配层入口（§5.5）：按 MAPS_MODE 选实现（接口见 types.ts），以及按区域搜候选场地。

import type { Config } from "../config";
import type { Area, Candidate } from "../shared/types";
import { CachedMaps } from "./cache";
import { GoogleMaps } from "./google";
import { SampleMaps } from "./sample";
import type { Maps } from "./types";

export type { Maps } from "./types";

export function createMaps(options: Pick<Config, "mapsMode" | "mapsCacheDir" | "mapsServerKey">): Maps {
  switch (options.mapsMode) {
    case "sample":
      return new SampleMaps();
    case "cache":
      return new CachedMaps(options.mapsCacheDir);
    case "live":
      if (!options.mapsServerKey) throw new Error("MAPS_MODE=live 需要 MAPS_SERVER_KEY");
      return new CachedMaps(options.mapsCacheDir, new GoogleMaps(options.mapsServerKey));
  }
}

const MAX_ACTIVITIES = 3;
const MAX_RESTAURANTS = 6;

/** 地图搜索时带上地区提示（MAPS_REGION），免得 "the library" 搜到别的城市。 */
export function regionQuery(query: string, region: string | undefined): string {
  return region ? `${query}, ${region}` : query;
}

/** "hike + dinner" → "hike"：活动部分当搜索词，餐饮单独搜。 */
function activityQuery(title: string): string {
  return title.split(/\+|&|,|\band\b/)[0]?.trim() || title;
}

/**
 * 按区域搜候选活动和餐厅；区域还没定位就先定位。返回定位后的区域和候选场地。
 * 组织者确认活动、改区域时，以及 fetch-maps 脚本都走这里：查询参数一模一样，缓存才能命中。
 */
export async function findCandidates(maps: Maps, area: Area, title: string, region?: string): Promise<{ area: Area; candidates: Candidate[] }> {
  let located = area;
  if (located.lat === undefined) {
    const [center] = await maps.searchPlaces(regionQuery(located.label, region));
    if (center) located = { ...located, lat: center.lat, lng: center.lng };
  }
  const activities = (await maps.searchVenues(regionQuery(activityQuery(title), region), "activity", located)).slice(0, MAX_ACTIVITIES);
  const restaurants = (await maps.searchVenues(regionQuery("restaurant", region), "restaurant", located)).slice(0, MAX_RESTAURANTS);
  return { area: located, candidates: [...activities, ...restaurants] };
}
