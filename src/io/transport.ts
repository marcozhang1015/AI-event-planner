// Spectrum 接入：启动 provider、认出发送者、按 handle 找会话、把 OutPart 换成各平台能显示的内容。

import { richlink, Spectrum, typing, type ContentInput, type Message, type Space, type SpectrumInstance } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import type { ProviderName } from "../config";
import { normalizeHandle, platformOf } from "../core/handle";
import { plainText, type OutPart } from "../out/actions";
import type { Handle } from "../shared/types";
import { sim, type SimHub } from "./simulator";

// provider 是运行时按 PROVIDERS 选的，类型上丢了具体是哪几个；收窄时在这里集中断言一次
type IMessageApp = SpectrumInstance<[ReturnType<typeof imessage.config>]>;
type TerminalApp = SpectrumInstance<[ReturnType<typeof terminal.config>]>;
type SimApp = SpectrumInstance<[ReturnType<typeof sim.config>]>;

export interface Sender {
  handle: Handle;
  /** iMessage 上的 iMessage / SMS / RCS（其他平台没有）。 */
  service?: string;
}

/** 管线只用到这些；测试里换成假的。 */
export interface TransportLike {
  /** 这条消息是谁发的；群聊和认不出的发送者返回 undefined，不处理。 */
  identify(space: Space, message: Message): Sender | undefined;
  /** 记下回复用的会话、对方的 service，以及原始消息（点 tapback 要用）。 */
  remember(sender: Sender, space: Space, message: Message): void;
  /** 发一段内容，返回平台消息 id。找不到会话或发送失败时抛错。 */
  send(handle: Handle, part: OutPart): Promise<string | undefined>;
  /** 对最近收到的某条消息点 tapback；消息不在了（比如重启过）就跳过。 */
  react(messageId: string, emoji: string): Promise<void>;
  typing(handle: Handle, on: boolean): Promise<void>;
}

const RICH_PLATFORMS = new Set(["imessage", "sim"]);
const PLAIN_SERVICES = new Set(["SMS", "RCS"]);
/** 记住多少条最近收到的消息（点 tapback 用）。 */
const RECENT_LIMIT = 500;

/**
 * 链接卡片和 confetti 特效只在 iMessage 和网页模拟器上发；terminal 和 SMS / RCS 发纯文本，链接直接写网址。
 * 实测 terminal 碰到 richlink 会直接跳过（不是退回纯文本），所以必须换。
 */
export function render(part: OutPart, rich: boolean): ContentInput {
  if (typeof part === "string" || !rich) return plainText(part);
  return part.type === "link" ? richlink(part.url) : effect(part.text, imessage.effect.message.confetti);
}

function isGroup(space: Pick<Space, "id">): boolean {
  return (space as { type?: unknown }).type === "group";
}

function serviceOf(message: Message): string | undefined {
  const service = (message.sender as { service?: unknown } | undefined)?.service;
  return typeof service === "string" ? service : undefined;
}

/** 私聊消息的发送者；群聊返回 undefined。terminal 的每个聊天窗口、模拟器里的每部手机都当作一个人。 */
export function identifySender(space: Pick<Space, "id">, message: Message): Sender | undefined {
  if (message.platform === "terminal") return { handle: `term:${space.id}` };
  if (message.platform === "sim") return { handle: `sim:${space.id}` };
  if (isGroup(space)) return undefined;
  const id = message.sender?.id;
  return id ? { handle: normalizeHandle(id), service: serviceOf(message) } : undefined;
}

/** 链接卡片和特效只发给 iMessage 和网页模拟器；走 SMS / RCS 的人发纯文本。 */
export function isRich(platform: string, service: string | undefined): boolean {
  return RICH_PLATFORMS.has(platform) && !PLAIN_SERVICES.has(service ?? "");
}

/** handle 的前缀决定走哪个平台：`sim:` 网页模拟器，`term:` 终端，其余是 iMessage 号码或邮箱。 */
export class Transport implements TransportLike {
  private readonly spaces = new Map<Handle, Space>();
  private readonly services = new Map<Handle, string>();
  private readonly recent = new Map<string, Message>();
  private readonly ignoredGroups = new Set<string>();

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

  identify(space: Space, message: Message): Sender | undefined {
    // 群聊一律不处理：否则会把群记成这个人的会话，私聊内容（过敏、预算）就会发进群里
    if (isGroup(space) && !this.ignoredGroups.has(space.id)) {
      this.ignoredGroups.add(space.id);
      console.log(`[transport] 收到群聊 ${space.id} 的消息，只处理私聊，忽略`);
    }
    return identifySender(space, message);
  }

  remember(sender: Sender, space: Space, message: Message): void {
    this.spaces.set(sender.handle, space);
    if (sender.service) this.services.set(sender.handle, sender.service);
    this.recent.set(message.id, message);
    if (this.recent.size > RECENT_LIMIT) this.recent.delete(this.recent.keys().next().value!);
  }

  async send(handle: Handle, part: OutPart): Promise<string | undefined> {
    const space = await this.spaceFor(handle);
    if (!space) throw new Error(`没有 ${handle} 的会话：PROVIDERS 里没启用 ${platformOf(handle)}`);
    const sent = await space.send(render(part, isRich(space.__platform, this.services.get(handle))));
    return sent?.id;
  }

  async react(messageId: string, emoji: string): Promise<void> {
    const message = this.recent.get(messageId);
    if (!message) throw new Error(`找不到可点 tapback 的消息 ${messageId}`);
    await message.react(emoji);
  }

  /** 只在聊过的会话里显示 typing，不为了 typing 去新建会话。 */
  async typing(handle: Handle, on: boolean): Promise<void> {
    await this.spaces.get(handle)?.send(typing(on ? "start" : "stop"));
  }

  private async spaceFor(handle: Handle): Promise<Space | undefined> {
    const known = this.spaces.get(handle);
    if (known) return known;

    let space: Space | undefined;
    const platform = platformOf(handle);
    if (platform === "terminal") {
      if (this.providers.includes("terminal")) space = await terminal(this.app as unknown as TerminalApp).space.get(handle.slice("term:".length));
    } else if (platform === "sim") {
      if (this.providers.includes("sim")) space = await sim(this.app as unknown as SimApp).space.get(handle.slice("sim:".length));
    } else if (this.providers.includes("imessage")) {
      // 共享号码池下这一步不经过服务器；号码没登记的话，要到 send 时才报 "Target not allowed for this project"
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
