// Google Maps Platform：Places API (New) Text Search、Routes API computeRouteMatrix、Maps Static API。
// 价格、营业时间、电话属于 Places 的 Enterprise 字段，计费更高；只在搜候选地点时请求。

import type { Area, Candidate, Place, TravelTime, Venue } from "../shared/types";
import type { Maps } from "./types";

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const PLACE_FIELDS = ["places.id", "places.displayName", "places.formattedAddress", "places.location"];
const VENUE_FIELDS = [
  ...PLACE_FIELDS,
  "places.priceLevel",
  "places.priceRange",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.nationalPhoneNumber",
];

interface Money {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  priceLevel?: string;
  priceRange?: { startPrice?: Money; endPrice?: Money };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
}

interface MatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  condition?: string;
}

// 只有价格等级、没有价格区间时的人均粗估。这是我们自己的换算，不是 Google 给的数字。
const PRICE_LEVEL_CENTS: Record<string, [number, number]> = {
  PRICE_LEVEL_FREE: [0, 0],
  PRICE_LEVEL_INEXPENSIVE: [1000, 2000],
  PRICE_LEVEL_MODERATE: [2000, 3500],
  PRICE_LEVEL_EXPENSIVE: [3500, 6000],
  PRICE_LEVEL_VERY_EXPENSIVE: [6000, 12000],
};

function moneyToCents(money: Money | undefined): number | undefined {
  if (!money?.units && money?.nanos === undefined) return undefined;
  return Number(money.units ?? 0) * 100 + Math.round((money.nanos ?? 0) / 1e7);
}

function toPlace(place: GooglePlace): Place | undefined {
  if (!place.location) return undefined;
  return {
    id: `gmaps:${place.id}`,
    name: place.displayName?.text ?? place.formattedAddress ?? place.id,
    lat: place.location.latitude,
    lng: place.location.longitude,
    address: place.formattedAddress,
    source: "maps",
    providerPlaceId: place.id,
  };
}

export class GoogleMaps implements Maps {
  constructor(
    private readonly apiKey: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async searchText(textQuery: string, near: Area | undefined, fields: string[], pageSize: number): Promise<GooglePlace[]> {
    const body: Record<string, unknown> = { textQuery, pageSize };
    if (near?.lat !== undefined && near.lng !== undefined) {
      body.locationBias = {
        circle: { center: { latitude: near.lat, longitude: near.lng }, radius: Math.min(near.radiusKm * 1000, 50000) },
      };
    }
    const response = await fetch(SEARCH_TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": fields.join(",") },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Places searchText ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { places?: GooglePlace[] };
    return data.places ?? [];
  }

  async searchPlaces(query: string, near?: Area): Promise<Place[]> {
    const places = await this.searchText(query, near, PLACE_FIELDS, 5);
    return places.flatMap((place) => toPlace(place) ?? []);
  }

  async searchVenues(query: string, kind: Venue["kind"], near: Area): Promise<Candidate[]> {
    const places = await this.searchText(query, near, VENUE_FIELDS, 10);
    const fetchedAt = this.now().toISOString();
    return places.flatMap((raw) => {
      const place = toPlace(raw);
      if (!place) return [];
      const [levelMin, levelMax] = (raw.priceLevel && PRICE_LEVEL_CENTS[raw.priceLevel]) || [];
      return [
        {
          place,
          venue: {
            id: place.id,
            placeId: place.id,
            kind,
            priceMinCents: moneyToCents(raw.priceRange?.startPrice) ?? levelMin,
            priceMaxCents: moneyToCents(raw.priceRange?.endPrice) ?? levelMax,
            hours: raw.regularOpeningHours?.weekdayDescriptions?.join("; "),
            phone: raw.nationalPhoneNumber,
            // 地图数据里没有过敏信息：一律留空（= UNKNOWN），等人工核实
            facts: {},
            fetchedAt,
          },
        },
      ];
    });
  }

  async travelMinutes(origins: Place[], destinations: Place[]): Promise<TravelTime[]> {
    if (!origins.length || !destinations.length) return [];
    const waypoint = (place: Place) => ({ waypoint: { location: { latLng: { latitude: place.lat, longitude: place.lng } } } });
    const response = await fetch(ROUTE_MATRIX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify({
        origins: origins.map(waypoint),
        destinations: destinations.map(waypoint),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    });
    if (!response.ok) throw new Error(`Routes computeRouteMatrix ${response.status}: ${await response.text()}`);
    const elements = (await response.json()) as MatrixElement[];
    const fetchedAt = this.now().toISOString();
    return elements.flatMap((element) => {
      const from = origins[element.originIndex ?? -1];
      const to = destinations[element.destinationIndex ?? -1];
      const seconds = Number(element.duration?.replace(/s$/, ""));
      if (!from || !to || element.condition !== "ROUTE_EXISTS" || !Number.isFinite(seconds)) return [];
      return [{ fromPlaceId: from.id, toPlaceId: to.id, minutes: Math.ceil(seconds / 60), fetchedAt }];
    });
  }
}

// Static Maps 的图片地址：只在服务端带着 key 生成，由 /map/:token.png 代理给网页和邮件，key 不出服务端。

export interface MapMarker {
  lat: number;
  lng: number;
  kind: "pickup" | "activity" | "restaurant";
}

export type MapPath = { lat: number; lng: number }[];

const COLORS: Record<MapMarker["kind"], string> = { pickup: "0x0a84ff", activity: "0x34c759", restaurant: "0xff9f0a" };

function point(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

export function staticMapUrl(key: string, markers: MapMarker[], paths: MapPath[] = [], size = "640x400"): string {
  const params = new URLSearchParams({ size, scale: "2", key });
  for (const kind of ["pickup", "activity", "restaurant"] as const) {
    const points = markers.filter((marker) => marker.kind === kind);
    if (points.length) params.append("markers", [`color:${COLORS[kind]}`, "size:mid", ...points.map(point)].join("|"));
  }
  for (const path of paths) {
    if (path.length > 1) params.append("path", ["color:0x0a84ffcc", "weight:4", ...path.map(point)].join("|"));
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}
