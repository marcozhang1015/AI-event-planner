// /map/:token.png：服务端代理 Static Maps（key 不给浏览器）。画什么和网页上看到的一致：
// public（链接预览）只画场地；组织者画集合点和 Plan A 的路线；参与者只画自己的路线。

import { staticMapUrl, type MapMarker, type MapPath } from "../maps/google";
import { attendeeView, eventPins, planView, type ViewOptions } from "../out/privacy";
import type { Event, Member } from "../shared/types";
import type { OptionView } from "../shared/views";
import { publishedOption, venuesOf, type Reader } from "../store/changes";

const CACHE_LIMIT = 100;

function routeOf(option: OptionView): MapPath[] {
  return option.rides.map((ride) => [
    ...ride.pickups.map((stop) => stop.place),
    option.activity.venue,
    option.dinner.venue,
    ...ride.dropoffs.map((stop) => stop.place),
  ]);
}

/** 链接预览用：只画这次的活动和餐厅（没有方案时画候选场地），不含任何人的集合点。 */
function publicMarkers(db: Reader, event: Event): MapMarker[] {
  const option = publishedOption(db, event.published) ?? db.latestPlan(event.id)?.options[0];
  const ids = option ? [option.activity.venueId, option.dinner.venueId] : event.candidateVenueIds;
  return venuesOf(db, ids).map(({ venue, place }) => marker(place, venue.kind));
}

function marker(point: { lat: number; lng: number }, kind: MapMarker["kind"]): MapMarker {
  return { lat: point.lat, lng: point.lng, kind };
}

/** 这个链接的地图上画哪些点和线。 */
export function mapContent(db: Reader, event: Event, member: Member, publicOnly: boolean, opts: ViewOptions): { markers: MapMarker[]; paths: MapPath[] } {
  if (publicOnly) return { markers: publicMarkers(db, event), paths: [] };
  if (member.role === "organizer") {
    const latest = db.latestPlan(event.id);
    const plan = latest ? planView(db, event, latest, member.handle) : undefined;
    const option = plan?.options.find((candidate) => candidate.label === (plan.publishedLabel ?? "A")) ?? plan?.options[0];
    return { markers: eventPins(db, event).map((pin) => marker(pin, pin.kind)), paths: option ? routeOf(option) : [] };
  }
  const view = attendeeView(db, event, member, opts);
  const it = view.itinerary;
  if (!it) return { markers: view.pins.map((pin) => marker(pin, pin.kind)), paths: [] };
  const stops = it.role === "driver" ? it.route.map((stop) => stop.place) : [it.pickup.place];
  return {
    markers: [...stops.map((place) => marker(place, "pickup")), marker(it.activity.venue, "activity"), marker(it.dinner.venue, "restaurant")],
    paths: [[...stops, it.activity.venue, it.dinner.venue, it.dropoff.place]],
  };
}

/** 按图片地址缓存（地址里带了点和线，内容变了地址就变）。 */
export class MapImages {
  private readonly cache = new Map<string, ArrayBuffer>();

  constructor(private readonly key: string) {}

  async fetch(content: { markers: MapMarker[]; paths: MapPath[] }): Promise<ArrayBuffer | undefined> {
    if (!content.markers.length) return undefined;
    const url = staticMapUrl(this.key, content.markers, content.paths);
    const cached = this.cache.get(url);
    if (cached) return cached;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[maps] Static Maps ${response.status}：${await response.text()}`);
      return undefined;
    }
    const image = await response.arrayBuffer();
    this.cache.set(url, image);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return image;
  }
}
