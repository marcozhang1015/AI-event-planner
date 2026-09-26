// 轮询网页 JSON API（§5.6：每 2–3 秒一次）。内容没变就不更新状态，页面和地图不会白白重画。

import { useEffect, useState } from "react";

const POLL_MS = 2500;

export type Poll<T> =
  | { status: "loading" }
  | { status: "missing" }
  // 还没拿到过数据就出错了（服务没起来、断网）
  | { status: "failed" }
  // stale：最近一次刷新失败，显示的是上一次拿到的数据
  | { status: "ready"; data: T; stale: boolean };

export function usePolling<T>(path: string | undefined): Poll<T> {
  const [poll, setPoll] = useState<Poll<T>>({ status: "loading" });

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: string | undefined;

    const load = async () => {
      try {
        const response = await fetch(path, { cache: "no-store", signal: controller.signal });
        if (response.status === 404) {
          // 链接不存在：不会自己变好，不再轮询
          setPoll({ status: "missing" });
          return;
        } else if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        } else {
          const text = await response.text();
          if (text !== last) {
            const data = JSON.parse(text) as T;
            last = text;
            setPoll({ status: "ready", data, stale: false });
          } else {
            setPoll((current) => (current.status === "ready" && current.stale ? { ...current, stale: false } : current));
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        setPoll((current) => {
          if (current.status === "ready") return current.stale ? current : { ...current, stale: true };
          return current.status === "failed" ? current : { status: "failed" };
        });
      }
      // 等这一次回来再排下一次，服务慢的时候请求不会越堆越多
      if (!controller.signal.aborted) timer = setTimeout(load, POLL_MS);
    };

    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path]);

  return poll;
}
