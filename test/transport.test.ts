import { describe, expect, test } from "bun:test";
import type { Message } from "spectrum-ts";
import { identifySender, isRich, render } from "../src/io/transport";
import { celebrate, link } from "../src/out/actions";

function message(platform: string, sender?: Record<string, unknown>): Message {
  return { id: "m1", platform, direction: "inbound", sender, content: { type: "text", text: "hi" } } as unknown as Message;
}

describe("认出发送者", () => {
  test("私聊：号码规范化，带上 service；群聊和没有发送者的不处理", () => {
    expect(identifySender({ id: "any;-;+15550000002", type: "dm" } as never, message("imessage", { id: "+1 (555) 000-0002", service: "SMS" }))).toEqual({
      handle: "+15550000002",
      service: "SMS",
    });
    expect(identifySender({ id: "iMessage;+;chat42", type: "group" } as never, message("imessage", { id: "+15550000002" }))).toBeUndefined();
    expect(identifySender({ id: "any;-;x", type: "dm" } as never, message("imessage"))).toBeUndefined();
  });

  test("terminal 的聊天窗口、模拟器里的手机各算一个人", () => {
    expect(identifySender({ id: "chat-1" } as never, message("terminal"))).toEqual({ handle: "term:chat-1" });
    expect(identifySender({ id: "sam" } as never, message("sim"))).toEqual({ handle: "sim:sam" });
  });
});

describe("按平台发内容", () => {
  test("SMS / RCS 和 terminal 发纯文本；iMessage 和模拟器发链接卡片和特效", () => {
    expect(isRich("imessage", "iMessage")).toBe(true);
    expect(isRich("imessage", undefined)).toBe(true);
    expect(isRich("sim", undefined)).toBe(true);
    expect(isRich("imessage", "SMS")).toBe(false);
    expect(isRich("imessage", "RCS")).toBe(false);
    expect(isRich("terminal", undefined)).toBe(false);
  });

  test("纯文本时链接直接写网址，庆祝消息去掉特效", () => {
    expect(render(link("https://juno.test/i/abc"), false)).toBe("https://juno.test/i/abc");
    expect(render(celebrate("You're all set 🎉"), false)).toBe("You're all set 🎉");
    expect(render("hi", true)).toBe("hi");
    expect(typeof render(link("https://juno.test/i/abc"), true)).not.toBe("string");
  });
});
