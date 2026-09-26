// Spectrum 接入：启动 provider、按 handle 找会话、把 OutPart 换成 Spectrum 的 content builder。

import { richlink, Spectrum, type ContentInput, type Message, type Space, type SpectrumInstance } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import type { ProviderName } from "../config";
import type { OutPart } from "../out/imessage";
import type { SimHub } from "../sim/hub";
import { sim } from "../sim/platform";
import type { Handle } from "../types";

// provider 是运行时按 PROVIDERS 选的，类型上丢了具体是哪几个；收窄时在这里集中断言一次
type IMessageApp = SpectrumInstance<[ReturnType<typeof imessage.config>]>;
type TerminalApp = SpectrumInstance<[ReturnType<typeof terminal.config>]>;
type SimApp = SpectrumInstance<[ReturnType<typeof sim.config>]>;

/** 管线只用到这些；测试里可以换成假的。 */
export interface TransportLike {
  handleOf(space: Space, message: Message): Handle | undefined;
  remember(handle: Handle, space: Space): void;
  spaceFor(handle: Handle): Promise<Pick<Space, "__platform" | "send" | "responding"> | undefined>;
}

/** 这些平台能显示链接卡片和特效；其他平台发纯文本。 */
const RICH_PLATFORMS = new Set(["imessage", "sim"]);

/**
 * iMessage 和网页模拟器上，链接发成链接卡片、庆祝消息带 confetti 特效；其他平台发纯文本。
 * 实测 terminal 不支持 richlink 时会直接跳过（不是退回纯文本），所以必须按平台换。
 */
export function toContent(part: OutPart, platform: string): ContentInput {
  if (typeof part === "string") return part;
  // TODO(B, M2)：iMessage 用户如果走的是 SMS/RCS（sender.service），也发纯文本
  if (!RICH_PLATFORMS.has(platform)) return part.type === "link" ? part.url : part.text;
  return part.type === "link" ? richlink(part.url) : effect(part.text, imessage.effect.message.confetti);
}

/** handle 的前缀决定走哪个平台：`sim:` 网页模拟器，`term:` 终端，其余是 iMessage 号码或邮箱。 */
export class Transport implements TransportLike {
  private readonly spaces = new Map<Handle, Space>();

  private constructor(
    readonly app: SpectrumInstance,
    private readonly providers: ProviderName[],
  ) {}

  /** 启用 imessage 时，凭证从 SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET 读取；启用 sim 时要传 simHub。 */
  static async start(providers: ProviderName[], simHub?: SimHub): Promise<Transport> {
    if (providers.includes("sim") && !simHub) throw new Error("启用 sim provider 需要 SimHub");
    const configs = [
      ...(providers.includes("imessage") ? [imessage.config()] : []),
      ...(providers.includes("sim") && simHub ? [sim.config({ hub: simHub })] : []),
      ...(providers.includes("terminal") ? [terminal.config()] : []),
    ];
    const app = await Spectrum({ providers: configs });
    return new Transport(app as unknown as SpectrumInstance, providers);
  }

  handleOf(space: Space, message: Message): Handle | undefined {
    // terminal 的每个聊天窗口、模拟器里的每部手机，都当作一个人
    if (message.platform === "terminal") return `term:${space.id}`;
    if (message.platform === "sim") return `sim:${space.id}`;
    return message.sender?.id;
  }

  remember(handle: Handle, space: Space): void {
    this.spaces.set(handle, space);
  }

  async spaceFor(handle: Handle): Promise<Space | undefined> {
    const known = this.spaces.get(handle);
    if (known) return known;

    let space: Space | undefined;
    if (handle.startsWith("term:")) {
      if (this.providers.includes("terminal")) space = await terminal(this.app as unknown as TerminalApp).space.get(handle.slice("term:".length));
    } else if (handle.startsWith("sim:")) {
      if (this.providers.includes("sim")) space = await sim(this.app as unknown as SimApp).space.get(handle.slice("sim:".length));
    } else if (this.providers.includes("imessage")) {
      // Pro 共享号码池只能发给已登记的 Users，否则报 "Target not allowed for this project"
      const im = imessage(this.app as unknown as IMessageApp);
      space = await im.space.create(await im.user(handle));
    }
    if (space) this.spaces.set(handle, space);
    return space;
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }
}
