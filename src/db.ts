import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Answer,
  Delivery,
  Event,
  Handle,
  Member,
  MessageLog,
  Person,
  Place,
  Plan,
  Session,
  TravelTime,
  Venue,
  Verification,
} from "./types";

// 每张表一列 JSON（data），需要查询的字段单独成列。hackathon 版不做迁移：改结构就重置数据库。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, organizer TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (event_id TEXT NOT NULL, handle TEXT NOT NULL, link_token TEXT NOT NULL UNIQUE, data TEXT NOT NULL, PRIMARY KEY (event_id, handle));
CREATE TABLE IF NOT EXISTS answers (event_id TEXT NOT NULL, handle TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, handle));
CREATE TABLE IF NOT EXISTS sessions (handle TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (handle TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS venues (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS travel_times (from_id TEXT NOT NULL, to_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verifications (event_id TEXT NOT NULL, venue_id TEXT NOT NULL, fact TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, venue_id, fact));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, handle TEXT NOT NULL, direction TEXT NOT NULL, at TEXT NOT NULL, handled_at TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_pending ON messages (handle, handled_at);
CREATE TABLE IF NOT EXISTS deliveries (plan_id TEXT NOT NULL, handle TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (plan_id, handle, channel, kind));
`;

const TABLES = ["events", "members", "answers", "sessions", "people", "places", "venues", "travel_times", "plans", "verifications", "messages", "deliveries"];

interface DataRow {
  data: string;
}

function parse<T>(row: DataRow | null): T | undefined {
  return row ? (JSON.parse(row.data) as T) : undefined;
}

function parseAll<T>(rows: DataRow[]): T[] {
  return rows.map((row) => JSON.parse(row.data) as T);
}

export class Store {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  reset(): void {
    this.transaction(() => {
      for (const table of TABLES) this.db.exec(`DELETE FROM ${table}`);
    });
  }

  // events

  saveEvent(event: Event): void {
    this.db
      .query("INSERT OR REPLACE INTO events (id, organizer, data) VALUES (?, ?, ?)")
      .run(event.id, event.organizer, JSON.stringify(event));
  }

  getEvent(id: string): Event | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM events WHERE id = ?").get(id));
  }

  listEvents(): Event[] {
    return parseAll(this.db.query<DataRow, []>("SELECT data FROM events ORDER BY rowid").all());
  }

  // members

  saveMember(member: Member): void {
    this.db
      .query("INSERT OR REPLACE INTO members (event_id, handle, link_token, data) VALUES (?, ?, ?, ?)")
      .run(member.eventId, member.handle, member.linkToken, JSON.stringify(member));
  }

  getMember(eventId: string, handle: Handle): Member | undefined {
    return parse(
      this.db.query<DataRow, [string, string]>("SELECT data FROM members WHERE event_id = ? AND handle = ?").get(eventId, handle),
    );
  }

  membersOf(eventId: string): Member[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM members WHERE event_id = ? ORDER BY rowid").all(eventId));
  }

  memberByToken(token: string): Member | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM members WHERE link_token = ?").get(token));
  }

  // answers

  saveAnswer(answer: Answer): void {
    this.db
      .query("INSERT OR REPLACE INTO answers (event_id, handle, data) VALUES (?, ?, ?)")
      .run(answer.eventId, answer.handle, JSON.stringify(answer));
  }

  getAnswer(eventId: string, handle: Handle): Answer | undefined {
    return parse(
      this.db.query<DataRow, [string, string]>("SELECT data FROM answers WHERE event_id = ? AND handle = ?").get(eventId, handle),
    );
  }

  answersOf(eventId: string): Answer[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM answers WHERE event_id = ? ORDER BY rowid").all(eventId));
  }

  // sessions

  saveSession(session: Session): void {
    this.db.query("INSERT OR REPLACE INTO sessions (handle, data) VALUES (?, ?)").run(session.handle, JSON.stringify(session));
  }

  getSession(handle: Handle): Session {
    return parse<Session>(this.db.query<DataRow, [string]>("SELECT data FROM sessions WHERE handle = ?").get(handle)) ?? { handle };
  }

  // people：跨活动记忆

  savePerson(person: Person): void {
    this.db.query("INSERT OR REPLACE INTO people (handle, data) VALUES (?, ?)").run(person.handle, JSON.stringify(person));
  }

  getPerson(handle: Handle): Person | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM people WHERE handle = ?").get(handle));
  }

  deletePerson(handle: Handle): void {
    this.db.query("DELETE FROM people WHERE handle = ?").run(handle);
  }

  // places, venues, travel times

  savePlace(place: Place): void {
    this.db.query("INSERT OR REPLACE INTO places (id, data) VALUES (?, ?)").run(place.id, JSON.stringify(place));
  }

  getPlace(id: string): Place | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM places WHERE id = ?").get(id));
  }

  saveVenue(venue: Venue): void {
    this.db.query("INSERT OR REPLACE INTO venues (id, data) VALUES (?, ?)").run(venue.id, JSON.stringify(venue));
  }

  getVenue(id: string): Venue | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM venues WHERE id = ?").get(id));
  }

  saveTravelTime(travel: TravelTime): void {
    this.db
      .query("INSERT OR REPLACE INTO travel_times (from_id, to_id, data) VALUES (?, ?, ?)")
      .run(travel.fromPlaceId, travel.toPlaceId, JSON.stringify(travel));
  }

  getTravelTime(fromPlaceId: string, toPlaceId: string): TravelTime | undefined {
    return parse(
      this.db
        .query<DataRow, [string, string]>("SELECT data FROM travel_times WHERE from_id = ? AND to_id = ?")
        .get(fromPlaceId, toPlaceId),
    );
  }

  // plans, verifications, deliveries

  savePlan(plan: Plan): void {
    this.db
      .query("INSERT OR REPLACE INTO plans (id, event_id, created_at, data) VALUES (?, ?, ?, ?)")
      .run(plan.id, plan.eventId, plan.createdAt, JSON.stringify(plan));
  }

  getPlan(id: string): Plan | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM plans WHERE id = ?").get(id));
  }

  latestPlan(eventId: string): Plan | undefined {
    return parse(
      this.db.query<DataRow, [string]>("SELECT data FROM plans WHERE event_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(eventId),
    );
  }

  saveVerification(verification: Verification): void {
    this.db
      .query("INSERT OR REPLACE INTO verifications (event_id, venue_id, fact, data) VALUES (?, ?, ?, ?)")
      .run(verification.eventId, verification.venueId, verification.fact, JSON.stringify(verification));
  }

  verificationsOf(eventId: string): Verification[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM verifications WHERE event_id = ?").all(eventId));
  }

  saveDelivery(delivery: Delivery): void {
    this.db
      .query("INSERT OR REPLACE INTO deliveries (plan_id, handle, channel, kind, data) VALUES (?, ?, ?, ?, ?)")
      .run(delivery.planId, delivery.handle, delivery.channel, delivery.kind, JSON.stringify(delivery));
  }

  deliveriesOf(planId: string): Delivery[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM deliveries WHERE plan_id = ?").all(planId));
  }

  // messages：去重、待处理队列、对话记录

  /** 新消息返回 true；同一个 id 第二次进来返回 false。 */
  insertInbound(message: MessageLog): boolean {
    const result = this.db
      .query("INSERT OR IGNORE INTO messages (id, handle, direction, at, data) VALUES (?, ?, 'inbound', ?, ?)")
      .run(message.id, message.handle, message.at, JSON.stringify(message));
    return result.changes > 0;
  }

  logOutbound(message: MessageLog): void {
    this.db
      .query("INSERT OR IGNORE INTO messages (id, handle, direction, at, handled_at, data) VALUES (?, ?, 'outbound', ?, ?, ?)")
      .run(message.id, message.handle, message.at, message.at, JSON.stringify(message));
  }

  pendingFor(handle: Handle): MessageLog[] {
    return parseAll(
      this.db
        .query<DataRow, [string]>(
          "SELECT data FROM messages WHERE handle = ? AND direction = 'inbound' AND handled_at IS NULL ORDER BY at, rowid",
        )
        .all(handle),
    );
  }

  markHandled(ids: string[], at: string): void {
    const update = this.db.query("UPDATE messages SET handled_at = ? WHERE id = ?");
    this.transaction(() => {
      for (const id of ids) update.run(at, id);
    });
  }

  /** 最近的对话记录（旧的在前），给 Claude 当上下文。 */
  historyFor(handle: Handle, limit: number): MessageLog[] {
    const rows = this.db
      .query<DataRow, [string, number]>(
        "SELECT data FROM messages WHERE handle = ? AND handled_at IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .all(handle, limit);
    return parseAll<MessageLog>(rows).reverse();
  }
}
