// 网页模拟器和服务端之间的 WebSocket 协议。只有类型，web/ 也直接引用。

/** 一个模拟的人。id 是 handle 里 `sim:` 后面的部分，比如 "sam"。 */
export interface SimPerson {
  id: string;
  name: string;
}

export type SimFrom = "agent" | "user";

export interface SimReaction {
  by: SimFrom;
  emoji: string;
}

export interface SimLinkPreview {
  provider: "google-maps" | "opentable";
  title: string;
  subtitle: string;
  detail?: string;
}

export interface SimItem {
  id: string;
  from: SimFrom;
  kind: "text" | "link";
  text: string;
  url?: string;
  preview?: SimLinkPreview;
  /** iMessage 的全屏特效；模拟器里放 confetti。 */
  effect?: "confetti";
  /** 录屏用：这条前面插一行时间，表示和上一条隔了一段。 */
  stamp?: string;
  at: string;
  reactions: SimReaction[];
}

export type SimServerEvent =
  | { type: "snapshot"; people: SimPerson[]; threads: Record<string, SimItem[]>; typing: string[] }
  | { type: "item"; person: string; item: SimItem }
  | { type: "reaction"; person: string; targetId: string; reaction: SimReaction }
  | { type: "typing"; person: string; on: boolean };

export type SimClientEvent = { type: "send"; person: string; text: string } | { type: "react"; person: string; targetId: string; emoji: string };
