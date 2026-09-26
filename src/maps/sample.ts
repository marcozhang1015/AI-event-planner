import sampleData from "../../fixtures/sample-maps.json";
import type { Area, Fact, Place, TravelTime, Venue } from "../types";
import { distanceKm } from "./geo";
import type { Maps, VenueHit } from "./types";

interface SamplePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  keywords: string[];
}

interface SampleVenue extends SamplePlace {
  kind: Venue["kind"];
  priceMinCents?: number;
  priceMaxCents?: number;
  durationMinutes?: number;
  hours?: string;
  phone?: string;
  facts: Record<string, string>;
}

const FETCHED_AT = "2026-01-01T00:00:00.000Z";

function toPlace(sample: SamplePlace): Place {
  return { id: sample.id, name: sample.name, lat: sample.lat, lng: sample.lng, source: "sample" };
}

function score(sample: SamplePlace, query: string): number {
  const q = query.toLowerCase();
  return sample.keywords.filter((keyword) => q.includes(keyword) || keyword.includes(q)).length + (q.includes(sample.name.toLowerCase()) ? 2 : 0);
}

/** 离线开发用的虚构数据。车程按直线距离粗算，只为让流程跑通，不代表真实路况。 */
export class SampleMaps implements Maps {
  private readonly places = sampleData.places as SamplePlace[];
  private readonly venues = sampleData.venues as SampleVenue[];

  async searchPlaces(query: string, _near?: Area): Promise<Place[]> {
    return this.places
      .map((place) => ({ place, score: score(place, query) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((hit) => toPlace(hit.place));
  }

  async searchVenues(query: string, kind: Venue["kind"], _near: Area): Promise<VenueHit[]> {
    return this.venues
      .filter((venue) => venue.kind === kind)
      .map((venue) => ({ venue, score: score(venue, query) }))
      .sort((a, b) => b.score - a.score)
      .map(({ venue }) => ({
        place: toPlace(venue),
        venue: {
          id: venue.id,
          placeId: venue.id,
          kind: venue.kind,
          priceMinCents: venue.priceMinCents,
          priceMaxCents: venue.priceMaxCents,
          durationMinutes: venue.durationMinutes,
          hours: venue.hours,
          phone: venue.phone,
          facts: venue.facts as Record<string, Fact>,
          fetchedAt: FETCHED_AT,
        },
      }));
  }

  async travelMinutes(origins: Place[], destinations: Place[]): Promise<TravelTime[]> {
    return origins.flatMap((from) =>
      destinations.map((to) => ({
        fromPlaceId: from.id,
        toPlaceId: to.id,
        minutes: from.id === to.id ? 0 : Math.round((distanceKm(from, to) / 35) * 60) + 4,
        fetchedAt: FETCHED_AT,
      })),
    );
  }
}

export const sampleCenter: Area = { label: sampleData.center.label, lat: sampleData.center.lat, lng: sampleData.center.lng, radiusKm: 15 };
