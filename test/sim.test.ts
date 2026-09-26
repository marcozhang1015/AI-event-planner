// 网页模拟器：用真实的 Spectrum 运行时跑 sim provider（definePlatform），不只是类型检查。

import { afterEach, describe, expect, test } from "bun:test";
import { Spectrum, type Message, type Space } from "spectrum-ts";
import { SimHub, sim } from "../src/io/simulator";
import { render } from "../src/io/transport";
import type { SimServerEvent } from "../src/shared/sim";

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function start() {
  const hub = new SimHub([{ id: "sam", name: "Sam" }]);
  const events: SimServerEvent[] = [];
  hub.attach({ send: (data) => events.push(JSON.parse(data) as SimServerEvent) });
  const app = await Spectrum({ providers: [sim.config({ hub })] });
  stops.push(() => app.stop());
  const inbox = app.messages[Symbol.asyncIterator]();
  const next = async (): Promise<[Space, Message]> => (await inbox.next()).value as [Space, Message];
  return { hub, events, app, next };
}

describe("sim provider", () => {
  test("网页上发的消息进 app.messages；agent 的回复回到网页", async () => {
    const { hub, events, next } = await start();
    hub.userSends("sam", "hi juno");

    const [space, message] = await next();
    expect(message.platform).toBe("sim");
    expect(message.direction).toBe("inbound");
    expect(message.sender?.id).toBe("sam");
    expect(message.content).toEqual({ type: "text", text: "hi juno" });

    await space.responding(() => space.send("hey Sam"));
    expect(hub.thread("sam").map((item) => [item.from, item.text])).toEqual([
      ["user", "hi juno"],
      ["agent", "hey Sam"],
    ]);
    // typing 先亮后灭
    const typing = events.filter((event) => event.type === "typing").map((event) => event.type === "typing" && event.on);
    expect(typing).toEqual([true, false]);
  });

  test("链接卡片和 confetti 特效按富内容发出", async () => {
    const { hub, next } = await start();
    hub.userSends("sam", "hi");
    const [space] = await next();

    await space.send(render({ type: "link", url: "http://localhost:3000/o/abc" }, true));
    await space.send(render({ type: "celebrate", text: "You're all set 🎉" }, true));
    const [, link, party] = hub.thread("sam");
    expect(link).toMatchObject({ from: "agent", kind: "link", url: "http://localhost:3000/o/abc" });
    expect(party).toMatchObject({ from: "agent", kind: "text", text: "You're all set 🎉", effect: "confetti" });
  });

  test("tapback 双向：网页点在 agent 消息上 → reaction 指向那条消息；agent 点在网页消息上 → 网页显示", async () => {
    const { hub, next } = await start();
    hub.userSends("sam", "yep");
    const [space, message] = await next();

    await message.react("❤️");
    expect(hub.thread("sam")[0]?.reactions).toEqual([{ by: "agent", emoji: "❤️" }]);

    const summary = await space.send("Here's what I've got…");
    hub.userReacts("sam", summary!.id, "👍");
    const [, reaction] = await next();
    expect(reaction.content).toMatchObject({ type: "reaction", emoji: "👍", target: { id: summary!.id } });
  });

  test("浏览器发来的非法事件和不认识的人都忽略", async () => {
    const hub = new SimHub([{ id: "sam", name: "Sam" }]);
    hub.receive("not json");
    hub.receive(JSON.stringify({ type: "send", person: "mallory", text: "hi" }));
    hub.receive(JSON.stringify({ type: "send", person: "sam", text: "   " }));
    expect(hub.thread("mallory")).toEqual([]);
    expect(hub.thread("sam")).toEqual([]);
  });
});
