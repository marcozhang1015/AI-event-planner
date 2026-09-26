import type { Handle } from "../shared/types";

const MAX_CHARS = 80;

export type MessageLogger = (direction: "in" | "out" | "later", handle: Handle, text: string) => void;

/** 每条收发的消息打一行日志，真机测试时拿来对照手机屏幕和 handle。LOG_MESSAGES=off 关掉。 */
export function messageLogger(enabled: boolean): MessageLogger {
  if (!enabled) return () => {};
  return (direction, handle, text) => {
    const line = text.replace(/\s*\n\s*/g, " ⏎ ");
    console.log(`[${direction}] ${handle} ${JSON.stringify(line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS)}…` : line)}`);
  };
}
