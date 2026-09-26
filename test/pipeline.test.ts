import { describe, expect, test } from "bun:test";
import type { ContentInput, Message, Space } from "spectrum-ts";
import { Store } from "../src/db";
import type { Outbound, Turn } from "../src/flows/context";
import { Pipeline } from "../src/io/pipeline";
import type { TransportLike } from "../src/io/transport";

const HANDLE = "+15550000002";

class FakeSpace {
  readonly sent: ContentInput[] = [];
  readonly id = "any;-;+15550000002";
  readonly __platform = "terminal";
  async send(content: ContentInput) {
    this.sent.push(content);
    return { id: `sent_${this.sent.length}` } as unknown as Message;
  }
  async responding<T>(fn: () => T | Promise<T>): Promise<T> {
    return fn();
  }
}

class FakeTransport implements TransportLike {
  readonly space = new FakeSpace();
  handleOf(_space: Space, message: Message) {
    return message.sender?.id;
  }
  remember() {}
  async spaceFor() {
    return this.space as unknown as Space;
  }
}

let seq = 0;
function textMessage(text: string, id = `msg_${++seq}`): Message {
  return {
    id,
    direction: "inbound",
    platform: "imessage",
    content: { type: "text", text },
    timestamp: new Date(Date.UTC(2026, 8, 24, 15, 0, seq)),
    sender: { id: HANDLE, __platform: "imessage" },
    react: async () => undefined,
  } as unknown as Message;
}

function setUp(handle: (turn: Turn, call: number) => Promise<Outbound[]>) {
  const store = new Store(":memory:");
  const transport = new FakeTransport();
  const turns: Turn[] = [];
  const pipeline = new Pipeline({
    store,
    transport,
    debounceMs: 10,
    paceMs: 0,
    handle: async (_db, turn) => {
      turns.push(turn);
      return handle(turn, turns.length);
    },
  });
  const space = transport.space as unknown as Space;
  return { store, transport, turns, pipeline, space };
}

const echo = async (turn: Turn): Promise<Outbound[]> => [{ kind: "send", to: turn.handle, parts: [turn.incoming.map((item) => item.text).join(" + ")] }];

describe("管线", () => {
  test("同一个 id 重复投递只处理一次", async () => {
    const { turns, pipeline, space, transport } = setUp(echo);
    const message = textMessage("hey", "dup");
    pipeline.enqueue(space, message);
    pipeline.enqueue(space, message);
    await Bun.sleep(50);
    expect(turns).toHaveLength(1);
    expect(transport.space.sent).toEqual(["hey"]);
  });

  test("debounce 窗口内的连发合并成一轮", async () => {
    const { turns, pipeline, space, transport } = setUp(echo);
    pipeline.enqueue(space, textMessage("hey"));
    pipeline.enqueue(space, textMessage("wait"));
    pipeline.enqueue(space, textMessage("actually"));
    await Bun.sleep(50);
    expect(turns).toHaveLength(1);
    expect(transport.space.sent).toEqual(["hey + wait + actually"]);
  });

  test("处理期间来了新消息：这一轮作废，合并后重跑，只回复一次", async () => {
    let enqueueLate: () => void = () => {};
    const { turns, pipeline, space, transport, store } = setUp(async (turn, call) => {
      if (call === 1) enqueueLate();
      return echo(turn);
    });
    enqueueLate = () => pipeline.enqueue(space, textMessage("do you know if the train runs on holidays"));

    pipeline.enqueue(space, textMessage("hey"));
    await Bun.sleep(80);
    expect(turns).toHaveLength(2);
    expect(turns[1]?.incoming.map((item) => item.text)).toEqual(["hey", "do you know if the train runs on holidays"]);
    expect(transport.space.sent).toEqual(["hey + do you know if the train runs on holidays"]);
    expect(store.pendingFor(HANDLE)).toHaveLength(0);
  });

  test("非 iMessage 平台：链接和庆祝消息发成纯文本（terminal 会直接丢掉 richlink）", async () => {
    const { pipeline, space, transport } = setUp(async (turn) => [
      { kind: "send", to: turn.handle, parts: [{ type: "link", url: "https://juno.test/o/abc" }, { type: "celebrate", text: "You're all set 🎉" }] },
    ]);
    pipeline.enqueue(space, textMessage("hi"));
    await Bun.sleep(50);
    expect(transport.space.sent).toEqual(["https://juno.test/o/abc", "You're all set 🎉"]);
  });

  test("自己发出的消息、已读回执不进管线", async () => {
    const { turns, pipeline, space } = setUp(echo);
    pipeline.enqueue(space, { ...textMessage("echo"), direction: "outbound" } as Message);
    pipeline.enqueue(space, { ...textMessage(""), content: { type: "read", target: textMessage("x") } } as unknown as Message);
    await Bun.sleep(50);
    expect(turns).toHaveLength(0);
  });
});
