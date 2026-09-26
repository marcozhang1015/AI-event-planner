// 网页模拟器作为一个自定义 Spectrum 平台（definePlatform）：和 iMessage、terminal 一样注册，
// 消息汇进同一条 app.messages，所以 agent 的代码不用为它改任何东西。

import { definePlatform, type Content } from "spectrum-ts";
import { z } from "zod";
import { SimHub } from "./hub";

function innerText(content: Content): string {
  if (content.type === "text") return content.text;
  if (content.type === "markdown") return content.markdown;
  return "";
}

export const sim = definePlatform("sim", {
  config: z.object({
    hub: z.custom<SimHub>((value) => value instanceof SimHub, "sim provider 需要传入 SimHub"),
  }),

  user: {
    resolve: async ({ input }) => ({ id: input.userID }),
  },

  // 模拟器里只有私聊：会话 id 就是这个人的 id
  space: {
    create: async ({ input }) => ({ id: input.users[0]?.id ?? "unknown" }),
  },

  lifecycle: {
    // 参数类型要写明：不写的话 TS 会推迟推断这个函数，client 的类型就退化成 unknown
    createClient: async ({ config }: { config: { hub: SimHub } }) => config.hub,
    destroyClient: async ({ client }) => client.close(),
  },

  messages: ({ client }) => client.inbound(),

  send: async ({ space, content, client }) => {
    const sent = (item: { id: string }) => ({ id: item.id, content, space: { id: space.id }, timestamp: new Date() });
    switch (content.type) {
      case "text":
      case "markdown":
        return sent(client.agentSends(space.id, { kind: "text", text: innerText(content) }));
      case "richlink":
        return sent(client.agentSends(space.id, { kind: "link", text: content.url, url: content.url }));
      case "effect":
        return sent(client.agentSends(space.id, { kind: "text", text: innerText(content.content as Content), effect: "confetti" }));
      case "reaction":
        client.agentReacts(space.id, content.target.id, content.emoji);
        return { id: `sim_${crypto.randomUUID()}`, content, space: { id: space.id }, timestamp: new Date() };
      case "typing":
        client.setTyping(space.id, content.state === "start");
        return undefined;
      default:
        // 其他内容（附件、投票……）模拟器暂不支持
        return undefined;
    }
  },
});
