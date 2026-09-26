// 组织者确认摘要后，按区域搜候选活动和餐厅（demo 读缓存）。

import type { FlowDeps } from "../flows/context";
import { withRegion } from "../flows/context";
import type { Event } from "../types";

const MAX_ACTIVITIES = 3;
const MAX_RESTAURANTS = 6;

/** "hike + dinner" → "hike"：活动部分当搜索词，餐饮单独搜。 */
function activityQuery(title: string): string {
  return title.split(/\+|&|,|\band\b/)[0]?.trim() || title;
}

export async function prepareCandidates(deps: FlowDeps, event: Event): Promise<Event> {
  if (!event.area) return event;
  let area = event.area;
  if (area.lat === undefined) {
    const [center] = await deps.maps.searchPlaces(withRegion(deps, area.label));
    if (center) area = { ...area, lat: center.lat, lng: center.lng };
  }

  const activities = (await deps.maps.searchVenues(withRegion(deps, activityQuery(event.title)), "activity", area)).slice(0, MAX_ACTIVITIES);
  const restaurants = (await deps.maps.searchVenues(withRegion(deps, "restaurant"), "restaurant", area)).slice(0, MAX_RESTAURANTS);
  for (const { place, venue } of [...activities, ...restaurants]) {
    deps.db.putPlace(place);
    deps.db.putVenue(venue);
  }
  return { ...event, area, candidateVenueIds: [...activities, ...restaurants].map((hit) => hit.venue.id) };
}
