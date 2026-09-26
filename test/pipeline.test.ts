import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import type { Turn } from "../src/flows/context";
import { Pipeline } from "../src/io/pipeline";
import { say, summary, tell, type Outbound } from "../src/out/actions";
import type { EmailMessage, EmailSender } from "../src/out/email";
import type { Event } from "../src/shared/types";
import type { ChangeSet } from "../src/store/changes";
import { Store } from "../src/store/db";
import { FakeTransport } from "./harness";

const SAM = "+15550000002";
const ALEX = "+15550000001";
// Spectrum 的 iMessage 会话带 type：dm 或 group
const DM = { id: "any;-;+15550000002", type: "dm" } as unknown as Space;
const GROUP = { id: "iMessage;+;chat42", type: "group" } as unknown as Space;

class FakeEmail implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

let seq = 0;
function textMessage(text: string, options: { id?: string; sender?: string } = {}): Message {
  seq++;
  return {
    id: options.id ?? `msg_${seq}`,
    direction: "inbound",
    platform: "imessage",
    content: { type: "text", text },
    timestamp: new Date(Date.UTC(2026, 8, 24, 15, 0, seq)),
    sender: { id: options.sender ?? SAM, __platform: "imessage" },
    react: async () => undefined,
  } as unknown as Message;
}

const pipelines: Pipeline[] = [];
afterEach(async () => {
  for (const pipeline of pipelines.splice(0)) await pipeline.stop();
});

function setUp(handle: (turn: Turn, call: number, db: ChangeSet) => Promise<Outbound[]>, store = new Store(":memory:")) {
  const transport = new FakeTransport();
  const email = new FakeEmail();
  const turns: Turn[] = [];
  const pipeline = new Pipeline({
    store,
    transport,
    email,
    debounceMs: 10,
    paceMs: 0,
    timezone: "America/Chicago",
    now: () => new Date("2026-09-24T15:00:00Z"),
    handle: async (db, turn) => {
      turns.push(turn);
      return handle(turn, turns.length, db);
    },
  });
  pipelines.push(pipeline);
  return { store, transport, email, turns, pipeline };
}

const echo = async (turn: Turn): Promise<Outbound[]> => [say(turn.handle, turn.incoming.map((item) => item.text).join(" + "))];
function event(): Event {
  return { id: "evt", organizer: ALEX, title: "dinner", status: "COLLECTING", timezone: "America/Chicago", candidateVenueIds: [], inputVersion: 1, createdAt: "" };
}

describe("管线：收消息", () => {
  test("同一个 id 重复投递只处理一次", async () => {
    const { turns, pipeline, transport } = setUp(echo);
    const message = textMessage("hey", { id: "dup" });
    pipeline.enqueue(DM, message);
    pipeline.enqueue(DM, message);
    await pipeline.drain();
    expect(turns).toHaveLength(1);
    expect(transport.textsTo(SAM)).toEqual(["hey"]);
  });

  test("debounce 窗口内的连发合并成一轮", async () => {
    const { turns, pipeline, transport } = setUp(echo);
    for (const text of ["hey", "wait", "actually"]) pipeline.enqueue(DM, textMessage(text));
    await pipeline.drain();
    expect(turns).toHaveLength(1);
    expect(transport.textsTo(SAM)).toEqual(["hey + wait + actually"]);
  });

  test("处理期间来了新消息：这一轮作废，合并后重跑，只回复一次", async () => {
    let late: () => void = () => {};
    const { turns, pipeline, transport, store } = setUp(async (turn, call) => {
      if (call === 1) late();
      return echo(turn);
    });
    late = () => pipeline.enqueue(DM, textMessage("do you know if the train runs on holidays"));
    pipeline.enqueue(DM, textMessage("hey"));
    await pipeline.drain();
    expect(turns).toHaveLength(2);
    expect(turns[1]?.incoming.map((item) => item.text)).toEqual(["hey", "do you know if the train runs on holidays"]);
    expect(transport.textsTo(SAM)).toEqual(["hey + do you know if the train runs on holidays"]);
    expect(store.pendingFor(SAM)).toHaveLength(0);
  });

  test("自己发出的消息、已读回执不进管线", async () => {
    const { turns, pipeline } = setUp(echo);
    pipeline.enqueue(DM, { ...textMessage("echo"), direction: "outbound" } as Message);
    pipeline.enqueue(DM, { ...textMessage(""), content: { type: "read", target: textMessage("x") } } as unknown as Message);
    await pipeline.drain();
    expect(turns).toHaveLength(0);
  });

  test("群聊消息不处理，之后的私聊照常", async () => {
    const { turns, pipeline, transport } = setUp(echo);
    pipeline.enqueue(GROUP, textMessage("lol see you all saturday"));
    await pipeline.drain();
    expect(turns).toHaveLength(0);
    pipeline.enqueue(DM, textMessage("hi"));
    await pipeline.drain();
    expect(transport.textsTo(SAM)).toEqual(["hi"]);
  });

  test("typing 出错不影响这一轮", async () => {
    const { pipeline, transport } = setUp(echo);
    transport.typingFails = true;
    pipeline.enqueue(DM, textMessage("hello"));
    await pipeline.drain();
    expect(transport.textsTo(SAM)).toEqual(["hello"]);
  });

  test("重启后补处理没处理完的消息", async () => {
    const store = new Store(":memory:");
    store.insertInbound({ id: "left_over", handle: SAM, direction: "inbound", kind: "text", text: "still there?", at: "2026-09-24T14:59:00Z" });
    const { pipeline, transport } = setUp(echo, store);
    pipeline.start();
    await pipeline.drain();
    expect(transport.textsTo(SAM)).toEqual(["still there?"]);
    expect(store.pendingHandles()).toEqual([]);
  });

  test("这一轮出错：道歉，消息标成已处理", async () => {
    const { pipeline, transport, store } = setUp(async () => {
      throw new Error("boom");
    });
    pipeline.enqueue(DM, textMessage("hi"));
    await pipeline.drain();
    expect(transport.textsTo(SAM)).toEqual(["Sorry — something went wrong on my end. Could you say that again?"]);
    expect(store.pendingFor(SAM)).toHaveLength(0);
  });
});

describe("管线：并发提交", () => {
  test("提交时发现别的回合先改了同一行：用新数据重跑，只回复一次，两边的改动都在", async () => {
    const store = new Store(":memory:");
    store.saveEvent(event());
    const { pipeline, transport, turns } = setUp(async (turn, call, db) => {
      const current = db.event("evt")!;
      // 第一次处理时，另一个人的回合先提交了：把状态改成 REVIEW
      if (call === 1) store.saveEvent({ ...current, status: "REVIEW" });
      db.putEvent({ ...current, inputVersion: current.inputVersion + 1 });
      return [say(turn.handle, `version ${current.inputVersion + 1}`)];
    }, store);
    pipeline.enqueue(DM, textMessage("yep"));
    await pipeline.drain();
    expect(turns).toHaveLength(2);
    expect(transport.textsTo(SAM)).toEqual(["version 2"]);
    expect(store.getEvent("evt")).toMatchObject({ status: "REVIEW", inputVersion: 2 });
  });
});

describe("管线：发消息", () => {
  test("发给别人失败：合成一条消息告诉组织者怎么重试，送达记录记下错误", async () => {
    const { pipeline, transport, store } = setUp(async (turn) => [
      say(turn.handle, "Texting them now"),
      tell(SAM, "Sam", ALEX, ["Hi Sam"], { retry: "invite Sam", delivery: { planId: "plan_1", kind: "final" } }),
      tell("+15550000003", "Priya", ALEX, ["Hi Priya"], { retry: "invite Priya" }),
    ]);
    transport.failing.add(SAM);
    pipeline.enqueue(DM, textMessage("sam and priya", { sender: ALEX }));
    await pipeline.drain();
    expect(transport.textsTo(ALEX)).toEqual([
      "Texting them now",
      `I couldn't reach Sam — my message didn't go through. Check that the number is right, then say "invite Sam" to try again.`,
    ]);
    expect(transport.textsTo("+15550000003")).toEqual(["Hi Priya"]);
    expect(store.deliveriesOf("plan_1")).toEqual([{ planId: "plan_1", handle: SAM, channel: "imessage", kind: "final", error: "Target not allowed for this project" }]);
  });

  test("摘要发出后记下消息 id；邮件交给邮件发送器", async () => {
    const store = new Store(":memory:");
    store.saveSession({ handle: SAM, awaiting: "summary_confirm" });
    const { pipeline, email } = setUp(async (turn) => [
      summary(turn.handle, "Here's what I've got"),
      { kind: "email", to: turn.handle, message: { to: "sam@example.com", subject: "Saturday", text: "hi", html: "<p>hi</p>" } },
    ], store);
    pipeline.enqueue(DM, textMessage("done"));
    await pipeline.drain();
    expect(store.getSession(SAM)?.summaryMessageId).toBe("sent_1");
    expect(email.sent.map((message) => message.subject)).toEqual(["Saturday"]);
  });
});
