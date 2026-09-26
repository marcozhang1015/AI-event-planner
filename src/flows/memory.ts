// 跨活动记忆（hackathon-plan.md §6 有余力第 1 项）。
// 规则：只记本人确认过的、不随活动变化的偏好；下次先预填成"待确认"，本人确认后才用；只在本人私聊里用；"forget me" 就删。

import { distanceKm } from "../maps/geo";
import type { Answer, AnswerPatch, Area, Member, Person, Place } from "../types";

export function hasProfile(person: Person | undefined): person is Person {
  return Boolean(person && (person.allergies || person.diet || person.drives));
}

/** 本人确认摘要之后调用：记下这次确认过的偏好。 */
export function remember(previous: Person | undefined, member: Member, answer: Answer, now: Date): Person {
  return {
    handle: member.handle,
    name: member.name,
    email: member.email ?? previous?.email,
    allergies: answer.allergies,
    diet: answer.diet ?? previous?.diet,
    drives: answer.drives,
    seats: answer.seats,
    pickupQuery: answer.pickupQuery,
    pickupPlaceId: answer.pickupPlaceId,
    updatedAt: now.toISOString(),
  };
}

/** 记住的集合点离这次活动太远（换了城市），就不预填，重新问。 */
function isNearby(place: Place | undefined, area: Area | undefined): boolean {
  if (!place) return false;
  if (area?.lat === undefined || area.lng === undefined) return true;
  return distanceKm(place, { lat: area.lat, lng: area.lng }) <= area.radiusKm * 2;
}

/** 邀请时用记忆预填，标成 remembered：这次还要请本人确认一句。 */
export function prefill(answer: Answer, person: Person, area: Area | undefined, pickup: Place | undefined): Answer {
  const keepPickup = isNearby(pickup, area);
  return {
    ...answer,
    allergies: person.allergies,
    diet: person.diet,
    drives: person.drives,
    seats: person.seats,
    pickupQuery: keepPickup ? person.pickupQuery : undefined,
    pickupPlaceId: keepPickup ? person.pickupPlaceId : undefined,
    remembered: true,
  };
}

/** 本人说记忆不对、又没说哪里不对：清掉预填的偏好，一项项重新问。 */
export function dropRemembered(answer: Answer): Answer {
  const { allergies: _allergies, diet: _diet, drives: _drives, seats: _seats, pickupQuery: _query, pickupPlaceId: _place, ...rest } = answer;
  return { ...rest, remembered: false };
}

/** 这次回复里有没有改记忆里的那几项。 */
export function correctsProfile(patch: AnswerPatch): boolean {
  return patch.allergies !== undefined || patch.diet !== undefined || patch.drives !== undefined || patch.seats !== undefined || patch.pickupQuery !== undefined;
}

const FORGET_ME = /\bforget (?:me|about me|my (?:info|details|data))\b|\bdelete my (?:info|details|data)\b|忘掉我|忘了我|删除我的/i;

export function isForgetMe(text: string): boolean {
  return FORGET_ME.test(text);
}
