// 隐私投影（§5.11）：网页 API、iMessage 模板和 LLM 上下文都从这里取数据。

import type { AttendeeView, MapPin, OrganizerView, PublicEvent } from "../api/dto";
import type { Store } from "../db";
import type { Answer, Event, Member } from "../types";
import { weekdayName } from "./time";

export function publicEvent(event: Event): PublicEvent {
  return {
    title: event.title,
    status: event.status,
    day: event.day,
    dayName: event.day ? weekdayName(event.day) : undefined,
    window: event.window,
    area: event.area?.label,
    budgetCapCents: event.budgetCapCents,
    timezone: event.timezone,
    inputVersion: event.inputVersion,
  };
}

function organizerName(store: Store, event: Event): string {
  return store.getMember(event.id, event.organizer)?.name ?? "The organizer";
}

function pickupPin(store: Store, answer: Answer | undefined): MapPin | undefined {
  const place = answer?.pickupPlaceId ? store.getPlace(answer.pickupPlaceId) : undefined;
  return place ? { id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: "pickup" } : undefined;
}

function venuePins(store: Store, event: Event): MapPin[] {
  return event.candidateVenueIds.flatMap((id) => {
    const venue = store.getVenue(id);
    const place = venue ? store.getPlace(venue.placeId) : undefined;
    return venue && place ? [{ id: place.id, name: place.name, lat: place.lat, lng: place.lng, kind: venue.kind }] : [];
  });
}

export function organizerView(store: Store, event: Event): OrganizerView {
  const members = store.membersOf(event.id);
  const answers = new Map(store.answersOf(event.id).map((answer) => [answer.handle, answer]));
  const confirmed = [...answers.values()].filter((answer) => answer.confirmed);
  const pickups = members.flatMap((member) => pickupPin(store, answers.get(member.handle)) ?? []);
  const attendees = members.filter((member) => member.role === "attendee");
  return {
    role: "organizer",
    event: publicEvent(event),
    organizerName: organizerName(store, event),
    members: members.map((member) => ({
      name: member.name,
      role: member.role,
      status: member.status,
      pickup: pickupPin(store, answers.get(member.handle))?.name,
    })),
    counts: {
      total: attendees.length,
      confirmed: attendees.filter((member) => member.status === "confirmed").length,
      waiting: attendees.filter((member) => member.status !== "confirmed" && member.status !== "declined").length,
    },
    aggregates: {
      allergies: [...new Set(confirmed.flatMap((answer) => answer.allergies ?? []))].sort(),
      drivers: confirmed.filter((answer) => answer.drives === "yes" || answer.drives === "if_needed").length,
      seats: confirmed.reduce((sum, answer) => sum + (answer.drives === "no" ? 0 : (answer.seats ?? 0)), 0),
      needRides: confirmed.filter((answer) => answer.drives === "no").length,
    },
    pins: [...new Map([...pickups, ...venuePins(store, event)].map((pin) => [pin.id, pin])).values()],
  };
}

export function attendeeView(store: Store, event: Event, member: Member): AttendeeView {
  const answer = store.getAnswer(event.id, member.handle);
  const pickup = pickupPin(store, answer);
  return {
    role: "attendee",
    event: publicEvent(event),
    organizerName: organizerName(store, event),
    me: {
      name: member.name,
      status: member.status,
      hasEmail: Boolean(member.email),
      answer: {
        free: answer?.free,
        homeBy: answer?.homeBy,
        budgetCapCents: answer?.budgetCapCents,
        allergies: answer?.allergies,
        diet: answer?.diet,
        drives: answer?.drives,
        seats: answer?.seats,
        pickup: pickup?.name,
        confirmed: answer?.confirmed ?? false,
      },
    },
    // TODO(A, M3)：出方案后加上自己的路线和同车人
    pins: pickup ? [pickup] : [],
  };
}

/** 给 Claude 的上下文只含这个人自己的字段（§5.4 上下文最小化）。 */
export function ownFields(answer: Answer): Record<string, unknown> {
  const { eventId: _eventId, handle: _handle, version: _version, pickupPlaceId: _placeId, ...fields } = answer;
  return fields;
}
