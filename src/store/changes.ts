// 一轮对话的读写（ChangeSet，乐观事务）、只读视图（Reader），以及几个常用查询。

import type { Answer, Candidate, Delivery, Event, Handle, Member, Person, Place, Plan, PlanOption, PublishedRef, Session, Venue, Verification } from "../shared/types";
import type { Store } from "./db";

/** 提交时发现，这一轮读过或要写的某一行已经被别的回合改了。管线会用新数据重跑这一轮。 */
export class StaleWriteError extends Error {
  constructor(readonly row: string) {
    super(`stale write: ${row}`);
    this.name = "StaleWriteError";
  }
}

interface Staged {
  value: unknown;
  save: () => void;
  current: () => unknown;
  /** 地点、场地是幂等的参考数据，不做冲突比对。 */
  checked: boolean;
}

function snapshot(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : JSON.stringify(value);
}

/**
 * 一轮对话里的全部数据改动，也是这一轮看到的数据（乐观事务）。
 * - flow 只通过它读写。管线确认这一轮没有过期（处理期间没来新消息）之后才 commit()；过期就整个丢掉，和新消息合并后重跑（§5.3）。
 * - 每一行第一次被读到，或者没读过就直接写时，记下它在库里的样子；commit() 在事务里逐行比对，
 *   有别的回合先改了，就抛 StaleWriteError，这一轮用新数据重跑。
 * 所以 flow 里绝不能直接写 Store。网页 API 也用它读数据（只读，不 commit）。
 */
export class ChangeSet {
  private readonly staged = new Map<string, Staged>();
  private readonly seen = new Map<string, string | undefined>();

  constructor(readonly store: Store) {}

  // 通用读写

  private read<T>(id: string, load: () => T | undefined): T | undefined {
    const staged = this.staged.get(id);
    if (staged) return (staged.value ?? undefined) as T | undefined;
    const value = load();
    this.see(id, value);
    return value;
  }

  private see(id: string, value: unknown): void {
    if (!this.seen.has(id)) this.seen.set(id, snapshot(value));
  }

  private write(id: string, value: unknown, save: () => void, current: () => unknown, checked = true): void {
    if (!this.seen.has(id)) this.seen.set(id, snapshot(current()));
    this.staged.set(id, { value, save, current, checked });
  }

  /** 库里的列表叠上这一轮暂存的改动。`idOf` 给出每一行的 id；id 以 `prefix` 开头的暂存行属于这个列表。 */
  private list<T>(rows: T[], idOf: (row: T) => string, prefix: string): T[] {
    const merged = new Map<string, T>();
    for (const row of rows) {
      const id = idOf(row);
      this.see(id, row);
      merged.set(id, row);
    }
    for (const [id, row] of this.staged) {
      if (!id.startsWith(prefix)) continue;
      if (row.value === null) merged.delete(id);
      else merged.set(id, row.value as T);
    }
    return [...merged.values()];
  }

  // events

  event(id: string): Event | undefined {
    return this.read(`event|${id}`, () => this.store.getEvent(id));
  }

  putEvent(event: Event): void {
    this.write(`event|${event.id}`, event, () => this.store.saveEvent(event), () => this.store.getEvent(event.id));
  }

  // members

  member(eventId: string, handle: Handle): Member | undefined {
    return this.read(`member|${eventId}|${handle}`, () => this.store.getMember(eventId, handle));
  }

  membersOf(eventId: string): Member[] {
    return this.list(this.store.membersOf(eventId), (member) => `member|${eventId}|${member.handle}`, `member|${eventId}|`);
  }

  putMember(member: Member): void {
    this.write(
      `member|${member.eventId}|${member.handle}`,
      member,
      () => this.store.saveMember(member),
      () => this.store.getMember(member.eventId, member.handle),
    );
  }

  // answers

  answer(eventId: string, handle: Handle): Answer | undefined {
    return this.read(`answer|${eventId}|${handle}`, () => this.store.getAnswer(eventId, handle));
  }

  answersOf(eventId: string): Answer[] {
    return this.list(this.store.answersOf(eventId), (answer) => `answer|${eventId}|${answer.handle}`, `answer|${eventId}|`);
  }

  putAnswer(answer: Answer): void {
    this.write(
      `answer|${answer.eventId}|${answer.handle}`,
      answer,
      () => this.store.saveAnswer(answer),
      () => this.store.getAnswer(answer.eventId, answer.handle),
    );
  }

  // sessions

  session(handle: Handle): Session {
    return this.read(`session|${handle}`, () => this.store.getSession(handle)) ?? { handle };
  }

  putSession(session: Session): void {
    this.write(`session|${session.handle}`, session, () => this.store.saveSession(session), () => this.store.getSession(session.handle));
  }

  // people：跨活动记忆

  person(handle: Handle): Person | undefined {
    return this.read(`person|${handle}`, () => this.store.getPerson(handle));
  }

  putPerson(person: Person): void {
    this.write(`person|${person.handle}`, person, () => this.store.savePerson(person), () => this.store.getPerson(person.handle));
  }

  forgetPerson(handle: Handle): void {
    this.write(`person|${handle}`, null, () => this.store.deletePerson(handle), () => this.store.getPerson(handle));
  }

  // places, venues：参考数据

  place(id: string): Place | undefined {
    return this.read(`place|${id}`, () => this.store.getPlace(id));
  }

  putPlace(place: Place): void {
    this.write(`place|${place.id}`, place, () => this.store.savePlace(place), () => undefined, false);
  }

  venue(id: string): Venue | undefined {
    return this.read(`venue|${id}`, () => this.store.getVenue(id));
  }

  putVenue(venue: Venue): void {
    this.write(`venue|${venue.id}`, venue, () => this.store.saveVenue(venue), () => undefined, false);
  }

  // plans

  plan(id: string): Plan | undefined {
    return this.read(`plan|${id}`, () => this.store.getPlan(id));
  }

  /** 最新的方案：这一轮刚求解出来的优先（按暂存顺序，最后一个最新）。 */
  latestPlan(eventId: string): Plan | undefined {
    let latest: Plan | undefined;
    for (const [id, row] of this.staged) {
      if (id.startsWith("plan|") && (row.value as Plan).eventId === eventId) latest = row.value as Plan;
    }
    return latest ?? this.store.latestPlan(eventId);
  }

  putPlan(plan: Plan): void {
    this.write(`plan|${plan.id}`, plan, () => this.store.savePlan(plan), () => this.store.getPlan(plan.id));
  }

  // verifications

  verificationsOf(eventId: string): Verification[] {
    return this.list(
      this.store.verificationsOf(eventId),
      (v) => `verification|${eventId}|${v.venueId}|${v.fact}`,
      `verification|${eventId}|`,
    );
  }

  putVerification(verification: Verification): void {
    const { eventId, venueId, fact } = verification;
    this.write(
      `verification|${eventId}|${venueId}|${fact}`,
      verification,
      () => this.store.saveVerification(verification),
      () => this.store.getVerification(eventId, venueId, fact),
    );
  }

  // 管线直接写的记录：只读

  deliveriesOf(planId: string): Delivery[] {
    return this.store.deliveriesOf(planId);
  }

  scheduledHandles(): Set<Handle> {
    return this.store.scheduledHandles();
  }

  /** 比对、写入，再跑 `then`（管线用它把消息标成已处理），全在一个事务里。 */
  commit(then?: () => void): void {
    this.store.transaction(() => {
      for (const [id, row] of this.staged) {
        if (row.checked && snapshot(row.current()) !== this.seen.get(id)) throw new StaleWriteError(id);
      }
      for (const row of this.staged.values()) row.save();
      then?.();
    });
  }
}

/** 只读视图（网页 API、模板、求解输入）需要的那部分。 */
export type Reader = Pick<
  ChangeSet,
  | "event"
  | "member"
  | "membersOf"
  | "answer"
  | "answersOf"
  | "session"
  | "place"
  | "venue"
  | "plan"
  | "latestPlan"
  | "verificationsOf"
  | "deliveriesOf"
  | "scheduledHandles"
>;

// 常用查询：都经过 Reader，所以一轮对话里读到的行也参与提交时的冲突比对。

export interface Participant {
  member: Member;
  answer: Answer;
}

/** 参与这场活动的人：受邀的人，加上报名参加的组织者（有答案的才算）。谢绝的人不算。 */
export function participantsOf(db: Reader, event: Event): Participant[] {
  return db.membersOf(event.id).flatMap((member) => {
    const answer = member.status === "declined" ? undefined : db.answer(event.id, member.handle);
    return answer ? [{ member, answer }] : [];
  });
}

/** 已发布（或上一次发布）的那个选项。 */
export function publishedOption(db: Reader, ref: PublishedRef | undefined): PlanOption | undefined {
  return ref ? db.plan(ref.planId)?.options.find((option) => option.label === ref.label) : undefined;
}

/** 这些场地和它们的地点；缺了数据的跳过。 */
export function venuesOf(db: Reader, venueIds: string[]): Candidate[] {
  return venueIds.flatMap((id) => {
    const venue = db.venue(id);
    const place = venue ? db.place(venue.placeId) : undefined;
    return venue && place ? [{ venue, place }] : [];
  });
}

export function organizerName(db: Reader, event: Event): string {
  return db.member(event.id, event.organizer)?.name ?? "The organizer";
}
