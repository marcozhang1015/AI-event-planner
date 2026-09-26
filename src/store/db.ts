import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Answer, Delivery, Event, Handle, Member, MessageLog, Person, Place, Plan, Session, Venue, Verification } from "../shared/types";

// 每张表一列 JSON（data），需要查询的字段单独成列。hackathon 版不做迁移：改结构就重置数据库（bun run reset-demo --empty）。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, organizer TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (event_id TEXT NOT NULL, handle TEXT NOT NULL, link_token TEXT NOT NULL UNIQUE, data TEXT NOT NULL, PRIMARY KEY (event_id, handle));
CREATE TABLE IF NOT EXISTS answers (event_id TEXT NOT NULL, handle TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, handle));
CREATE TABLE IF NOT EXISTS sessions (handle TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (handle TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS venues (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verifications (event_id TEXT NOT NULL, venue_id TEXT NOT NULL, fact TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, venue_id, fact));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, handle TEXT NOT NULL, direction TEXT NOT NULL, at TEXT NOT NULL, handled_at TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_pending ON messages (handle, handled_at);
CREATE TABLE IF NOT EXISTS deliveries (plan_id TEXT NOT NULL, handle TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (plan_id, handle, channel, kind));
CREATE TABLE IF NOT EXISTS scheduled (id TEXT PRIMARY KEY, handle TEXT NOT NULL, due_at TEXT NOT NULL, data TEXT NOT NULL);
`;

const TABLES = ["events", "members", "answers", "sessions", "people", "places", "venues", "plans", "verifications", "messages", "deliveries", "scheduled"];

interface DataRow {
  data: string;
}

function parse<T>(row: DataRow | null): T | undefined {
  return row ? (JSON.parse(row.data) as T) : undefined;
}

function parseAll<T>(rows: DataRow[]): T[] {
  return rows.map((row) => JSON.parse(row.data) as T);
}

/** 行 id：前缀加 12 位随机字符，比如 evt_1a2b3c4d5e6f。 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** 个人网页链接用的 token：随机长串，不可猜。 */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

/** 存起来等到点再发的东西（夜间免打扰时发给别人的消息）。 */
export interface Scheduled<T> {
  id: string;
  /** 收件人。 */
  handle: Handle;
  dueAt: string;
  item: T;
}

export class Store {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  /** 可以嵌套：内层用 savepoint，外层回滚时一起回滚。 */
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
    this.db.query("INSERT OR REPLACE INTO events (id, organizer, data) VALUES (?, ?, ?)").run(event.id, event.organizer, JSON.stringify(event));
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
    return parse(this.db.query<DataRow, [string, string]>("SELECT data FROM members WHERE event_id = ? AND handle = ?").get(eventId, handle));
  }

  membersOf(eventId: string): Member[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM members WHERE event_id = ? ORDER BY rowid").all(eventId));
  }

  memberByToken(token: string): Member | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM members WHERE link_token = ?").get(token));
  }

  // answers

  saveAnswer(answer: Answer): void {
    this.db.query("INSERT OR REPLACE INTO answers (event_id, handle, data) VALUES (?, ?, ?)").run(answer.eventId, answer.handle, JSON.stringify(answer));
  }

  getAnswer(eventId: string, handle: Handle): Answer | undefined {
    return parse(this.db.query<DataRow, [string, string]>("SELECT data FROM answers WHERE event_id = ? AND handle = ?").get(eventId, handle));
  }

  answersOf(eventId: string): Answer[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM answers WHERE event_id = ? ORDER BY rowid").all(eventId));
  }

  // sessions

  saveSession(session: Session): void {
    this.db.query("INSERT OR REPLACE INTO sessions (handle, data) VALUES (?, ?)").run(session.handle, JSON.stringify(session));
  }

  getSession(handle: Handle): Session | undefined {
    return parse(this.db.query<DataRow, [string]>("SELECT data FROM sessions WHERE handle = ?").get(handle));
  }

  /** 摘要发出去之后记下它的消息 id（对它点 👍 算确认）。只改这一个字段，不覆盖别的回合写的会话。 */
  setSummaryMessageId(handle: Handle, messageId: string): void {
    const session = this.getSession(handle);
    if (session?.awaiting === "summary_confirm") this.saveSession({ ...session, summaryMessageId: messageId });
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

  // places, venues：地图数据，同一个 id 内容不变

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

  getVerification(eventId: string, venueId: string, fact: string): Verification | undefined {
    return parse(
      this.db
        .query<DataRow, [string, string, string]>("SELECT data FROM verifications WHERE event_id = ? AND venue_id = ? AND fact = ?")
        .get(eventId, venueId, fact),
    );
  }

  verificationsOf(eventId: string): Verification[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM verifications WHERE event_id = ? ORDER BY rowid").all(eventId));
  }

  saveDelivery(delivery: Delivery): void {
    this.db
      .query("INSERT OR REPLACE INTO deliveries (plan_id, handle, channel, kind, data) VALUES (?, ?, ?, ?, ?)")
      .run(delivery.planId, delivery.handle, delivery.channel, delivery.kind, JSON.stringify(delivery));
  }

  deliveriesOf(planId: string): Delivery[] {
    return parseAll(this.db.query<DataRow, [string]>("SELECT data FROM deliveries WHERE plan_id = ? ORDER BY rowid").all(planId));
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
        .query<DataRow, [string]>("SELECT data FROM messages WHERE handle = ? AND direction = 'inbound' AND handled_at IS NULL ORDER BY at, rowid")
        .all(handle),
    );
  }

  /** 还有没处理完的消息的人（重启后补处理）。 */
  pendingHandles(): Handle[] {
    return this.db
      .query<{ handle: string }, []>("SELECT DISTINCT handle FROM messages WHERE direction = 'inbound' AND handled_at IS NULL ORDER BY handle")
      .all()
      .map((row) => row.handle);
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
      .query<DataRow, [string, number]>("SELECT data FROM messages WHERE handle = ? AND handled_at IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT ?")
      .all(handle, limit);
    return parseAll<MessageLog>(rows).reverse();
  }

  // scheduled：到点再发

  schedule<T>(entry: Scheduled<T>): void {
    this.db
      .query("INSERT OR REPLACE INTO scheduled (id, handle, due_at, data) VALUES (?, ?, ?, ?)")
      .run(entry.id, entry.handle, entry.dueAt, JSON.stringify(entry.item));
  }

  /** 到点了的：取出来的同时删掉，最多发一次。 */
  takeDue<T>(now: string): Scheduled<T>[] {
    const rows = this.db
      .query<{ id: string; handle: string; due_at: string; data: string }, [string]>(
        "SELECT id, handle, due_at, data FROM scheduled WHERE due_at <= ? ORDER BY due_at, rowid",
      )
      .all(now);
    if (rows.length) {
      const remove = this.db.query("DELETE FROM scheduled WHERE id = ?");
      this.transaction(() => {
        for (const row of rows) remove.run(row.id);
      });
    }
    return rows.map((row) => ({ id: row.id, handle: row.handle, dueAt: row.due_at, item: JSON.parse(row.data) as T }));
  }

  /** 还有消息排着队等发的人（看板上显示"scheduled"）。 */
  scheduledHandles(): Set<Handle> {
    return new Set(this.db.query<{ handle: string }, []>("SELECT DISTINCT handle FROM scheduled").all().map((row) => row.handle));
  }
}
