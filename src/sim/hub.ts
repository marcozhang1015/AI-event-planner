// 模拟器的中转站：浏览器（WebSocket）⇄ SimHub ⇄ Spectrum 的 sim provider。
// 对话只存在内存里：服务重启后网页上的记录会清空，agent 这边的数据仍在 SQLite 里。

import type { Content } from "spectrum-ts";
import type { SimClientEvent, SimItem, SimPerson, SimReaction, SimServerEvent } from "./protocol";

/** 交给 Spectrum 的入站消息（provider 的 messages 流产出的记录）。 */
export interface SimInbound {
  id: string;
  content: Content;
  sender: { id: string };
  space: { id: string };
  timestamp: Date;
}

export interface SimSocket {
  send(data: string): unknown;
}

export class SimHub {
  private readonly threads = new Map<string, SimItem[]>();
  private readonly typing = new Set<string>();
  private readonly sockets = new Set<SimSocket>();
  private readonly queue: SimInbound[] = [];
  private waiter?: (result: IteratorResult<SimInbound>) => void;
  private closed = false;

  constructor(readonly people: SimPerson[]) {}

  attach(socket: SimSocket): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify(this.snapshot()));
  }

  detach(socket: SimSocket): void {
    this.sockets.delete(socket);
  }

  snapshot(): SimServerEvent {
    return { type: "snapshot", people: this.people, threads: Object.fromEntries(this.threads), typing: [...this.typing] };
  }

  thread(person: string): SimItem[] {
    return this.threads.get(person) ?? [];
  }

  /** 浏览器发来的事件。格式不对的直接忽略。 */
  receive(raw: string): void {
    let event: SimClientEvent;
    try {
      event = JSON.parse(raw) as SimClientEvent;
    } catch {
      return;
    }
    if (!this.people.some((person) => person.id === event.person)) return;
    if (event.type === "send" && event.text.trim()) this.userSends(event.person, event.text.trim());
    if (event.type === "react") this.userReacts(event.person, event.targetId, event.emoji);
  }

  userSends(person: string, text: string): SimItem {
    const item = this.push(person, { from: "user", kind: "text", text });
    this.enqueue({ id: item.id, content: { type: "text", text }, sender: { id: person }, space: { id: person }, timestamp: new Date() });
    return item;
  }

  userReacts(person: string, targetId: string, emoji: string): void {
    const target = this.thread(person).find((item) => item.id === targetId);
    if (!target) return;
    this.react(person, target, { by: "user", emoji });
    this.enqueue({
      id: `sim_${crypto.randomUUID()}`,
      content: {
        type: "reaction",
        emoji,
        // 被点的那条是 agent 发的：方向标成 outbound（Spectrum 默认沿用外层的 inbound）
        target: { id: target.id, content: { type: "text", text: target.text }, direction: target.from === "agent" ? "outbound" : "inbound", space: { id: person } },
      } as unknown as Content,
      sender: { id: person },
      space: { id: person },
      timestamp: new Date(),
    });
  }

  agentSends(person: string, item: Pick<SimItem, "kind" | "text" | "url" | "effect">): SimItem {
    return this.push(person, { from: "agent", ...item });
  }

  agentReacts(person: string, targetId: string, emoji: string): void {
    const target = this.thread(person).find((item) => item.id === targetId);
    if (target) this.react(person, target, { by: "agent", emoji });
  }

  setTyping(person: string, on: boolean): void {
    if (on === this.typing.has(person)) return;
    if (on) this.typing.add(person);
    else this.typing.delete(person);
    this.broadcast({ type: "typing", person, on });
  }

  /**
   * sim provider 的 messages 流。不用 async generator：generator 停在 await 上时，
   * Spectrum 关流要等它返回（会卡满 5 秒超时）；自己实现的迭代器可以在 return() 时立刻结束。
   */
  inbound(): AsyncIterableIterator<SimInbound> {
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ done: false, value: queued });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: async () => {
        this.close();
        return { done: true, value: undefined };
      },
    };
  }

  close(): void {
    this.closed = true;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.({ done: true, value: undefined });
  }

  private push(person: string, item: Omit<SimItem, "id" | "at" | "reactions">): SimItem {
    const full: SimItem = { id: `sim_${crypto.randomUUID()}`, at: new Date().toISOString(), reactions: [], ...item };
    this.threads.set(person, [...this.thread(person), full]);
    // agent 发出消息，说明它这一段打字结束了
    if (item.from === "agent") this.setTyping(person, false);
    this.broadcast({ type: "item", person, item: full });
    return full;
  }

  /** 和 iMessage 一样，同一个人对同一条消息只保留一个 tapback。 */
  private react(person: string, target: SimItem, reaction: SimReaction): void {
    target.reactions = [...target.reactions.filter((existing) => existing.by !== reaction.by), reaction];
    this.broadcast({ type: "reaction", person, targetId: target.id, reaction });
  }

  private enqueue(record: SimInbound): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter({ done: false, value: record });
    else this.queue.push(record);
  }

  private broadcast(event: SimServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) socket.send(json);
  }
}
