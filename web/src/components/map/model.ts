// 地图上要画什么：地点（集合点、活动、餐厅）和每辆车的路线。只整理数据，投影和排版在 layout.ts。

import type { ItineraryView, MapPin, OptionView, PlaceRef, TimedStop, VenueRef } from "@shared/views";
import { carOf, nameOf } from "../../format";

export type PlaceKind = MapPin["kind"];

export interface MapPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  /** 在这里上车的人（方案和行程的地图才有）。 */
  people: string[];
}

export interface MapRoute {
  label: string;
  /** 线型编号：地图、图例和车组列表用同一种画法。 */
  style: number;
  /** 依次经过的地点 id：接人 → 活动 → 晚餐 → 送人。 */
  stops: string[];
}

export interface MapModel {
  places: MapPlace[];
  routes: MapRoute[];
}

/** 线型有几种（pages.css 里的 .route-0 到 .route-2）。 */
const ROUTE_STYLES = 3;

export function routeStyle(index: number): number {
  return index % ROUTE_STYLES;
}

export interface MapSource {
  pins?: MapPin[];
  option?: OptionView;
  itinerary?: ItineraryView;
}

export function buildMapModel({ pins = [], option, itinerary }: MapSource): MapModel {
  const places = new Map<string, MapPlace>();
  const add = (place: PlaceRef, kind: PlaceKind, person?: string): string => {
    const entry = places.get(place.id) ?? { id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind, people: [] };
    places.set(place.id, entry);
    // 同一个地方既是场地又是集合点时，按场地画
    if (kind !== "pickup") entry.kind = kind;
    if (person && !entry.people.includes(person)) entry.people.push(person);
    return place.id;
  };
  const venue = (place: VenueRef) => add(place, place.kind);
  const pickup = (stop: TimedStop) => add(stop.place, "pickup", nameOf(stop.person));
  const dropoff = (stop: TimedStop) => add(stop.place, "pickup");

  const routes: MapRoute[] = [];
  if (option) {
    const middle = [venue(option.activity.venue), venue(option.dinner.venue)];
    option.rides.forEach((ride, index) => {
      routes.push({ label: carOf(ride.driver), style: routeStyle(index), stops: [...ride.pickups.map(pickup), ...middle, ...ride.dropoffs.map(dropoff)] });
    });
  }
  if (itinerary) {
    // 乘客的 route、returnRoute 是空的：只画自己这一趟（被接 → 活动 → 晚餐 → 送回）
    const outbound = itinerary.route.length ? itinerary.route : [itinerary.pickup];
    const inbound = itinerary.returnRoute.length ? itinerary.returnRoute : [itinerary.dropoff];
    const middle = [venue(itinerary.activity.venue), venue(itinerary.dinner.venue)];
    routes.push({ label: "Your route", style: routeStyle(routes.length), stops: [...outbound.map(pickup), ...middle, ...inbound.map(dropoff)] });
  }
  for (const pin of pins) add(pin, pin.kind);
  return { places: [...places.values()], routes };
}
