import type { Store } from "../db";
import type { Answer, Event, Handle, Member, Person, Place, Session, Venue } from "../types";

/**
 * 一轮对话里的全部数据改动。flow 只通过它读写；管线确认这一轮没有过期（处理期间没来新消息）之后才 commit()，
 * 过期就整个丢掉、和新消息合并后重跑（§5.3）。所以 flow 里绝不能直接写 Store。
 * 不同的人同时说话时，后提交的覆盖先提交的；hackathon 规模可以接受。
 */
export class ChangeSet {
  private readonly events = new Map<string, Event>();
  private readonly members = new Map<string, Member>();
  private readonly answers = new Map<string, Answer>();
  private readonly sessions = new Map<Handle, Session>();
  /** null 表示这一轮要删掉（"forget me"）。 */
  private readonly people = new Map<Handle, Person | null>();
  private readonly places = new Map<string, Place>();
  private readonly venues = new Map<string, Venue>();

  constructor(readonly store: Store) {}

  event(id: string): Event | undefined {
    return this.events.get(id) ?? this.store.getEvent(id);
  }

  putEvent(event: Event): void {
    this.events.set(event.id, event);
  }

  member(eventId: string, handle: Handle): Member | undefined {
    return this.members.get(`${eventId}|${handle}`) ?? this.store.getMember(eventId, handle);
  }

  putMember(member: Member): void {
    this.members.set(`${member.eventId}|${member.handle}`, member);
  }

  membersOf(eventId: string): Member[] {
    const merged = new Map(this.store.membersOf(eventId).map((member) => [member.handle, member]));
    for (const member of this.members.values()) {
      if (member.eventId === eventId) merged.set(member.handle, member);
    }
    return [...merged.values()];
  }

  answer(eventId: string, handle: Handle): Answer | undefined {
    return this.answers.get(`${eventId}|${handle}`) ?? this.store.getAnswer(eventId, handle);
  }

  putAnswer(answer: Answer): void {
    this.answers.set(`${answer.eventId}|${answer.handle}`, answer);
  }

  session(handle: Handle): Session {
    return this.sessions.get(handle) ?? this.store.getSession(handle);
  }

  putSession(session: Session): void {
    this.sessions.set(session.handle, session);
  }

  person(handle: Handle): Person | undefined {
    const staged = this.people.get(handle);
    return staged === null ? undefined : (staged ?? this.store.getPerson(handle));
  }

  putPerson(person: Person): void {
    this.people.set(person.handle, person);
  }

  forgetPerson(handle: Handle): void {
    this.people.set(handle, null);
  }

  place(id: string): Place | undefined {
    return this.places.get(id) ?? this.store.getPlace(id);
  }

  putPlace(place: Place): void {
    this.places.set(place.id, place);
  }

  putVenue(venue: Venue): void {
    this.venues.set(venue.id, venue);
  }

  commit(): void {
    this.store.transaction(() => {
      for (const event of this.events.values()) this.store.saveEvent(event);
      for (const member of this.members.values()) this.store.saveMember(member);
      for (const answer of this.answers.values()) this.store.saveAnswer(answer);
      for (const session of this.sessions.values()) this.store.saveSession(session);
      for (const [handle, person] of this.people) {
        if (person) this.store.savePerson(person);
        else this.store.deletePerson(handle);
      }
      for (const place of this.places.values()) this.store.savePlace(place);
      for (const venue of this.venues.values()) this.store.saveVenue(venue);
    });
  }
}
